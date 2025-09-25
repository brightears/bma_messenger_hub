import { Request, Response } from 'express';
import { logger } from '../utils/logger';
import { translationService, TranslationRequest } from '../services/translation';
import { SupportedLanguage } from '../services/translation/language-detector';
import { messageRouter } from '../services/translation/message-router';
import { webhookTranslationIntegration } from '../services/translation/webhook-integration';

/**
 * Translate text endpoint
 */
export async function translateText(req: Request, res: Response): Promise<void> {
  try {
    const { text, targetLanguage, sourceLanguage, preserveOriginal } = req.body;

    if (!text || !targetLanguage) {
      res.status(400).json({
        error: 'Missing required fields',
        message: 'Both text and targetLanguage are required',
      });
      return;
    }

    if (!Object.values(SupportedLanguage).includes(targetLanguage)) {
      res.status(400).json({
        error: 'Unsupported target language',
        message: `Supported languages: ${Object.values(SupportedLanguage).join(', ')}`,
      });
      return;
    }

    const translationRequest: TranslationRequest = {
      text,
      targetLanguage,
      sourceLanguage,
      preserveOriginal: preserveOriginal ?? true,
      context: {
        platform: 'api',
        messageType: 'text',
      },
    };

    const result = await translationService.translate(translationRequest);

    logger.info('API translation completed', {
      originalLanguage: result.detectedLanguage,
      targetLanguage: result.targetLanguage,
      confidence: result.confidence,
      isCached: result.isCached,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('Translation API error:', {
      error: error instanceof Error ? error.message : String(error),
      body: req.body,
    });

    res.status(500).json({
      error: 'Translation failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Batch translate texts endpoint
 */
export async function batchTranslateTexts(req: Request, res: Response): Promise<void> {
  try {
    const { requests } = req.body;

    if (!Array.isArray(requests) || requests.length === 0) {
      res.status(400).json({
        error: 'Invalid requests',
        message: 'requests must be a non-empty array',
      });
      return;
    }

    if (requests.length > 50) {
      res.status(400).json({
        error: 'Too many requests',
        message: 'Maximum 50 requests per batch',
      });
      return;
    }

    // Validate each request
    for (const [index, request] of requests.entries()) {
      if (!request.text || !request.targetLanguage) {
        res.status(400).json({
          error: 'Invalid request',
          message: `Request ${index}: text and targetLanguage are required`,
        });
        return;
      }

      if (!Object.values(SupportedLanguage).includes(request.targetLanguage)) {
        res.status(400).json({
          error: 'Unsupported target language',
          message: `Request ${index}: Supported languages: ${Object.values(SupportedLanguage).join(', ')}`,
        });
        return;
      }
    }

    const translationRequests: TranslationRequest[] = requests.map((req, index) => ({
      text: req.text,
      targetLanguage: req.targetLanguage,
      sourceLanguage: req.sourceLanguage,
      preserveOriginal: req.preserveOriginal ?? true,
      context: {
        platform: 'api',
        messageType: 'text',
        userInfo: {
          id: `batch_${index}`,
        },
      },
    }));

    const results = await translationService.translateBatch(translationRequests);

    logger.info('Batch translation completed', {
      requestCount: requests.length,
      successfulCount: results.filter(r => r.confidence > 0).length,
    });

    res.json({
      success: true,
      data: results,
    });
  } catch (error) {
    logger.error('Batch translation API error:', {
      error: error instanceof Error ? error.message : String(error),
      requestCount: req.body.requests?.length || 0,
    });

    res.status(500).json({
      error: 'Batch translation failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Detect language endpoint
 */
export async function detectLanguage(req: Request, res: Response): Promise<void> {
  try {
    const { text } = req.body;

    if (!text) {
      res.status(400).json({
        error: 'Missing required field',
        message: 'text is required',
      });
      return;
    }

    const result = await translationService.languageDetector.detectLanguageDetailed(text);

    logger.info('Language detection completed', {
      detectedLanguage: result.language,
      confidence: result.confidence,
      textLength: text.length,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('Language detection API error:', {
      error: error instanceof Error ? error.message : String(error),
      textLength: req.body.text?.length || 0,
    });

    res.status(500).json({
      error: 'Language detection failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Get translation service health
 */
export async function getTranslationHealth(req: Request, res: Response): Promise<void> {
  try {
    const [
      translationHealth,
      routerHealth,
      integrationHealth,
    ] = await Promise.allSettled([
      translationService.healthCheck(),
      messageRouter.healthCheck(),
      webhookTranslationIntegration.healthCheck(),
    ]);

    const health = {
      translationService: translationHealth.status === 'fulfilled'
        ? translationHealth.value
        : { status: 'unhealthy', error: translationHealth.reason },
      messageRouter: routerHealth.status === 'fulfilled'
        ? routerHealth.value
        : { status: 'unhealthy', error: routerHealth.reason },
      webhookIntegration: integrationHealth.status === 'fulfilled'
        ? integrationHealth.value
        : { status: 'unhealthy', error: integrationHealth.reason },
    };

    const overallStatus = Object.values(health).every(h => h.status === 'healthy')
      ? 'healthy'
      : 'unhealthy';

    res.status(overallStatus === 'healthy' ? 200 : 503).json({
      status: overallStatus,
      timestamp: new Date().toISOString(),
      services: health,
    });
  } catch (error) {
    logger.error('Translation health check error:', {
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Get translation statistics
 */
export async function getTranslationStats(req: Request, res: Response): Promise<void> {
  try {
    const cacheStats = translationService.getCacheStats();
    const routingStats = messageRouter.getRoutingStats();
    const webhookStats = webhookTranslationIntegration.getTranslationStats();

    const stats = {
      cache: cacheStats,
      routing: routingStats,
      webhook: webhookStats,
      supportedLanguages: Object.values(SupportedLanguage),
      timestamp: new Date().toISOString(),
    };

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error('Translation stats API error:', {
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'Failed to get translation statistics',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Get supported languages
 */
export function getSupportedLanguages(req: Request, res: Response): void {
  try {
    const languages = Object.values(SupportedLanguage);
    const languageDetails = languages.map(code => ({
      code,
      name: getLanguageName(code),
    }));

    res.json({
      success: true,
      data: {
        languages: languageDetails,
        count: languages.length,
      },
    });
  } catch (error) {
    logger.error('Get supported languages API error:', {
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'Failed to get supported languages',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Clear translation cache
 */
export function clearTranslationCache(req: Request, res: Response): void {
  try {
    translationService.clearCache();

    logger.info('Translation cache cleared via API');

    res.json({
      success: true,
      message: 'Translation cache cleared successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Clear cache API error:', {
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'Failed to clear translation cache',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Update translation configuration
 */
export function updateTranslationConfig(req: Request, res: Response): void {
  try {
    const { messageRouter: routerConfig, webhookIntegration: integrationConfig } = req.body;

    if (routerConfig) {
      messageRouter.updateConfig(routerConfig);
    }

    if (integrationConfig) {
      webhookTranslationIntegration.updateConfig(integrationConfig);
    }

    logger.info('Translation configuration updated via API', {
      routerConfigUpdated: !!routerConfig,
      integrationConfigUpdated: !!integrationConfig,
    });

    res.json({
      success: true,
      message: 'Configuration updated successfully',
      timestamp: new Date().toISOString(),
      currentConfig: {
        messageRouter: messageRouter.getConfig(),
        webhookIntegration: webhookTranslationIntegration.getConfig(),
      },
    });
  } catch (error) {
    logger.error('Update config API error:', {
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'Failed to update translation configuration',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Get recent translation events
 */
export function getRecentTranslationEvents(req: Request, res: Response): void {
  try {
    const limit = parseInt(req.query.limit as string) || 50;

    if (limit < 1 || limit > 500) {
      res.status(400).json({
        error: 'Invalid limit',
        message: 'Limit must be between 1 and 500',
      });
      return;
    }

    const events = webhookTranslationIntegration.getRecentEvents(limit);

    res.json({
      success: true,
      data: {
        events,
        count: events.length,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('Get recent events API error:', {
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'Failed to get recent translation events',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Helper function to get language name from code
 */
function getLanguageName(code: string): string {
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

  return languageNames[code] || code;
}