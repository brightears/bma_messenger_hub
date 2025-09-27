// Load environment variables first
require('dotenv').config();

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const axios = require('axios');
const { sendMessage } = require('./services/google-chat-simple');
const { parseWhatsAppMessage, parseLineMessage, isValidMessage } = require('./services/message-processor');
// Removed message router - using single space now
const { translateMessage, healthCheck: translatorHealthCheck } = require('./services/translator');

// Single Google Chat space for all messages
const SINGLE_SPACE_ID = process.env.GCHAT_SPACE_ID || 'spaces/AAQAfKFrdxQ'; // BMA Chat Support
const { processGoogleChatWebhook } = require('./webhooks/google-chat');
const { healthCheck: whatsappHealthCheck, sendWhatsAppMessage, sendInfoRequest: sendWhatsAppInfoRequest, sendMediaMessage: sendWhatsAppMedia } = require('./services/whatsapp-sender');
const { healthCheck: lineHealthCheck, sendLineMessage, sendInfoRequest: sendLineInfoRequest, sendMediaMessage: sendLineMedia } = require('./services/line-sender');
const { saveFile, getFileUrl, readFile } = require('./services/file-handler');
const { getStats, getConversation } = require('./services/conversation-store');
const { startPolling, stopPolling, getStatus: getPollingStatus, getStats: getPollingStats } = require('./services/google-chat-poller');
const { storeMessage, getHistory, formatForDisplay } = require('./services/message-history');

// Customer info and AI gathering services
const {
  isNewCustomer,
  needsInfo,
  initializeCustomer,
  updateState,
  storeCustomerInfo,
  getCustomerInfo,
  incrementMessageCount,
  markInfoRequestSent,
  wasInfoRequestSent,
  shouldBypass,
  getCustomerStats
} = require('./services/customer-info');

const {
  initializeAIGatherer,
  generateInfoRequest,
  parseCustomerInfo,
  detectLanguage,
  generateFollowUp,
  isAIGatheringEnabled
} = require('./services/ai-gatherer');

const app = express();
const PORT = process.env.PORT || 10000;

// Note: Space IDs are now managed by the message-router service

