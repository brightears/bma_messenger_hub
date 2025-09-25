const express = require('express');
const { sendMessage } = require('./services/google-chat-simple');
const { parseWhatsAppMessage, parseLineMessage, isValidMessage } = require('./services/message-processor');

const app = express();
const PORT = process.env.PORT || 10000;

// Google Chat space IDs from environment or defaults
const SALES_SPACE_ID = process.env.GOOGLE_CHAT_SALES_SPACE || 'spaces/AAQAfKFrdxQ';

// Parse JSON bodies
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'BMA Messenger Hub' });
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

      // Forward to Google Chat Sales space
      await sendMessage(SALES_SPACE_ID, parsedMessage.messageText, parsedMessage);
      console.log('WhatsApp message forwarded to Google Chat Sales space');
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

      // Forward to Google Chat Sales space
      await sendMessage(SALES_SPACE_ID, parsedMessage.messageText, parsedMessage);
      console.log('LINE message forwarded to Google Chat Sales space');
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

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`BMA Messenger Hub is running on port ${PORT}`);
  console.log(`Health check: http://0.0.0.0:${PORT}/health`);
});