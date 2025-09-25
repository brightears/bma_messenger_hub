import express from 'express';
import { config } from './config';
import { logger } from './utils/logger';
import { verifyWhatsAppWebhook, handleWhatsAppWebhook } from './api/webhooks/whatsapp';
import { handleLineWebhook } from './api/webhooks/line';
import { handleGoogleChatWebhook } from './integrations/google-chat/webhook';
import {
  translateText,
  batchTranslateTexts,
  detectLanguage,
  getTranslationHealth,
  getTranslationStats,
  getSupportedLanguages,
  clearTranslationCache,
  updateTranslationConfig,
  getRecentTranslationEvents,
} from './api/translation';

// Create Express app
const app = express();

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Add request logging middleware
app.use((req, res, next) => {
  logger.http(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
    contentLength: req.get('content-length'),
  });
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  const healthCheck = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: config.nodeEnv,
    version: process.env.npm_package_version || '1.0.0',
  };

  logger.info('Health check requested', healthCheck);
  res.status(200).json(healthCheck);
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'BMA Messenger Hub API',
    version: process.env.npm_package_version || '1.0.0',
    status: 'running',
    endpoints: {
      health: '/health',
      webhooks: {
        whatsapp: '/webhooks/whatsapp',
        line: '/webhooks/line',
        googleChat: '/webhooks/google-chat',
      },
      translation: {
        translate: '/api/translation/translate',
        batchTranslate: '/api/translation/batch-translate',
        detectLanguage: '/api/translation/detect-language',
        health: '/api/translation/health',
        stats: '/api/translation/stats',
        languages: '/api/translation/languages',
        cache: '/api/translation/cache',
        config: '/api/translation/config',
        events: '/api/translation/events',
      },
    },
  });
});

// WhatsApp Business API Webhook
app.get('/webhooks/whatsapp', verifyWhatsAppWebhook);
app.post('/webhooks/whatsapp', handleWhatsAppWebhook);

// LINE Business API Webhook
app.post('/webhooks/line', handleLineWebhook);

// Google Chat Webhook
app.post('/webhooks/google-chat', handleGoogleChatWebhook);

// Translation API Routes
app.post('/api/translation/translate', translateText);
app.post('/api/translation/batch-translate', batchTranslateTexts);
app.post('/api/translation/detect-language', detectLanguage);
app.get('/api/translation/health', getTranslationHealth);
app.get('/api/translation/stats', getTranslationStats);
app.get('/api/translation/languages', getSupportedLanguages);
app.delete('/api/translation/cache', clearTranslationCache);
app.put('/api/translation/config', updateTranslationConfig);
app.get('/api/translation/events', getRecentTranslationEvents);

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
  });

  res.status(500).json({
    error: 'Internal server error',
    message: config.nodeEnv === 'development' ? err.message : 'Something went wrong',
  });
});

// 404 handler
app.use('*', (req, res) => {
  logger.warn(`404 - Route not found: ${req.method} ${req.originalUrl}`, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });

  res.status(404).json({
    error: 'Not found',
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated');
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start server
const server = app.listen(config.port, () => {
  logger.info(`BMA Messenger Hub started successfully`, {
    port: config.port,
    environment: config.nodeEnv,
    nodeVersion: process.version,
    pid: process.pid,
  });

  logger.info('Webhook endpoints configured:', {
    whatsapp: `/webhooks/whatsapp (verify token: ${config.whatsApp.verifyToken ? '***' : 'not set'})`,
    line: `/webhooks/line (channel secret: ${config.line.channelSecret ? '***' : 'not set'})`,
    googleChat: `/webhooks/google-chat (credentials: ${config.googleChat.credentialsJson ? '***' : 'not set'})`,
  });
});

export { app, server };