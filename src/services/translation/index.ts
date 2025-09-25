import axios from 'axios';
import { logger } from '../../utils/logger';
import { config } from '../../config';
import { LanguageDetector, SupportedLanguage } from './language-detector';
import { TranslationCache } from './cache';
import { z } from 'zod';

// Re-export SupportedLanguage for convenience
export { SupportedLanguage };

/**
 * Translation configuration schema
 */
const TranslationConfigSchema = z.object({
  maxRetries: z.number().min(1).max(5).default(3),
  retryDelay: z.number().min(100).max(5000).default(1000),
  maxCacheSize: z.number().min(100).max(10000).default(1000),
  cacheExpiryMinutes: z.number().min(1).max(1440).default(60),
  confidenceThreshold: z.number().min(0.1).max(1.0).default(0.8),
});

/**
 * Translation request interface
 */
export interface TranslationRequest {
  text: string;
  sourceLanguage?: string;
  targetLanguage: string;
  preserveOriginal?: boolean;
  context?: {
    platform?: 'whatsapp' | 'line' | 'google-chat';
    messageType?: 'text' | 'system' | 'command';
    userInfo?: {
      id: string;
      name?: string;
      language?: string;
    };
  };
}

/**
 * Translation response interface
 */
export interface TranslationResponse {
  originalText: string;
  translatedText: string;
  detectedLanguage: string;
  targetLanguage: string;
  confidence: number;
  formattedMessage: string;
  isCached: boolean;
  timestamp: Date;
}

/**
 * Gemini API response schema
 */
const GeminiResponseSchema = z.object({
  candidates: z.array(
    z.object({
      content: z.object({
        parts: z.array(
          z.object({
            text: z.string(),
          })
        ),
      }),
    })
  ),
});

/**
 * Translation service class using Gemini 2.5 Flash
 */
export class TranslationService {
  private languageDetector: LanguageDetector;
  private cache: TranslationCache;
  private config: z.infer<typeof TranslationConfigSchema>;
  private rateLimitTracker: Map<string, { count: number; resetTime: number }>;

  constructor(customConfig?: Partial<z.infer<typeof TranslationConfigSchema>>) {
    this.config = TranslationConfigSchema.parse(customConfig || {});
    this.languageDetector = new LanguageDetector();
    this.cache = new TranslationCache({
      maxSize: this.config.maxCacheSize,
      expiryMinutes: this.config.cacheExpiryMinutes,
    });
    this.rateLimitTracker = new Map();

    logger.info('TranslationService initialized', {
      config: this.config,
      supportedLanguages: Object.values(SupportedLanguage),
    });
  }

  /**
   * Main translation method
   */
  async translate(request: TranslationRequest): Promise<TranslationResponse> {
    try {
      // Validate input
      if (!request.text?.trim()) {
        throw new Error('Translation text cannot be empty');
      }

      // Check rate limiting
      await this.checkRateLimit();

      // Detect source language if not provided
      const detectedLanguage = request.sourceLanguage ||
        await this.languageDetector.detectLanguage(request.text);

      // Skip translation if source and target languages are the same
      if (detectedLanguage === request.targetLanguage) {
        return this.createSameLanguageResponse(request, detectedLanguage);
      }

      // Check cache first
      const cacheKey = this.generateCacheKey(request.text, detectedLanguage, request.targetLanguage);
      const cachedResult = await this.cache.get(cacheKey);

      if (cachedResult) {
        logger.debug('Translation served from cache', {
          sourceLanguage: detectedLanguage,
          targetLanguage: request.targetLanguage,
          textLength: request.text.length,
        });

        return {
          ...cachedResult,
          isCached: true,
          timestamp: new Date(),
        };
      }

      // Perform translation with Gemini
      const translatedText = await this.translateWithGemini(
        request.text,
        detectedLanguage,
        request.targetLanguage,
        request.context
      );

      const confidence = await this.calculateConfidence(request.text, translatedText, detectedLanguage);

      const response: TranslationResponse = {
        originalText: request.text,
        translatedText,
        detectedLanguage,
        targetLanguage: request.targetLanguage,
        confidence,
        formattedMessage: this.formatMessage(request.text, translatedText, request.preserveOriginal),
        isCached: false,
        timestamp: new Date(),
      };

      // Cache the result if confidence is above threshold
      if (confidence >= this.config.confidenceThreshold) {
        await this.cache.set(cacheKey, response);
      }

      logger.info('Translation completed successfully', {
        sourceLanguage: detectedLanguage,
        targetLanguage: request.targetLanguage,
        confidence,
        textLength: request.text.length,
        translatedLength: translatedText.length,
        platform: request.context?.platform,
      });

      return response;
    } catch (error) {
      logger.error('Translation failed', {
        error: error instanceof Error ? error.message : String(error),
        request: {
          textLength: request.text?.length || 0,
          sourceLanguage: request.sourceLanguage,
          targetLanguage: request.targetLanguage,
          platform: request.context?.platform,
        },
      });
      throw error;
    }
  }

