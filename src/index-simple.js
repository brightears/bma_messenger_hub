const express = require('express');
const { sendMessage } = require('./services/google-chat-simple');
const { parseWhatsAppMessage, parseLineMessage, isValidMessage } = require('./services/message-processor');
const { routeMessage, aiHealthCheck } = require('./services/message-router');
const { translateMessage, healthCheck: translatorHealthCheck } = require('./services/translator');
const { processGoogleChatWebhook } = require('./webhooks/google-chat');
const { healthCheck: whatsappHealthCheck, sendWhatsAppMessage } = require('./services/whatsapp-sender');
const { healthCheck: lineHealthCheck, sendLineMessage } = require('./services/line-sender');
const { getStats, getConversation } = require('./services/conversation-store');
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
      // Include original message in senderInfo for reply portal
      const enrichedSenderInfo = {
        ...parsedMessage,
        messageText: parsedMessage.messageText  // Keep original message for reply context
      };
      await sendMessage(routing.spaceId, messageToSend, enrichedSenderInfo);
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
      // Include original message in senderInfo for reply portal
      const enrichedSenderInfo = {
        ...parsedMessage,
        messageText: parsedMessage.messageText  // Keep original message for reply context
      };
      await sendMessage(routing.spaceId, messageToSend, enrichedSenderInfo);
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
        .original-message {
          background: #e3f2fd;
          padding: 15px;
          border-radius: 8px;
          margin-bottom: 20px;
          white-space: pre-wrap;
          word-wrap: break-word;
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
              <span class="info-label">Time:</span> ${new Date(conversation.createdAt).toLocaleString()}
            </div>
          </div>

          <div>
            <h3>📨 Original Message:</h3>
            <div class="original-message">${conversation.senderInfo.messageText || 'No message text available'}</div>
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

            <div class="button-group">
              <button type="button" class="cancel-btn" onclick="window.close()">❌ Cancel</button>
              <button type="submit" class="send-btn" id="sendBtn">📤 Send Reply</button>
            </div>
          </form>

          <div class="success-message" id="successMessage">
            ✅ Reply sent successfully! You can close this window.
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

        textarea.addEventListener('input', () => {
          charCount.textContent = textarea.value.length;
        });

        form.addEventListener('submit', async (e) => {
          e.preventDefault();

          sendBtn.disabled = true;
          sendBtn.textContent = '🔄 Sending...';
          errorMessage.style.display = 'none';

          try {
            const response = await fetch(form.action, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                replyText: textarea.value
              })
            });

            const result = await response.json();

            if (result.success) {
              successMessage.style.display = 'block';
              form.style.display = 'none';
              setTimeout(() => window.close(), 3000);
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
      </script>
    </body>
    </html>
  `);
});

// Handle reply submission
app.post('/reply/:conversationId', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { replyText } = req.body;

    if (!replyText || replyText.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Reply text is required'
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

    // Send reply based on platform
    let result;
    if (conversation.platform === 'whatsapp') {
      const phoneNumber = conversation.senderInfo.phoneNumber || conversation.userId;
      result = await sendWhatsAppMessage(phoneNumber, replyText);
    } else if (conversation.platform === 'line') {
      result = await sendLineMessage(conversation.userId, replyText);
    } else {
      return res.status(400).json({
        success: false,
        error: `Unsupported platform: ${conversation.platform}`
      });
    }

    if (result.success) {
      console.log(`✅ Reply sent via portal to ${conversation.platform} user ${conversation.userId}`);
      res.json({
        success: true,
        message: 'Reply sent successfully',
        platform: conversation.platform,
        userId: conversation.userId
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error || 'Failed to send reply'
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