import { logger } from '../../utils/logger';
import { translationService, TranslationRequest } from './index';
import { SupportedLanguage } from './language-detector';
import { ProcessedMessage } from '../../types/webhooks';
import { ProcessedGoogleChatMessage } from '../../integrations/google-chat/webhook';

/**
 * Message routing configuration
 */
export interface MessageRoutingConfig {
  defaultTargetLanguage: SupportedLanguage;
  autoTranslateToEnglish: boolean;
  preserveOriginalMessage: boolean;
  translateBackToOriginal: boolean;
  skipTranslationForLanguages: SupportedLanguage[];
  enableTranslationForPlatforms: Array<'whatsapp' | 'line' | 'google-chat'>;
}

/**
 * Routing decision interface
 */
export interface RoutingDecision {
  shouldTranslate: boolean;
  targetLanguage: string;
  reason: string;
  originalLanguage?: string;
}

/**
 * Translated message for routing
 */
export interface TranslatedMessageForRouting {
  originalMessage: ProcessedMessage | ProcessedGoogleChatMessage;
  translatedContent: string;
  originalLanguage: string;
  targetLanguage: string;
  confidence: number;
  routingDecision: RoutingDecision;
  formattedForDisplay: string;
  metadata: {
    translationTimestamp: Date;
    platform: 'whatsapp' | 'line' | 'google-chat';
    messageType: string;
    preservedOriginal: boolean;
  };
}

/**
 * Message router for handling translation routing decisions
 */
export class MessageRouter {
  private config: MessageRoutingConfig;

  constructor(config?: Partial<MessageRoutingConfig>) {
    this.config = {
      defaultTargetLanguage: SupportedLanguage.ENGLISH,
      autoTranslateToEnglish: true,
      preserveOriginalMessage: true,
      translateBackToOriginal: false,
      skipTranslationForLanguages: [],
      enableTranslationForPlatforms: ['whatsapp', 'line', 'google-chat'],
      ...config,
    };

    logger.info('MessageRouter initialized', {
      config: this.config,
    });
  }

