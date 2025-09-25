const express = require('express');
const { sendMessage } = require('./services/google-chat-simple');
const { parseWhatsAppMessage, parseLineMessage, isValidMessage } = require('./services/message-processor');
const { routeMessage, aiHealthCheck } = require('./services/message-router');
const { translateMessage, healthCheck: translatorHealthCheck } = require('./services/translator');
const { processGoogleChatWebhook } = require('./webhooks/google-chat');
const { healthCheck: whatsappHealthCheck } = require('./services/whatsapp-sender');
const { healthCheck: lineHealthCheck } = require('./services/line-sender');
const { getStats } = require('./services/conversation-store');
const { startPolling, stopPolling, getStatus: getPollingStatus, getStats: getPollingStats } = require('./services/google-chat-poller');

const app = express();
const PORT = process.env.PORT || 10000;

// Note: Space IDs are now managed by the message-router service

// Parse JSON bodies
app.use(express.json());

// Simple health check endpoint for Docker health checks (no external dependencies)
app.get('/health-simple', (req, res) => {
  res.json({
    status: 'ok',
    service: 'BMA Messenger Hub',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Comprehensive health check endpoint
app.get('/health', async (req, res) => {
  const healthChecks = {};
  let overallStatus = 'ok';

  // Individual health checks with timeouts and error handling
  try {
    healthChecks.ai = await Promise.race([
      aiHealthCheck(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
    ]);
  } catch (error) {
    healthChecks.ai = { status: 'error', message: error.message };
    overallStatus = 'degraded';
  }

  try {
    healthChecks.translator = await Promise.race([
      translatorHealthCheck(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
    ]);
  } catch (error) {
    healthChecks.translator = { status: 'error', message: error.message };
    overallStatus = 'degraded';
  }

  try {
    healthChecks.whatsapp = await Promise.race([
      whatsappHealthCheck(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
    ]);
  } catch (error) {
    healthChecks.whatsapp = { status: 'error', message: error.message };
    overallStatus = 'degraded';
  }

  try {
    healthChecks.line = await Promise.race([
      lineHealthCheck(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
    ]);
  } catch (error) {
    healthChecks.line = { status: 'error', message: error.message };
    overallStatus = 'degraded';
  }

  try {
    healthChecks.conversations = getStats();
  } catch (error) {
    healthChecks.conversations = { error: error.message };
    overallStatus = 'degraded';
  }

  try {
    healthChecks.polling = getPollingStatus();
  } catch (error) {
    healthChecks.polling = { error: error.message };
    overallStatus = 'degraded';
  }

  res.json({
    status: overallStatus,
    service: 'BMA Messenger Hub',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    ...healthChecks
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'BMA Messenger Hub is running',
    version: '1.0.0',
    endpoints: {
      whatsapp: '/webhooks/whatsapp',
      line: '/webhooks/line',
      googleChat: '/webhooks/google-chat',
      health: '/health',
      polling: {
        status: '/polling/status',
        start: '/polling/start',
        stop: '/polling/stop'
      }
    }
  });
});

// WhatsApp webhook verification
app.get('/webhooks/whatsapp', (req, res) => {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'bma_whatsapp_verify_2024';
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('WhatsApp webhook verified');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// WhatsApp webhook messages
app.post('/webhooks/whatsapp', async (req, res) => {
  try {
    console.log('WhatsApp webhook received:', JSON.stringify(req.body, null, 2));

    // Parse the WhatsApp message
    const parsedMessage = parseWhatsAppMessage(req.body);

    if (parsedMessage && isValidMessage(parsedMessage)) {
      console.log('Parsed WhatsApp message:', parsedMessage);

      // Translate message if needed
      const translation = await translateMessage(parsedMessage.messageText);
      console.log(`Translation result: ${translation.isTranslated ? 'translated from ' + translation.originalLanguage : 'no translation needed'}`);

      // Debug log for translation
      if (translation.error) {
        console.error('Translation error:', translation.error);
      }
      if (translation.isTranslated) {
        console.log('Translated text preview:', translation.translatedText.substring(0, 100));
      }

      // Use original text for routing (keyword matching works in any language)
      const textForRouting = parsedMessage.messageText;

      // Route message to appropriate department
      const routing = await routeMessage(textForRouting);
      console.log(`Routing WhatsApp message to ${routing.department} department (source: ${routing.source})`);

      // Send the translated text (or original if no translation) to Google Chat
      const messageToSend = translation.isTranslated ? translation.translatedText : parsedMessage.messageText;
      await sendMessage(routing.spaceId, messageToSend, parsedMessage);
      console.log(`WhatsApp message forwarded to Google Chat ${routing.department} space (${routing.spaceId})`);
    } else {
      console.log('WhatsApp message could not be parsed or is invalid');
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Error processing WhatsApp webhook:', error);
    // Don't crash the service - just log and respond
    res.sendStatus(200);
  }
});

// LINE webhook
app.post('/webhooks/line', async (req, res) => {
  try {
    console.log('LINE webhook received:', JSON.stringify(req.body, null, 2));

    // Parse the LINE message
    const parsedMessage = parseLineMessage(req.body);

    if (parsedMessage && isValidMessage(parsedMessage)) {
      console.log('Parsed LINE message:', parsedMessage);

      // Translate message if needed
      const translation = await translateMessage(parsedMessage.messageText);
      console.log(`Translation result: ${translation.isTranslated ? 'translated from ' + translation.originalLanguage : 'no translation needed'}`);

      // Debug log for translation
      if (translation.error) {
        console.error('Translation error:', translation.error);
      }
      if (translation.isTranslated) {
        console.log('Translated text preview:', translation.translatedText.substring(0, 100));
      }

      // Use original text for routing (keyword matching works in any language)
      const textForRouting = parsedMessage.messageText;

      // Route message to appropriate department
      const routing = await routeMessage(textForRouting);
      console.log(`Routing LINE message to ${routing.department} department (source: ${routing.source})`);

      // Send the translated text (or original if no translation) to Google Chat
      const messageToSend = translation.isTranslated ? translation.translatedText : parsedMessage.messageText;
      await sendMessage(routing.spaceId, messageToSend, parsedMessage);
      console.log(`LINE message forwarded to Google Chat ${routing.department} space (${routing.spaceId})`);
    } else {
      console.log('LINE message could not be parsed or is invalid');
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Error processing LINE webhook:', error);
    // Don't crash the service - just log and respond
    res.sendStatus(200);
  }
});

// Google Chat webhook
app.post('/webhooks/google-chat', async (req, res) => {
  try {
    await processGoogleChatWebhook(req, res);
  } catch (error) {
    console.error('Error processing Google Chat webhook:', error);
    res.status(200).json({
      text: `❌ Error processing message: ${error.message}`
    });
  }
});

// Polling endpoints
app.get('/polling/status', (req, res) => {
  try {
    const status = getPollingStatus();
    res.json({
      status: 'ok',
      polling: status
    });
  } catch (error) {
    res.json({
      status: 'error',
      message: error.message
    });
  }
});

// Debug endpoint for polling diagnostics
app.get('/polling/debug', async (req, res) => {
  try {
    const pollingStatus = getPollingStatus();
    const conversationStats = getStats();
    const pollingStats = getPollingStats();

    // Get recent messages from each space for debugging
    const spaceMessages = {};
    for (const space of ['spaces/AAQA6WeunF8', 'spaces/AAQALSfR5k4', 'spaces/AAQAfKFrdxQ']) {
      try {
        const { listSpaceMessages } = require('./services/google-chat-simple');
        const messages = await listSpaceMessages(space, 5);
        spaceMessages[space] = messages.map(msg => ({
          id: msg.name,
          threadId: msg.thread?.name || 'No thread',
          text: msg.text?.substring(0, 100) || 'No text',
          sender: msg.sender?.displayName || 'Unknown',
          senderType: msg.sender?.type || 'Unknown',
          createTime: msg.createTime
        }));
      } catch (error) {
        spaceMessages[space] = { error: error.message };
      }
    }

    res.json({
      status: 'ok',
      debug: {
        polling: pollingStatus,
        conversations: {
          total: conversationStats.totalConversations,
          active: conversationStats.activeConversations.map(conv => ({
            id: conv.id,
            platform: conv.platform,
            userId: conv.userId,
            threadId: conv.threadId,
            spaceId: conv.spaceId,
            lastActivity: conv.lastActivity
          }))
        },
        recentMessages: spaceMessages,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    res.json({
      status: 'error',
      message: error.message
    });
  }
});

app.post('/polling/start', async (req, res) => {
  try {
    await startPolling();
    const status = getPollingStatus();
    res.json({
      status: 'ok',
      message: 'Google Chat polling started',
      polling: status
    });
  } catch (error) {
    res.json({
      status: 'error',
      message: error.message
    });
  }
});

app.post('/polling/stop', (req, res) => {
  try {
    stopPolling();
    const status = getPollingStatus();
    res.json({
      status: 'ok',
      message: 'Google Chat polling stopped',
      polling: status
    });
  } catch (error) {
    res.json({
      status: 'error',
      message: error.message
    });
  }
});

// Start server only if not being imported (for testing)
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`BMA Messenger Hub is running on port ${PORT}`);
    console.log(`Health check: http://0.0.0.0:${PORT}/health`);
    console.log(`Simple health check: http://0.0.0.0:${PORT}/health-simple`);

    // Start Google Chat polling automatically (non-blocking)
    // TEMPORARILY DISABLED: Auto-start polling to debug deployment issues
    // Use setTimeout to ensure the server is fully started first
    setTimeout(async () => {
      try {
        console.log('Auto-start polling is temporarily disabled for deployment troubleshooting');
        console.log('✅ Server started successfully. Use POST /polling/start to enable polling manually');
        // await startPolling();
        // console.log('✅ Google Chat polling started successfully');
      } catch (error) {
        console.error('❌ Failed to start Google Chat polling:', error.message);
        console.log('⚠️  Service will continue running without polling');
      }
    }, 2000); // Wait 2 seconds after server start
  });
}

// Export app for testing
module.exports = app;