const express = require('express');
const { sendMessage } = require('./services/google-chat-simple');
const { parseWhatsAppMessage, parseLineMessage, isValidMessage } = require('./services/message-processor');
const { routeMessage, aiHealthCheck } = require('./services/message-router');
const { translateMessage, healthCheck: translatorHealthCheck } = require('./services/translator');

const app = express();
const PORT = process.env.PORT || 10000;

// Note: Space IDs are now managed by the message-router service

// Parse JSON bodies
app.use(express.json());

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const aiHealth = await aiHealthCheck();
    const translatorHealth = await translatorHealthCheck();
    res.json({
      status: 'ok',
      service: 'BMA Messenger Hub',
      ai: aiHealth,
      translator: translatorHealth
    });
  } catch (error) {
    res.json({
      status: 'ok',
      service: 'BMA Messenger Hub',
      ai: { status: 'error', message: error.message },
      translator: { status: 'error', message: error.message }
    });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'BMA Messenger Hub is running',
    version: '1.0.0',
    endpoints: {
      whatsapp: '/webhooks/whatsapp',
      line: '/webhooks/line',
      health: '/health'
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

// Start server only if not being imported (for testing)
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`BMA Messenger Hub is running on port ${PORT}`);
    console.log(`Health check: http://0.0.0.0:${PORT}/health`);
  });
}

// Export app for testing
module.exports = app;