import { logger } from '../../utils/logger';
import { messageRouter, TranslatedMessageForRouting } from './message-router';
import { ProcessedMessage } from '../../types/webhooks';
import { ProcessedGoogleChatMessage } from '../../integrations/google-chat/webhook';

/**
 * Integration configuration for webhook translation
 */
export interface WebhookIntegrationConfig {
  enableAutoTranslation: boolean;
  logTranslationResults: boolean;
  forwardTranslatedMessages: boolean;
  notifyOnTranslationErrors: boolean;
  confidenceThreshold: number;
}

/**
 * Translation event interface for webhook integration
 */
export interface TranslationEvent {
  messageId: string;
  platform: 'whatsapp' | 'line' | 'google-chat';
  originalText: string;
  translatedText: string;
  originalLanguage: string;
  targetLanguage: string;
  confidence: number;
  timestamp: Date;
  success: boolean;
  error?: string;
}

/**
 * Webhook translation integration class
 */
export class WebhookTranslationIntegration {
  private config: WebhookIntegrationConfig;
  private translationEvents: TranslationEvent[] = [];
  private readonly maxEventHistory = 1000;

  constructor(config?: Partial<WebhookIntegrationConfig>) {
    this.config = {
      enableAutoTranslation: true,
      logTranslationResults: true,
      forwardTranslatedMessages: true,
      notifyOnTranslationErrors: true,
      confidenceThreshold: 0.7,
      ...config,
    };

    logger.info('WebhookTranslationIntegration initialized', {
      config: this.config,
    });
  }