  /**
   * Batch translate multiple messages
   */
  async translateBatch(requests: TranslationRequest[]): Promise<TranslationResponse[]> {
    logger.info('Starting batch translation', { count: requests.length });

    const results = await Promise.allSettled(
      requests.map(request => this.translate(request))
    );

    const responses: TranslationResponse[] = [];
    let successCount = 0;
    let failureCount = 0;

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        responses.push(result.value);
        successCount++;
      } else {
        logger.error(`Batch translation failed for request ${index}`, {
          error: result.reason,
          request: requests[index],
        });
        failureCount++;

        // Create error response
        responses.push(this.createErrorResponse(requests[index], result.reason));
      }
    });

    logger.info('Batch translation completed', {
      total: requests.length,
      successful: successCount,
      failed: failureCount,
    });

    return responses;
  }

  /**
   * Translate with Gemini API
   */
  private async translateWithGemini(
    text: string,
    sourceLanguage: string,
    targetLanguage: string,
    context?: TranslationRequest['context']
  ): Promise<string> {
    const prompt = this.buildTranslationPrompt(text, sourceLanguage, targetLanguage, context);

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        const response = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${config.gemini.model}:generateContent?key=${config.gemini.apiKey}`,
          {
            contents: [
              {
                parts: [
                  {
                    text: prompt,
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: config.gemini.temperature,
              maxOutputTokens: config.gemini.maxTokens,
              topP: 0.95,
              topK: 64,
            },
            safetySettings: [
              {
                category: 'HARM_CATEGORY_HARASSMENT',
                threshold: 'BLOCK_MEDIUM_AND_ABOVE',
              },
              {
                category: 'HARM_CATEGORY_HATE_SPEECH',
                threshold: 'BLOCK_MEDIUM_AND_ABOVE',
              },
              {
                category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
                threshold: 'BLOCK_MEDIUM_AND_ABOVE',
              },
              {
                category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
                threshold: 'BLOCK_MEDIUM_AND_ABOVE',
              },
            ],
          },
          {
            headers: {
              'Content-Type': 'application/json',
            },
            timeout: 30000, // 30 second timeout
          }
        );

        const validatedResponse = GeminiResponseSchema.parse(response.data);
        const translatedText = validatedResponse.candidates[0]?.content?.parts[0]?.text;

        if (!translatedText) {
          throw new Error('No translation content received from Gemini');
        }

        // Clean up the response (remove any formatting artifacts)
        return this.cleanTranslationText(translatedText);
      } catch (error) {
        const isLastAttempt = attempt === this.config.maxRetries;

        logger.warn(`Translation attempt ${attempt} failed`, {
          error: error instanceof Error ? error.message : String(error),
          isLastAttempt,
          sourceLanguage,
          targetLanguage,
        });

        if (isLastAttempt) {
          if (axios.isAxiosError(error)) {
            if (error.response?.status === 429) {
              throw new Error('Rate limit exceeded. Please try again later.');
            } else if (error.response?.status === 400) {
              throw new Error('Invalid translation request. Please check your input.');
            } else if (error.response?.status === 403) {
              throw new Error('API key invalid or insufficient permissions.');
            }
          }
          throw error;
        }

        // Exponential backoff
        await this.delay(this.config.retryDelay * Math.pow(2, attempt - 1));
      }
    }

    throw new Error('Translation failed after all retry attempts');
  }

  /**
   * Build translation prompt for Gemini
   */
  private buildTranslationPrompt(
    text: string,
    sourceLanguage: string,
    targetLanguage: string,
    context?: TranslationRequest['context']
  ): string {
    const sourceLanguageName = this.getLanguageName(sourceLanguage);
    const targetLanguageName = this.getLanguageName(targetLanguage);

    let prompt = `You are a professional translator specializing in ${sourceLanguageName} to ${targetLanguageName} translation.

Instructions:
1. Translate the following text accurately while preserving the original meaning and tone
2. Maintain context and cultural nuances
3. Keep proper nouns, brand names, and technical terms as appropriate
4. For informal/casual text, maintain the informal tone in translation
5. For formal/business text, maintain professional language
6. Only return the translated text without any additional explanation or formatting

`;

    // Add context-specific instructions
    if (context?.platform) {
      prompt += `Context: This is a ${context.platform} message`;
      if (context.messageType) {
        prompt += ` of type "${context.messageType}"`;
      }
      prompt += '. ';
    }

    if (context?.platform === 'whatsapp' || context?.platform === 'line') {
      prompt += 'This is an instant messaging conversation, so maintain a conversational tone. ';
    } else if (context?.platform === 'google-chat') {
      prompt += 'This is a business chat environment, maintain appropriate professional tone. ';
    }

    prompt += `\nSource language: ${sourceLanguageName}
Target language: ${targetLanguageName}

Text to translate:
${text}

Translation:`;

    return prompt;
  }

  /**
   * Generate cache key for translations
   */
  private generateCacheKey(text: string, sourceLanguage: string, targetLanguage: string): string {
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256')
      .update(`${text}|${sourceLanguage}|${targetLanguage}`)
      .digest('hex');
    return `translation:${hash}`;
  }

  /**
   * Format message with original and translation
   */
  private formatMessage(originalText: string, translatedText: string, preserveOriginal = true): string {
    if (!preserveOriginal || originalText === translatedText) {
      return translatedText;
    }

    return `[${originalText}] --- [${translatedText}]`;
  }

  /**
   * Clean translation text from formatting artifacts
   */
  private cleanTranslationText(text: string): string {
    return text
      .trim()
      .replace(/^["']|["']$/g, '') // Remove quotes at start/end
      .replace(/^\*\*|\*\*$/g, '') // Remove bold markdown
      .replace(/^Translation:\s*/i, '') // Remove "Translation:" prefix
      .trim();
  }

  /**
   * Calculate translation confidence score
   */
  private async calculateConfidence(
    originalText: string,
    translatedText: string,
    sourceLanguage: string
  ): Promise<number> {
    // Basic confidence calculation based on text characteristics
    let confidence = 0.8; // Base confidence

    // Increase confidence for longer texts
    if (originalText.length > 50) {
      confidence += 0.1;
    }

    // Decrease confidence for very short texts or single words
    if (originalText.length < 10) {
      confidence -= 0.2;
    }

    // Decrease confidence if translation seems too similar (might be untranslated)
    const similarity = this.calculateStringSimilarity(originalText.toLowerCase(), translatedText.toLowerCase());
    if (similarity > 0.9 && sourceLanguage !== 'en') {
      confidence -= 0.3;
    }

    // Ensure confidence is within bounds
    return Math.max(0.1, Math.min(1.0, confidence));
  }

  /**
   * Calculate string similarity (simple Jaccard similarity)
   */
  private calculateStringSimilarity(str1: string, str2: string): number {
    const set1 = new Set(str1.split(''));
    const set2 = new Set(str2.split(''));
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    return intersection.size / union.size;
  }

  /**
   * Get human-readable language name
   */
  private getLanguageName(languageCode: string): string {
    const languageNames: Record<string, string> = {
      'en': 'English',
      'th': 'Thai',
      'zh-cn': 'Chinese (Simplified)',
      'zh-tw': 'Chinese (Traditional)',
      'es': 'Spanish',
      'fr': 'French',
      'de': 'German',
      'ja': 'Japanese',
      'ko': 'Korean',
      'vi': 'Vietnamese',
      'ms': 'Malay',
      'id': 'Indonesian',
      'pt': 'Portuguese',
      'it': 'Italian',
      'ru': 'Russian',
      'ar': 'Arabic',
      'hi': 'Hindi',
    };

    return languageNames[languageCode] || languageCode;
  }

  /**
   * Create response for same language (no translation needed)
   */
  private createSameLanguageResponse(request: TranslationRequest, detectedLanguage: string): TranslationResponse {
    return {
      originalText: request.text,
      translatedText: request.text,
      detectedLanguage,
      targetLanguage: request.targetLanguage,
      confidence: 1.0,
      formattedMessage: request.text,
      isCached: false,
      timestamp: new Date(),
    };
  }

  /**
   * Create error response for failed translations
   */
  private createErrorResponse(request: TranslationRequest, error: any): TranslationResponse {
    return {
      originalText: request.text,
      translatedText: request.text, // Fallback to original
      detectedLanguage: request.sourceLanguage || 'unknown',
      targetLanguage: request.targetLanguage,
      confidence: 0.0,
      formattedMessage: request.text,
      isCached: false,
      timestamp: new Date(),
    };
  }

  /**
   * Check rate limiting
   */
  private async checkRateLimit(): Promise<void> {
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute window
    const maxRequests = 60; // 60 requests per minute

    const key = 'translation-service';
    const tracker = this.rateLimitTracker.get(key);

    if (tracker && now < tracker.resetTime) {
      if (tracker.count >= maxRequests) {
        throw new Error('Translation rate limit exceeded. Please try again later.');
      }
      tracker.count++;
    } else {
      this.rateLimitTracker.set(key, {
        count: 1,
        resetTime: now + windowMs,
      });
    }
  }

  /**
   * Delay utility for retries
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.cache.getStats();
  }

  /**
   * Clear translation cache
   */
  clearCache(): void {
    this.cache.clear();
    logger.info('Translation cache cleared');
  }

  /**
   * Health check method
   */
  async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; details: Record<string, any> }> {
    try {
      // Test a simple translation
      const testResult = await this.translate({
        text: 'Hello',
        targetLanguage: 'th',
      });

      return {
        status: 'healthy',
        details: {
          cacheStats: this.getCacheStats(),
          lastTranslation: {
            success: true,
            confidence: testResult.confidence,
            timestamp: testResult.timestamp,
          },
        },
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        details: {
          error: error instanceof Error ? error.message : String(error),
          cacheStats: this.getCacheStats(),
        },
      };
    }
  }
}

// Export singleton instance
export const translationService = new TranslationService();