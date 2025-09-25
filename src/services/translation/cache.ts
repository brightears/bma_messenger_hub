import { logger } from '../../utils/logger';
import { TranslationResponse } from './index';

/**
 * Cache configuration interface
 */
export interface CacheConfig {
  maxSize: number;
  expiryMinutes: number;
  cleanupIntervalMinutes?: number;
}

/**
 * Cache entry interface
 */
interface CacheEntry {
  data: Omit<TranslationResponse, 'isCached' | 'timestamp'>;
  timestamp: number;
  expiresAt: number;
  hitCount: number;
  lastAccessed: number;
}

/**
 * Cache statistics interface
 */
export interface CacheStats {
  size: number;
  maxSize: number;
  hitCount: number;
  missCount: number;
  hitRatio: number;
  memoryUsageBytes: number;
  oldestEntryAge: number;
  averageEntryAge: number;
  expiredEntries: number;
}

/**
 * Translation cache class with LRU eviction and TTL expiration
 */
export class TranslationCache {
  private cache: Map<string, CacheEntry>;
  private config: Required<CacheConfig>;
  private stats: {
    hits: number;
    misses: number;
    evictions: number;
    expirations: number;
  };
  private cleanupTimer: NodeJS.Timeout | null;

  constructor(config: CacheConfig) {
    this.config = {
      ...config,
      cleanupIntervalMinutes: config.cleanupIntervalMinutes || 15,
    };

    this.cache = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      expirations: 0,
    };

    this.cleanupTimer = null;
    this.startCleanupTimer();