// Parse JSON bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
    files: 5 // Max 5 files per upload
  },
  fileFilter: (req, file, cb) => {
    // Allowed file types
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif',
      'video/mp4', 'video/mpeg',
      'audio/mpeg', 'audio/wav',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images, videos, audio, PDFs and Office documents are allowed.'));
    }
  }
});

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

  // AI health check removed - no longer using AI routing
  healthChecks.ai = { status: 'disabled', message: 'AI routing not in use (single space mode)' };

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

      // Store incoming message in history
      const phoneNumber = parsedMessage.phoneNumber || parsedMessage.senderId;
      if (phoneNumber) {
        storeMessage(
          phoneNumber,
          parsedMessage.messageText,
          'incoming',
          'whatsapp',
          {
            senderName: parsedMessage.senderName,
            messageId: parsedMessage.messageId
          }
        );
      }

      // Check if this is a new customer or needs info
      const customerIdentifier = phoneNumber;

      // Check if message should bypass info gathering (urgent messages)
      const bypassGathering = shouldBypass(parsedMessage.messageText);

      if (isNewCustomer(customerIdentifier) && !bypassGathering) {
        // Initialize new customer
        initializeCustomer(customerIdentifier, 'whatsapp');
        incrementMessageCount(customerIdentifier);

        // Check if we already sent info request
        if (!wasInfoRequestSent(customerIdentifier)) {
          // Generate and send info request
          const language = await detectLanguage(parsedMessage.messageText);
          const infoRequestMessage = await generateInfoRequest('whatsapp', parsedMessage.messageText, language);

          // Send automated response asking for info
          await sendWhatsAppInfoRequest(phoneNumber, infoRequestMessage);
          markInfoRequestSent(customerIdentifier);

          console.log(`🤖 Sent info request to new customer: ${phoneNumber}`);

          // Store the automated response in message history
          storeMessage(
            phoneNumber,
            infoRequestMessage,
            'outgoing',
            'whatsapp',
            {
              senderName: 'BMA Bot',
              automated: true
            }
          );
        }

        // Don't forward to Google Chat yet - wait for customer info
        console.log('⏸️ Holding message - waiting for customer info');
        res.sendStatus(200);
        return;
      }

      // Check if we're currently gathering info
      if (needsInfo(customerIdentifier) && !bypassGathering) {
        incrementMessageCount(customerIdentifier);

        // Try to parse customer info from their response
        const parsedInfo = await parseCustomerInfo(parsedMessage.messageText);

        if (parsedInfo.name || parsedInfo.businessName) {
          // Store what we got
          storeCustomerInfo(customerIdentifier, {
            name: parsedInfo.name,
            businessName: parsedInfo.businessName
          });

          // Check if we need more info
          if (parsedInfo.needsMoreInfo) {
            const language = await detectLanguage(parsedMessage.messageText);
            const followUp = await generateFollowUp(parsedInfo, language);

            if (followUp) {
              await sendWhatsAppInfoRequest(phoneNumber, followUp);
              console.log(`🤖 Sent follow-up question to customer: ${phoneNumber}`);

              // Store the follow-up in message history
              storeMessage(
                phoneNumber,
                followUp,
                'outgoing',
                'whatsapp',
                {
                  senderName: 'BMA Bot',
                  automated: true
                }
              );

              res.sendStatus(200);
              return;
            }
          }

          // We have enough info - mark as complete
          updateState(customerIdentifier, 'complete');
          console.log(`✅ Customer info complete for: ${phoneNumber}`);
        }
      }

      // Get customer info if available
      const customerInfo = getCustomerInfo(customerIdentifier) || {};

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

      // No routing needed - all messages go to single BMA Chat Support space
      console.log('Forwarding WhatsApp message to BMA Chat Support space');

      // Send the translated text (or original if no translation) to Google Chat
      const messageToSend = translation.isTranslated ? translation.translatedText : parsedMessage.messageText;

      // Include customer info in senderInfo for Google Chat
      const enrichedSenderInfo = {
        ...parsedMessage,
        messageText: parsedMessage.messageText,  // Keep original message for reply context
        customerName: customerInfo.name || parsedMessage.senderName,
        customerBusiness: customerInfo.businessName
      };

      await sendMessage(SINGLE_SPACE_ID, messageToSend, enrichedSenderInfo);
      console.log(`WhatsApp message forwarded to BMA Chat Support space with customer info`);
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

      // Store incoming message in history
      const userId = parsedMessage.senderId;
      const customerIdentifier = userId; // For LINE, use userId as identifier

      if (userId) {
        storeMessage(
          userId,
          parsedMessage.messageText,
          'incoming',
          'line',
          {
            senderName: parsedMessage.senderName,
            messageId: parsedMessage.messageId
          }
        );

        // Increment message count for customer
        incrementMessageCount(customerIdentifier);
      }

      // Check if message should bypass info gathering (urgent keywords)
      const bypassGathering = shouldBypass(parsedMessage.messageText);

      // Check if this is a new customer
      if (isNewCustomer(customerIdentifier) && !bypassGathering) {
        // Initialize new customer
        initializeCustomer(customerIdentifier, 'line');

        // Check if we already sent info request
        if (!wasInfoRequestSent(customerIdentifier)) {
          // Detect language for the info request
          const language = await detectLanguage(parsedMessage.messageText);

          // Generate AI info request
          const infoRequestMessage = await generateInfoRequest('line', parsedMessage.messageText, language);

          // Send info request to LINE user
          const infoResult = await sendLineInfoRequest(userId, infoRequestMessage);

          // Mark that we sent the info request
          markInfoRequestSent(customerIdentifier);

          // Store outgoing info request in history
          if (infoResult.success) {
            storeMessage(
              userId,
              infoRequestMessage,
              'outgoing',
              'line',
              { type: 'info_request' }
            );
          }

          console.log(`🤖 Sent info request to new LINE customer: ${userId}`);
          res.sendStatus(200);
          return; // Don't forward to Google Chat yet
        }
      }

      // Check if customer is in gathering state
      if (needsInfo(customerIdentifier)) {
        // Try to parse customer info from their response
        const parsedInfo = await parseCustomerInfo(parsedMessage.messageText);

        if (parsedInfo && (parsedInfo.name || parsedInfo.businessName)) {
          // Store the customer info
          storeCustomerInfo(customerIdentifier, {
            name: parsedInfo.name,
            businessName: parsedInfo.businessName
          });

          console.log(`✅ Customer info complete for LINE user: ${userId}`);
        }

        // Check if we need follow-up
        if (parsedInfo && parsedInfo.needsMoreInfo) {
          const language = await detectLanguage(parsedMessage.messageText);
          const followUp = await generateFollowUp(parsedInfo, language);

          if (followUp) {
            await sendLineInfoRequest(userId, followUp);
            storeMessage(userId, followUp, 'outgoing', 'line', { type: 'follow_up' });
            console.log(`📝 Sent follow-up question to LINE user: ${userId}`);
            res.sendStatus(200);
            return; // Still gathering info
          }
        }
      }

      // Get customer info for enrichment
      const customerInfo = getCustomerInfo(customerIdentifier);

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

      // No routing needed - all messages go to single BMA Chat Support space
      console.log('Forwarding LINE message to BMA Chat Support space');

      // Send the translated text (or original if no translation) to Google Chat
      const messageToSend = translation.isTranslated ? translation.translatedText : parsedMessage.messageText;
      // Include customer info and original message in senderInfo for reply portal
      const enrichedSenderInfo = {
        ...parsedMessage,
        messageText: parsedMessage.messageText,  // Keep original message for reply context
        customerName: customerInfo?.name,
        customerBusiness: customerInfo?.businessName
      };
      await sendMessage(SINGLE_SPACE_ID, messageToSend, enrichedSenderInfo);
      console.log(`LINE message forwarded to BMA Chat Support space with customer info`);
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

    // Get recent messages from the single BMA Chat Support space
    const spaceMessages = {};
    try {
      const { listSpaceMessages } = require('./services/google-chat-simple');
      const messages = await listSpaceMessages(SINGLE_SPACE_ID, 10);
      spaceMessages['BMA_Chat_Support'] = messages.map(msg => ({
        id: msg.name,
        threadId: msg.thread?.name || 'No thread',
        text: msg.text?.substring(0, 100) || 'No text',
        sender: msg.sender?.displayName || 'Unknown',
        senderType: msg.sender?.type || 'Unknown',
        createTime: msg.createTime
      }));
    } catch (error) {
      spaceMessages['BMA_Chat_Support'] = { error: error.message };
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

// Reply portal endpoints
app.get('/reply/:conversationId', (req, res) => {
  const { conversationId } = req.params;
  const conversation = getConversation(conversationId);

  if (!conversation) {
    res.status(404).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Conversation Not Found</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5; }
          .error { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          h1 { color: #d32f2f; }
        </style>
      </head>
      <body>
        <div class="error">
          <h1>❌ Conversation Not Found</h1>
          <p>This conversation has expired or does not exist.</p>
          <p>Conversations expire after 24 hours.</p>
        </div>
      </body>
      </html>
    `);
    return;
  }

  const platformIcon = conversation.platform === 'whatsapp' ? '💬' : '📱';
  const platformName = conversation.platform.toUpperCase();

  // Get 24-hour message history
  const identifier = conversation.platform === 'whatsapp'
    ? (conversation.senderInfo.phoneNumber || conversation.userId)
    : conversation.userId;
  const messageHistory = getHistory(identifier);
  const formattedHistory = formatForDisplay(messageHistory);

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Reply to ${platformName} Message</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
          padding: 20px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          margin: 0;
        }
        .container {
          max-width: 600px;
          margin: 0 auto;
          background: white;
          border-radius: 12px;
          box-shadow: 0 20px 40px rgba(0,0,0,0.1);
          overflow: hidden;
        }
        .header {
          background: #7c3aed;
          color: white;
          padding: 20px;
          font-size: 20px;
          font-weight: bold;
        }
        .content {
          padding: 20px;
        }
        .info-box {
          background: #f8f9fa;
          border-left: 4px solid #7c3aed;
          padding: 15px;
          margin-bottom: 20px;
          border-radius: 4px;
        }
        .info-row {
          margin: 8px 0;
          color: #495057;
        }
        .info-label {
          font-weight: 600;
          color: #212529;
        }
        .message-history {
          max-height: 400px;
          overflow-y: auto;
          margin-bottom: 20px;
          padding: 10px;
          background: #f8f9fa;
          border-radius: 8px;
          border: 1px solid #e0e0e0;
        }
        .message {
          margin: 10px 0;
          padding: 10px 15px;
          border-radius: 12px;
          max-width: 70%;
          word-wrap: break-word;
        }
        .message-incoming {
          background: #e3f2fd;
          margin-right: auto;
          border-bottom-left-radius: 4px;
        }
        .message-outgoing {
          background: #f5f5f5;
          margin-left: auto;
          text-align: right;
          border-bottom-right-radius: 4px;
        }
        .message-time {
          font-size: 11px;
          color: #666;
          margin-top: 4px;
        }
        .message-sender {
          font-weight: 600;
          font-size: 12px;
          color: #555;
          margin-bottom: 4px;
        }
        textarea {
          width: 100%;
          min-height: 150px;
          padding: 12px;
          border: 2px solid #e0e0e0;
          border-radius: 8px;
          font-size: 16px;
          font-family: inherit;
          resize: vertical;
          box-sizing: border-box;
        }
        textarea:focus {
          outline: none;
          border-color: #7c3aed;
        }
        .button-group {
          display: flex;
          gap: 10px;
          margin-top: 20px;
        }
        button {
          flex: 1;
          padding: 12px 24px;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s;
        }
        .send-btn {
          background: #7c3aed;
          color: white;
        }
        .send-btn:hover:not(:disabled) {
          background: #6d28d9;
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(124, 58, 237, 0.3);
        }
        .send-btn:disabled {
          background: #9ca3af;
          cursor: not-allowed;
        }
        .cancel-btn {
          background: #f3f4f6;
          color: #374151;
        }
        .cancel-btn:hover {
          background: #e5e7eb;
        }
        .success-message {
          display: none;
          background: #10b981;
          color: white;
          padding: 15px;
          border-radius: 8px;
          margin-top: 20px;
          text-align: center;
          font-weight: 600;
        }
        .error-message {
          display: none;
          background: #ef4444;
          color: white;
          padding: 15px;
          border-radius: 8px;
          margin-top: 20px;
        }
        .char-count {
          text-align: right;
          color: #6b7280;
          font-size: 14px;
          margin-top: 5px;
        }
        .file-upload-zone {
          border: 2px dashed #cbd5e0;
          border-radius: 8px;
          padding: 20px;
          text-align: center;
          margin-top: 15px;
          cursor: pointer;
          transition: all 0.3s;
        }
        .file-upload-zone:hover {
          border-color: #7c3aed;
          background: #f9fafb;
        }
        .file-input {
          display: none;
        }
        .file-list {
          margin-top: 15px;
        }
        .file-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 12px;
          background: #f3f4f6;
          border-radius: 6px;
          margin-bottom: 8px;
        }
        .file-item button {
          background: none;
          border: none;
          cursor: pointer;
          padding: 0 5px;
          font-size: 16px;
          flex: none;
        }
        .platform-warning {
          background: #fef3c7;
          color: #92400e;
          padding: 12px;
          border-radius: 8px;
          margin-top: 10px;
          font-size: 14px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          ${platformIcon} Reply to ${platformName} Message
        </div>
        <div class="content">
          <div class="info-box">
            <div class="info-row">
              <span class="info-label">Platform:</span> ${platformName}
            </div>
            <div class="info-row">
              <span class="info-label">From:</span> ${conversation.senderInfo.senderName || 'Unknown'}
            </div>
            ${conversation.senderInfo.phoneNumber ? `
              <div class="info-row">
                <span class="info-label">Phone:</span> ${conversation.senderInfo.phoneNumber}
              </div>
            ` : ''}
            <div class="info-row">
              <span class="info-label">Time:</span> ${new Date(conversation.createdAt).toLocaleString('en-US', { timeZone: 'Asia/Bangkok' })}
            </div>
          </div>

          <div>
            <h3>📨 24-Hour Message History:</h3>
            <div class="message-history" id="messageHistory">
              ${formattedHistory.length > 0 ? formattedHistory.map(msg => `
                <div class="message message-${msg.direction}" style="${msg.direction === 'outgoing' ? 'display: flex; flex-direction: column; align-items: flex-end;' : ''}">
                  <div class="message-sender">${msg.senderName}</div>
                  <div>${msg.text}</div>
                  <div class="message-time">${msg.timestamp}</div>
                </div>
              `).join('') : `
                <div class="message message-incoming">
                  <div class="message-sender">${conversation.senderInfo.senderName || 'Customer'}</div>
                  <div>${conversation.senderInfo.messageText || 'No message text available'}</div>
                  <div class="message-time">Just now</div>
                </div>
              `}
            </div>
          </div>

          <form id="replyForm" action="/reply/${conversationId}" method="POST">
            <h3>✏️ Your Reply:</h3>
            <textarea
              name="replyText"
              id="replyText"
              placeholder="Type your reply here..."
              required
              maxlength="4096"
            ></textarea>
            <div class="char-count"><span id="charCount">0</span> / 4096</div>

            <div class="file-upload-zone" id="fileUploadZone">
              <input type="file" id="fileInput" class="file-input" multiple />
              <div>
                📁 Drag files here or <span style="color: #7c3aed; text-decoration: underline;">click to browse</span>
              </div>
              <div style="font-size: 14px; color: #718096; margin-top: 8px;">
                ${conversation.platform === 'whatsapp'
                  ? 'Supported: PDF, Word, Excel, Images, Videos (max 100MB)'
                  : 'LINE only supports: Images (JPG, PNG) and Videos (MP4)'}
              </div>
            </div>

            <div id="fileList" class="file-list"></div>

            ${conversation.platform === 'line' ? `
              <div class="platform-warning" id="lineWarning" style="display: none;">
                ⚠️ LINE doesn't support document files. Only images and videos will be sent.
              </div>
            ` : ''}

            <div class="button-group">
              <button type="button" class="cancel-btn" onclick="window.close()">❌ Cancel</button>
              <button type="submit" class="send-btn" id="sendBtn">📤 Send Reply</button>
            </div>
          </form>

          <div class="success-message" id="successMessage">
            ✅ Reply sent successfully!<br>
            <span style="font-weight: normal; font-size: 14px;">You can now close this window.</span>
          </div>
          <div class="error-message" id="errorMessage"></div>
        </div>
      </div>

      <script>
        const textarea = document.getElementById('replyText');
        const charCount = document.getElementById('charCount');
        const form = document.getElementById('replyForm');
        const sendBtn = document.getElementById('sendBtn');
        const successMessage = document.getElementById('successMessage');
        const errorMessage = document.getElementById('errorMessage');
        const fileInput = document.getElementById('fileInput');
        const fileUploadZone = document.getElementById('fileUploadZone');
        const fileList = document.getElementById('fileList');

        let selectedFiles = [];

        textarea.addEventListener('input', () => {
          charCount.textContent = textarea.value.length;
        });

        // File upload handling
        if (fileUploadZone && fileInput) {
          // Click to browse
          fileUploadZone.addEventListener('click', () => {
            fileInput.click();
          });

          // Drag and drop
          fileUploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            fileUploadZone.style.background = '#f3f0ff';
          });

          fileUploadZone.addEventListener('dragleave', () => {
            fileUploadZone.style.background = '';
          });

          fileUploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            fileUploadZone.style.background = '';
            handleFiles(e.dataTransfer.files);
          });

          fileInput.addEventListener('change', (e) => {
            handleFiles(e.target.files);
          });
        }

        function handleFiles(files) {
          selectedFiles = Array.from(files);
          displayFiles();
        }

        function displayFiles() {
          if (!fileList) return;

          fileList.innerHTML = '';
          selectedFiles.forEach((file, index) => {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-item';
            fileItem.innerHTML = \`
              <span>📎 \${file.name} (\${formatFileSize(file.size)})</span>
              <button type="button" onclick="removeFile(\${index})">❌</button>
            \`;
            fileList.appendChild(fileItem);
          });
        }

        function removeFile(index) {
          selectedFiles.splice(index, 1);
          displayFiles();
        }

        function formatFileSize(bytes) {
          if (bytes === 0) return '0 Bytes';
          const k = 1024;
          const sizes = ['Bytes', 'KB', 'MB', 'GB'];
          const i = Math.floor(Math.log(bytes) / Math.log(k));
          return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
        }

        form.addEventListener('submit', async (e) => {
          e.preventDefault();

          sendBtn.disabled = true;
          sendBtn.textContent = '🔄 Sending...';
          errorMessage.style.display = 'none';

          try {
            // Create FormData
            const formData = new FormData();
            formData.append('replyText', textarea.value);

            // Add files
            selectedFiles.forEach(file => {
              formData.append('files', file);
            });

            const response = await fetch(form.action, {
              method: 'POST',
              body: formData
              // Don't set Content-Type header - browser will set it with boundary for multipart
            });

            const result = await response.json();

            if (result.success) {
              successMessage.style.display = 'block';
              form.style.display = 'none';
              // Don't try to close window - it doesn't work for user-opened tabs
              // User will close it manually
            } else {
              throw new Error(result.error || 'Failed to send reply');
            }
          } catch (error) {
            errorMessage.textContent = '❌ Error: ' + error.message;
            errorMessage.style.display = 'block';
            sendBtn.disabled = false;
            sendBtn.textContent = '📤 Send Reply';
          }
        });

        // Auto-focus textarea
        textarea.focus();

        // Scroll message history to bottom
        const messageHistory = document.getElementById('messageHistory');
        if (messageHistory) {
          messageHistory.scrollTop = messageHistory.scrollHeight;
        }
      </script>
    </body>
    </html>
  `);
});

// Handle reply submission with file uploads
app.post('/reply/:conversationId', upload.array('files', 5), async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { replyText } = req.body;
    const files = req.files || [];

    // At least text or files must be provided
    if ((!replyText || replyText.trim().length === 0) && files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Either reply text or files must be provided'
      });
    }

    // Get conversation details
    const conversation = getConversation(conversationId);
    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found or expired'
      });
    }

    const identifier = conversation.platform === 'whatsapp'
      ? (conversation.senderInfo.phoneNumber || conversation.userId)
      : conversation.userId;

    // Process uploaded files
    const savedFiles = [];
    for (const file of files) {
      const savedFile = await saveFile(file.buffer, file.originalname, file.mimetype);
      savedFiles.push({
        ...savedFile,
        url: getFileUrl(savedFile.id, savedFile.filename)
      });
    }

    // Send messages based on platform
    let results = [];

    if (conversation.platform === 'whatsapp') {
      const phoneNumber = conversation.senderInfo.phoneNumber || conversation.userId;

      // Send text message if provided
      if (replyText && replyText.trim()) {
        const textResult = await sendWhatsAppMessage(phoneNumber, replyText);
        results.push(textResult);
      }

      // Send media messages for each file
      for (const file of savedFiles) {
        const mediaResult = await sendWhatsAppMedia(phoneNumber, file);
        results.push(mediaResult);
      }

    } else if (conversation.platform === 'line') {
      // Send text message if provided
      if (replyText && replyText.trim()) {
        const textResult = await sendLineMessage(conversation.userId, replyText);
        results.push(textResult);
      }

      // Send media messages for supported file types
      for (const file of savedFiles) {
        // LINE only supports images and videos
        if (file.mimeType.startsWith('image/') || file.mimeType.startsWith('video/')) {
          const mediaResult = await sendLineMedia(conversation.userId, file);
          results.push(mediaResult);
        } else {
          console.log(`⚠️ LINE doesn't support ${file.mimeType} files, skipping ${file.originalName}`);
        }
      }

    } else {
      return res.status(400).json({
        success: false,
        error: `Unsupported platform: ${conversation.platform}`
      });
    }

    // Check if any message was sent successfully
    const anySuccess = results.some(r => r && r.success);

    if (anySuccess) {
      // Store outgoing message in history
      const messageContent = replyText || `[Sent ${files.length} file(s)]`;
      storeMessage(
        identifier,
        messageContent,
        'outgoing',
        conversation.platform,
        {
          agentName: 'Support Agent',
          files: savedFiles.map(f => ({
            name: f.originalName,
            type: f.mimeType,
            url: f.url
          }))
        }
      );

      console.log(`✅ Reply sent via portal to ${conversation.platform} user ${conversation.userId}`);
      res.json({
        success: true,
        message: 'Reply sent successfully',
        platform: conversation.platform,
        userId: conversation.userId,
        filesCount: savedFiles.length
      });
    } else {
      const errors = results.filter(r => !r.success).map(r => r.error).join(', ');
      res.status(500).json({
        success: false,
        error: errors || 'Failed to send reply'
      });
    }

  } catch (error) {
    console.error('Error processing reply:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Serve uploaded files
app.get('/files/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const file = await readFile(filename);

    res.set('Content-Type', file.mimeType);
    res.set('Content-Length', file.size);
    res.send(file.data);
  } catch (error) {
    console.error('Error serving file:', error);
    res.status(404).json({ error: 'File not found' });
  }
});

// Start server only if not being imported (for testing)
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`BMA Messenger Hub is running on port ${PORT}`);
    console.log(`Health check: http://0.0.0.0:${PORT}/health`);
    console.log(`Simple health check: http://0.0.0.0:${PORT}/health-simple`);

    // Polling disabled - Google Chat bots cannot read thread replies via API
    // Must use webhooks for bidirectional messaging
    console.log('✅ Server started successfully');
    console.log('ℹ️  Google Chat polling is disabled - use webhooks for replies');
    console.log('ℹ️  Configure Google Chat webhook URL: https://bma-messenger-hub-ooyy.onrender.com/webhooks/google-chat');
  });
}

// Export app for testing
module.exports = app;