  /**
   * Process WhatsApp message with translation
   */
  async processWhatsAppMessage(message: ProcessedMessage): Promise<TranslatedMessageForRouting | null> {
    if (!this.config.enableAutoTranslation) {
      return null;
    }

    try {
      const translatedMessage = await messageRouter.processWhatsAppMessage(message);

      if (translatedMessage) {
        await this.recordTranslationEvent({
          messageId: message.messageId,
          platform: 'whatsapp',
          originalText: translatedMessage.originalMessage.content.text || '',
          translatedText: translatedMessage.translatedContent,
          originalLanguage: translatedMessage.originalLanguage,
          targetLanguage: translatedMessage.targetLanguage,
          confidence: translatedMessage.confidence,
          timestamp: new Date(),
          success: true,
        });

        if (this.config.logTranslationResults) {
          logger.info('WhatsApp message translated successfully', {
            messageId: message.messageId,
            senderId: message.senderId,
            originalLanguage: translatedMessage.originalLanguage,
            targetLanguage: translatedMessage.targetLanguage,
            confidence: translatedMessage.confidence,
            textLength: translatedMessage.originalMessage.content.text?.length || 0,
          });
        }

        // Check confidence threshold
        if (translatedMessage.confidence < this.config.confidenceThreshold) {
          logger.warn('WhatsApp translation confidence below threshold', {
            messageId: message.messageId,
            confidence: translatedMessage.confidence,
            threshold: this.config.confidenceThreshold,
          });
        }
      }

      return translatedMessage;
    } catch (error) {
      await this.recordTranslationEvent({
        messageId: message.messageId,
        platform: 'whatsapp',
        originalText: message.content.text || '',
        translatedText: '',
        originalLanguage: 'unknown',
        targetLanguage: 'unknown',
        confidence: 0,
        timestamp: new Date(),
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });

      if (this.config.notifyOnTranslationErrors) {
        logger.error('WhatsApp message translation failed', {
          messageId: message.messageId,
          senderId: message.senderId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return null;
    }
  }

  /**
   * Process LINE message with translation
   */
  async processLineMessage(message: ProcessedMessage): Promise<TranslatedMessageForRouting | null> {
    if (!this.config.enableAutoTranslation) {
      return null;
    }

    try {
      const translatedMessage = await messageRouter.processLineMessage(message);

      if (translatedMessage) {
        await this.recordTranslationEvent({
          messageId: message.messageId,
          platform: 'line',
          originalText: translatedMessage.originalMessage.content.text || '',
          translatedText: translatedMessage.translatedContent,
          originalLanguage: translatedMessage.originalLanguage,
          targetLanguage: translatedMessage.targetLanguage,
          confidence: translatedMessage.confidence,
          timestamp: new Date(),
          success: true,
        });

        if (this.config.logTranslationResults) {
          logger.info('LINE message translated successfully', {
            messageId: message.messageId,
            senderId: message.senderId,
            originalLanguage: translatedMessage.originalLanguage,
            targetLanguage: translatedMessage.targetLanguage,
            confidence: translatedMessage.confidence,
            textLength: translatedMessage.originalMessage.content.text?.length || 0,
          });
        }

        // Check confidence threshold
        if (translatedMessage.confidence < this.config.confidenceThreshold) {
          logger.warn('LINE translation confidence below threshold', {
            messageId: message.messageId,
            confidence: translatedMessage.confidence,
            threshold: this.config.confidenceThreshold,
          });
        }
      }

      return translatedMessage;
    } catch (error) {
      await this.recordTranslationEvent({
        messageId: message.messageId,
        platform: 'line',
        originalText: message.content.text || '',
        translatedText: '',
        originalLanguage: 'unknown',
        targetLanguage: 'unknown',
        confidence: 0,
        timestamp: new Date(),
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });

      if (this.config.notifyOnTranslationErrors) {
        logger.error('LINE message translation failed', {
          messageId: message.messageId,
          senderId: message.senderId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return null;
    }
  }

  /**
   * Process Google Chat message with translation
   */
  async processGoogleChatMessage(message: ProcessedGoogleChatMessage): Promise<TranslatedMessageForRouting | null> {
    if (!this.config.enableAutoTranslation) {
      return null;
    }

    try {
      const translatedMessage = await messageRouter.processGoogleChatMessage(message);

      if (translatedMessage) {
        await this.recordTranslationEvent({
          messageId: message.messageId,
          platform: 'google-chat',
          originalText: translatedMessage.originalMessage.content.text || '',
          translatedText: translatedMessage.translatedContent,
          originalLanguage: translatedMessage.originalLanguage,
          targetLanguage: translatedMessage.targetLanguage,
          confidence: translatedMessage.confidence,
          timestamp: new Date(),
          success: true,
        });

        if (this.config.logTranslationResults) {
          logger.info('Google Chat message translated successfully', {
            messageId: message.messageId,
            spaceType: message.spaceType,
            senderName: message.senderName,
            originalLanguage: translatedMessage.originalLanguage,
            targetLanguage: translatedMessage.targetLanguage,
            confidence: translatedMessage.confidence,
            textLength: translatedMessage.originalMessage.content.text?.length || 0,
          });
        }

        // Check confidence threshold
        if (translatedMessage.confidence < this.config.confidenceThreshold) {
          logger.warn('Google Chat translation confidence below threshold', {
            messageId: message.messageId,
            confidence: translatedMessage.confidence,
            threshold: this.config.confidenceThreshold,
          });
        }
      }

      return translatedMessage;
    } catch (error) {
      await this.recordTranslationEvent({
        messageId: message.messageId,
        platform: 'google-chat',
        originalText: message.content.text || '',
        translatedText: '',
        originalLanguage: 'unknown',
        targetLanguage: 'unknown',
        confidence: 0,
        timestamp: new Date(),
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });

      if (this.config.notifyOnTranslationErrors) {
        logger.error('Google Chat message translation failed', {
          messageId: message.messageId,
          senderName: message.senderName,
          spaceType: message.spaceType,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return null;
    }
  }

  /**
   * Generate response with translation back to original language
   */
  async generateTranslatedResponse(
    responseText: string,
    originalMessage: TranslatedMessageForRouting
  ): Promise<string> {
    if (!this.config.enableAutoTranslation) {
      return responseText;
    }

    try {
      const translatedResponse = await messageRouter.translateResponse(responseText, originalMessage);

      logger.info('Response translated back to original language', {
        messageId: originalMessage.originalMessage.messageId,
        platform: originalMessage.metadata.platform,
        originalLanguage: originalMessage.originalLanguage,
        responseLength: responseText.length,
        translatedLength: translatedResponse.length,
      });

      return translatedResponse;
    } catch (error) {
      logger.error('Failed to translate response back to original language', {
        messageId: originalMessage.originalMessage.messageId,
        platform: originalMessage.metadata.platform,
        error: error instanceof Error ? error.message : String(error),
      });

      // Return original response if translation fails
      return responseText;
    }
  }

  /**
   * Record translation event for analytics
   */
  private async recordTranslationEvent(event: TranslationEvent): Promise<void> {
    // Add to in-memory history
    this.translationEvents.push(event);

    // Maintain history limit
    if (this.translationEvents.length > this.maxEventHistory) {
      this.translationEvents.shift(); // Remove oldest event
    }

    // Here you could also save to a database or send to analytics service
    // Example: await this.saveToDatabase(event);
  }

  /**
   * Get translation statistics
   */
  getTranslationStats(): {
    total: number;
    successful: number;
    failed: number;
    successRate: number;
    byPlatform: Record<string, { successful: number; failed: number }>;
    byLanguagePair: Record<string, number>;
    averageConfidence: number;
    recentEvents: TranslationEvent[];
  } {
    const total = this.translationEvents.length;
    const successful = this.translationEvents.filter(e => e.success).length;
    const failed = total - successful;
    const successRate = total > 0 ? (successful / total) * 100 : 0;

    // Group by platform
    const byPlatform: Record<string, { successful: number; failed: number }> = {};
    this.translationEvents.forEach(event => {
      if (!byPlatform[event.platform]) {
        byPlatform[event.platform] = { successful: 0, failed: 0 };
      }
      if (event.success) {
        byPlatform[event.platform].successful++;
      } else {
        byPlatform[event.platform].failed++;
      }
    });

    // Group by language pair
    const byLanguagePair: Record<string, number> = {};
    this.translationEvents
      .filter(e => e.success)
      .forEach(event => {
        const pair = `${event.originalLanguage}->${event.targetLanguage}`;
        byLanguagePair[pair] = (byLanguagePair[pair] || 0) + 1;
      });

    // Calculate average confidence
    const successfulEvents = this.translationEvents.filter(e => e.success);
    const averageConfidence = successfulEvents.length > 0
      ? successfulEvents.reduce((sum, e) => sum + e.confidence, 0) / successfulEvents.length
      : 0;

    // Get recent events (last 10)
    const recentEvents = this.translationEvents.slice(-10);

    return {
      total,
      successful,
      failed,
      successRate: Math.round(successRate * 100) / 100,
      byPlatform,
      byLanguagePair,
      averageConfidence: Math.round(averageConfidence * 10000) / 10000,
      recentEvents,
    };
  }

  /**
   * Get recent translation events
   */
  getRecentEvents(limit: number = 50): TranslationEvent[] {
    return this.translationEvents.slice(-limit);
  }

  /**
   * Clear translation event history
   */
  clearEventHistory(): void {
    const previousCount = this.translationEvents.length;
    this.translationEvents = [];

    logger.info('Translation event history cleared', {
      previousCount,
      currentCount: this.translationEvents.length,
    });
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<WebhookIntegrationConfig>): void {
    this.config = {
      ...this.config,
      ...newConfig,
    };

    logger.info('WebhookTranslationIntegration configuration updated', {
      config: this.config,
    });
  }

  /**
   * Get current configuration
   */
  getConfig(): WebhookIntegrationConfig {
    return { ...this.config };
  }

  /**
   * Health check for webhook integration
   */
  async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; details: Record<string, any> }> {
    try {
      const routerHealth = await messageRouter.healthCheck();
      const stats = this.getTranslationStats();

      const isHealthy = routerHealth.status === 'healthy' && stats.successRate > 80;

      return {
        status: isHealthy ? 'healthy' : 'unhealthy',
        details: {
          config: this.config,
          stats,
          router: routerHealth.details,
          eventHistorySize: this.translationEvents.length,
        },
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        details: {
          error: error instanceof Error ? error.message : String(error),
          config: this.config,
        },
      };
    }
  }

  /**
   * Export translation events for backup or analysis
   */
  exportEvents(): TranslationEvent[] {
    return [...this.translationEvents];
  }

  /**
   * Import translation events from backup
   */
  importEvents(events: TranslationEvent[]): void {
    this.translationEvents = events.slice(-this.maxEventHistory);

    logger.info('Translation events imported', {
      importedCount: events.length,
      currentCount: this.translationEvents.length,
    });
  }
}

// Export singleton instance
export const webhookTranslationIntegration = new WebhookTranslationIntegration();