  /**
   * Process WhatsApp message for translation and routing
   */
  async processWhatsAppMessage(message: ProcessedMessage): Promise<TranslatedMessageForRouting | null> {
    try {
      if (message.platform !== 'whatsapp') {
        logger.warn('Invalid platform for WhatsApp message processing', {
          expectedPlatform: 'whatsapp',
          actualPlatform: message.platform,
        });
        return null;
      }

      // Only process text messages
      if (message.content.type !== 'text' || !message.content.text) {
        logger.debug('Skipping non-text WhatsApp message', {
          messageId: message.messageId,
          contentType: message.content.type,
        });
        return null;
      }

      const routingDecision = await this.makeRoutingDecision(
        message.content.text,
        'whatsapp',
        message.senderId
      );

      if (!routingDecision.shouldTranslate) {
        logger.debug('WhatsApp message does not need translation', {
          messageId: message.messageId,
          reason: routingDecision.reason,
        });
        return null;
      }

      // Perform translation
      const translationRequest: TranslationRequest = {
        text: message.content.text,
        sourceLanguage: routingDecision.originalLanguage,
        targetLanguage: routingDecision.targetLanguage,
        preserveOriginal: this.config.preserveOriginalMessage,
        context: {
          platform: 'whatsapp',
          messageType: message.content.type,
          userInfo: {
            id: message.senderId,
          },
        },
      };

      const translationResult = await translationService.translate(translationRequest);

      const translatedMessage: TranslatedMessageForRouting = {
        originalMessage: message,
        translatedContent: translationResult.translatedText,
        originalLanguage: translationResult.detectedLanguage,
        targetLanguage: translationResult.targetLanguage,
        confidence: translationResult.confidence,
        routingDecision,
        formattedForDisplay: translationResult.formattedMessage,
        metadata: {
          translationTimestamp: new Date(),
          platform: 'whatsapp',
          messageType: message.content.type,
          preservedOriginal: this.config.preserveOriginalMessage,
        },
      };

      logger.info('WhatsApp message translated for routing', {
        messageId: message.messageId,
        originalLanguage: translatedMessage.originalLanguage,
        targetLanguage: translatedMessage.targetLanguage,
        confidence: translatedMessage.confidence,
      });

      return translatedMessage;
    } catch (error) {
      logger.error('Failed to process WhatsApp message for translation', {
        messageId: message.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Process LINE message for translation and routing
   */
  async processLineMessage(message: ProcessedMessage): Promise<TranslatedMessageForRouting | null> {
    try {
      if (message.platform !== 'line') {
        logger.warn('Invalid platform for LINE message processing', {
          expectedPlatform: 'line',
          actualPlatform: message.platform,
        });
        return null;
      }

      // Only process text messages
      if (message.content.type !== 'text' || !message.content.text) {
        logger.debug('Skipping non-text LINE message', {
          messageId: message.messageId,
          contentType: message.content.type,
        });
        return null;
      }

      const routingDecision = await this.makeRoutingDecision(
        message.content.text,
        'line',
        message.senderId
      );

      if (!routingDecision.shouldTranslate) {
        logger.debug('LINE message does not need translation', {
          messageId: message.messageId,
          reason: routingDecision.reason,
        });
        return null;
      }

      // Perform translation
      const translationRequest: TranslationRequest = {
        text: message.content.text,
        sourceLanguage: routingDecision.originalLanguage,
        targetLanguage: routingDecision.targetLanguage,
        preserveOriginal: this.config.preserveOriginalMessage,
        context: {
          platform: 'line',
          messageType: message.content.type,
          userInfo: {
            id: message.senderId,
          },
        },
      };

      const translationResult = await translationService.translate(translationRequest);

      const translatedMessage: TranslatedMessageForRouting = {
        originalMessage: message,
        translatedContent: translationResult.translatedText,
        originalLanguage: translationResult.detectedLanguage,
        targetLanguage: translationResult.targetLanguage,
        confidence: translationResult.confidence,
        routingDecision,
        formattedForDisplay: translationResult.formattedMessage,
        metadata: {
          translationTimestamp: new Date(),
          platform: 'line',
          messageType: message.content.type,
          preservedOriginal: this.config.preserveOriginalMessage,
        },
      };

      logger.info('LINE message translated for routing', {
        messageId: message.messageId,
        originalLanguage: translatedMessage.originalLanguage,
        targetLanguage: translatedMessage.targetLanguage,
        confidence: translatedMessage.confidence,
      });

      return translatedMessage;
    } catch (error) {
      logger.error('Failed to process LINE message for translation', {
        messageId: message.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Process Google Chat message for translation and routing
   */
  async processGoogleChatMessage(message: ProcessedGoogleChatMessage): Promise<TranslatedMessageForRouting | null> {
    try {
      // Only process text messages
      if (message.content.type !== 'text' || !message.content.text) {
        logger.debug('Skipping non-text Google Chat message', {
          messageId: message.messageId,
          contentType: message.content.type,
        });
        return null;
      }

      const routingDecision = await this.makeRoutingDecision(
        message.content.text,
        'google-chat',
        message.senderId
      );

      if (!routingDecision.shouldTranslate) {
        logger.debug('Google Chat message does not need translation', {
          messageId: message.messageId,
          reason: routingDecision.reason,
        });
        return null;
      }

      // Perform translation
      const translationRequest: TranslationRequest = {
        text: message.content.text,
        sourceLanguage: routingDecision.originalLanguage,
        targetLanguage: routingDecision.targetLanguage,
        preserveOriginal: this.config.preserveOriginalMessage,
        context: {
          platform: 'google-chat',
          messageType: message.content.type,
          userInfo: {
            id: message.senderId,
            name: message.senderName,
          },
        },
      };

      const translationResult = await translationService.translate(translationRequest);

      const translatedMessage: TranslatedMessageForRouting = {
        originalMessage: message,
        translatedContent: translationResult.translatedText,
        originalLanguage: translationResult.detectedLanguage,
        targetLanguage: translationResult.targetLanguage,
        confidence: translationResult.confidence,
        routingDecision,
        formattedForDisplay: translationResult.formattedMessage,
        metadata: {
          translationTimestamp: new Date(),
          platform: 'google-chat',
          messageType: message.content.type,
          preservedOriginal: this.config.preserveOriginalMessage,
        },
      };

      logger.info('Google Chat message translated for routing', {
        messageId: message.messageId,
        spaceType: message.spaceType,
        originalLanguage: translatedMessage.originalLanguage,
        targetLanguage: translatedMessage.targetLanguage,
        confidence: translatedMessage.confidence,
      });

      return translatedMessage;
    } catch (error) {
      logger.error('Failed to process Google Chat message for translation', {
        messageId: message.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Make routing decision based on message content and context
   */
  private async makeRoutingDecision(
    text: string,
    platform: 'whatsapp' | 'line' | 'google-chat',
    senderId: string
  ): Promise<RoutingDecision> {
    try {
      // Check if translation is enabled for this platform
      if (!this.config.enableTranslationForPlatforms.includes(platform)) {
        return {
          shouldTranslate: false,
          targetLanguage: this.config.defaultTargetLanguage,
          reason: `Translation disabled for ${platform}`,
        };
      }

      // Detect the original language
      const detectedLanguage = await translationService.languageDetector.detectLanguage(text);

      // Check if we should skip translation for this language
      if (this.config.skipTranslationForLanguages.includes(detectedLanguage as SupportedLanguage)) {
        return {
          shouldTranslate: false,
          targetLanguage: this.config.defaultTargetLanguage,
          reason: `Translation skipped for language: ${detectedLanguage}`,
          originalLanguage: detectedLanguage,
        };
      }

      // Check if already in target language
      if (detectedLanguage === this.config.defaultTargetLanguage) {
        return {
          shouldTranslate: false,
          targetLanguage: this.config.defaultTargetLanguage,
          reason: `Message already in target language: ${detectedLanguage}`,
          originalLanguage: detectedLanguage,
        };
      }

      // Determine target language based on routing rules
      let targetLanguage = this.config.defaultTargetLanguage;

      // Special routing rules for Google Chat
      if (platform === 'google-chat') {
        // Always translate to English for Google Spaces for better collaboration
        targetLanguage = SupportedLanguage.ENGLISH;
      }

      // For WhatsApp and LINE, check if we should translate to English or keep original routing
      if (platform === 'whatsapp' || platform === 'line') {
        if (this.config.autoTranslateToEnglish) {
          targetLanguage = SupportedLanguage.ENGLISH;
        }
      }

      return {
        shouldTranslate: true,
        targetLanguage,
        reason: `Translating from ${detectedLanguage} to ${targetLanguage} for ${platform}`,
        originalLanguage: detectedLanguage,
      };
    } catch (error) {
      logger.error('Failed to make routing decision', {
        platform,
        senderId,
        textLength: text.length,
        error: error instanceof Error ? error.message : String(error),
      });

      // Fallback decision
      return {
        shouldTranslate: false,
        targetLanguage: this.config.defaultTargetLanguage,
        reason: `Error in routing decision: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Generate response translation (translate back to original language)
   */
  async translateResponse(
    responseText: string,
    originalMessage: TranslatedMessageForRouting
  ): Promise<string> {
    try {
      if (!this.config.translateBackToOriginal) {
        return responseText;
      }

      // Skip if response is already in the original language
      const responseLanguage = await translationService.languageDetector.detectLanguage(responseText);
      if (responseLanguage === originalMessage.originalLanguage) {
        return responseText;
      }

      // Translate response back to original language
      const translationRequest: TranslationRequest = {
        text: responseText,
        sourceLanguage: responseLanguage,
        targetLanguage: originalMessage.originalLanguage,
        preserveOriginal: this.config.preserveOriginalMessage,
        context: {
          platform: originalMessage.metadata.platform,
          messageType: 'system',
        },
      };

      const translationResult = await translationService.translate(translationRequest);

      logger.info('Response translated back to original language', {
        originalLanguage: originalMessage.originalLanguage,
        responseLanguage,
        confidence: translationResult.confidence,
      });

      return translationResult.formattedMessage;
    } catch (error) {
      logger.error('Failed to translate response back to original language', {
        error: error instanceof Error ? error.message : String(error),
        originalLanguage: originalMessage.originalLanguage,
      });

      // Return original response if translation fails
      return responseText;
    }
  }

  /**
   * Update routing configuration
   */
  updateConfig(newConfig: Partial<MessageRoutingConfig>): void {
    this.config = {
      ...this.config,
      ...newConfig,
    };

    logger.info('Message routing configuration updated', {
      config: this.config,
    });
  }

  /**
   * Get current configuration
   */
  getConfig(): MessageRoutingConfig {
    return { ...this.config };
  }

  /**
   * Get routing statistics
   */
  getRoutingStats() {
    return {
      config: this.config,
      translationServiceStats: translationService.getCacheStats(),
    };
  }

  /**
   * Health check for the message router
   */
  async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; details: Record<string, any> }> {
    try {
      const translationHealth = await translationService.healthCheck();

      return {
        status: translationHealth.status,
        details: {
          router: {
            config: this.config,
            enabledPlatforms: this.config.enableTranslationForPlatforms,
          },
          translation: translationHealth.details,
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
}

// Export singleton instance
export const messageRouter = new MessageRouter();