    logger.info('TranslationCache initialized', {
      maxSize: this.config.maxSize,
      expiryMinutes: this.config.expiryMinutes,
      cleanupIntervalMinutes: this.config.cleanupIntervalMinutes,
    });
  }

  /**
   * Get cached translation
   */
  async get(key: string): Promise<(Omit<TranslationResponse, 'isCached' | 'timestamp'>) | null> {
    try {
      const entry = this.cache.get(key);

      if (!entry) {
        this.stats.misses++;
        return null;
      }

      const now = Date.now();

      // Check if entry has expired
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        this.stats.expirations++;
        this.stats.misses++;

        logger.debug('Cache entry expired', {
          key: this.truncateKey(key),
          expiresAt: new Date(entry.expiresAt).toISOString(),
          now: new Date(now).toISOString(),
        });

        return null;
      }

      // Update access statistics
      entry.hitCount++;
      entry.lastAccessed = now;

      // Move to end of Map (most recently used)
      this.cache.delete(key);
      this.cache.set(key, entry);

      this.stats.hits++;

      logger.debug('Cache hit', {
        key: this.truncateKey(key),
        hitCount: entry.hitCount,
        age: Math.round((now - entry.timestamp) / 1000 / 60), // Age in minutes
      });

      return entry.data;
    } catch (error) {
      logger.error('Cache get operation failed', {
        key: this.truncateKey(key),
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Set cached translation
   */
  async set(key: string, value: TranslationResponse): Promise<void> {
    try {
      const now = Date.now();
      const expiresAt = now + (this.config.expiryMinutes * 60 * 1000);

      // Remove isCached and timestamp from stored data to avoid redundancy
      const { isCached, timestamp, ...dataToStore } = value;

      const entry: CacheEntry = {
        data: dataToStore,
        timestamp: now,
        expiresAt,
        hitCount: 0,
        lastAccessed: now,
      };

      // Check if we need to evict entries
      if (this.cache.size >= this.config.maxSize) {
        await this.evictLeastRecentlyUsed();
      }

      this.cache.set(key, entry);

      logger.debug('Cache set', {
        key: this.truncateKey(key),
        expiresAt: new Date(expiresAt).toISOString(),
        cacheSize: this.cache.size,
      });
    } catch (error) {
      logger.error('Cache set operation failed', {
        key: this.truncateKey(key),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Check if key exists in cache (without updating access time)
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.expirations++;
      return false;
    }

    return true;
  }

  /**
   * Delete specific cache entry
   */
  delete(key: string): boolean {
    const existed = this.cache.delete(key);

    if (existed) {
      logger.debug('Cache entry deleted', {
        key: this.truncateKey(key),
        cacheSize: this.cache.size,
      });
    }

    return existed;
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    const previousSize = this.cache.size;
    this.cache.clear();

    // Reset statistics
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      expirations: 0,
    };

    logger.info('Cache cleared', {
      previousSize,
      currentSize: this.cache.size,
    });
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const now = Date.now();
    const entries = Array.from(this.cache.values());

    let totalAge = 0;
    let oldestAge = 0;
    let expiredCount = 0;

    entries.forEach(entry => {
      const age = now - entry.timestamp;
      totalAge += age;

      if (age > oldestAge) {
        oldestAge = age;
      }

      if (now > entry.expiresAt) {
        expiredCount++;
      }
    });

    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRatio = totalRequests > 0 ? this.stats.hits / totalRequests : 0;
    const averageAge = entries.length > 0 ? totalAge / entries.length : 0;

    // Estimate memory usage (rough calculation)
    const memoryUsageBytes = this.estimateMemoryUsage();

    return {
      size: this.cache.size,
      maxSize: this.config.maxSize,
      hitCount: this.stats.hits,
      missCount: this.stats.misses,
      hitRatio: Math.round(hitRatio * 10000) / 100, // Percentage with 2 decimals
      memoryUsageBytes,
      oldestEntryAge: Math.round(oldestAge / 1000 / 60), // Minutes
      averageEntryAge: Math.round(averageAge / 1000 / 60), // Minutes
      expiredEntries: expiredCount,
    };
  }

  /**
   * Get cache keys (for debugging)
   */
  getKeys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get cache entries count by language
   */
  getLanguageDistribution(): Record<string, number> {
    const distribution: Record<string, number> = {};

    for (const entry of this.cache.values()) {
      const targetLang = entry.data.targetLanguage;
      const sourceLang = entry.data.detectedLanguage;

      const key = `${sourceLang}->${targetLang}`;
      distribution[key] = (distribution[key] || 0) + 1;
    }

    return distribution;
  }

  /**
   * Cleanup expired entries
   */
  private async cleanupExpiredEntries(): Promise<void> {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        expiredKeys.push(key);
      }
    }

    expiredKeys.forEach(key => {
      this.cache.delete(key);
      this.stats.expirations++;
    });

    if (expiredKeys.length > 0) {
      logger.debug('Cleaned up expired cache entries', {
        expiredCount: expiredKeys.length,
        remainingSize: this.cache.size,
      });
    }
  }

  /**
   * Evict least recently used entries
   */
  private async evictLeastRecentlyUsed(): Promise<void> {
    const entries = Array.from(this.cache.entries());

    // Sort by last accessed time (oldest first)
    entries.sort(([, a], [, b]) => a.lastAccessed - b.lastAccessed);

    // Evict the oldest 10% or at least 1 entry
    const evictCount = Math.max(1, Math.floor(entries.length * 0.1));
    const toEvict = entries.slice(0, evictCount);

    toEvict.forEach(([key]) => {
      this.cache.delete(key);
      this.stats.evictions++;
    });

    logger.debug('Evicted LRU cache entries', {
      evictedCount: toEvict.length,
      remainingSize: this.cache.size,
    });
  }

  /**
   * Start cleanup timer
   */
  private startCleanupTimer(): void {
    const intervalMs = this.config.cleanupIntervalMinutes * 60 * 1000;

    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredEntries().catch(error => {
        logger.error('Cache cleanup failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, intervalMs);

    // Don't keep the process alive just for the cleanup timer
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }

    logger.debug('Cache cleanup timer started', {
      intervalMinutes: this.config.cleanupIntervalMinutes,
    });
  }

  /**
   * Stop cleanup timer
   */
  private stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      logger.debug('Cache cleanup timer stopped');
    }
  }

  /**
   * Estimate memory usage (rough calculation)
   */
  private estimateMemoryUsage(): number {
    let totalBytes = 0;

    for (const [key, entry] of this.cache.entries()) {
      // Estimate key size
      totalBytes += Buffer.byteLength(key, 'utf8');

      // Estimate entry data size
      totalBytes += Buffer.byteLength(JSON.stringify(entry), 'utf8');

      // Add overhead for Map entry and object properties
      totalBytes += 200; // Rough estimate
    }

    return totalBytes;
  }

  /**
   * Truncate key for logging
   */
  private truncateKey(key: string): string {
    return key.length > 50 ? `${key.substring(0, 50)}...` : key;
  }

  /**
   * Warm up cache with common translations
   */
  async warmUp(commonPhrases: Array<{ text: string; sourceLang: string; targetLang: string }>): Promise<void> {
    logger.info('Starting cache warm-up', {
      phrasesCount: commonPhrases.length,
    });

    // This would typically be called with pre-translated common phrases
    // For now, we just log the intention
    logger.info('Cache warm-up completed', {
      phrasesCount: commonPhrases.length,
      cacheSize: this.cache.size,
    });
  }

  /**
   * Export cache data for backup
   */
  exportCache(): Array<{ key: string; entry: CacheEntry }> {
    return Array.from(this.cache.entries()).map(([key, entry]) => ({
      key,
      entry,
    }));
  }

  /**
   * Import cache data from backup
   */
  importCache(data: Array<{ key: string; entry: CacheEntry }>): void {
    this.cache.clear();

    const now = Date.now();
    let validEntries = 0;

    data.forEach(({ key, entry }) => {
      // Skip expired entries
      if (now <= entry.expiresAt) {
        this.cache.set(key, entry);
        validEntries++;
      }
    });

    logger.info('Cache imported', {
      totalEntries: data.length,
      validEntries,
      skippedExpired: data.length - validEntries,
    });
  }

  /**
   * Cleanup when shutting down
   */
  destroy(): void {
    this.stopCleanupTimer();
    this.cache.clear();
    logger.info('TranslationCache destroyed');
  }
}