/**
 * Google Chat Webhook Handler
 * Processes incoming messages from Google Chat and routes replies back to original platforms
 */

const { getConversationByThread } = require('../services/conversation-store');
const { sendWithRetry: sendWhatsApp } = require('../services/whatsapp-sender');
const { sendWithRetry: sendLine } = require('../services/line-sender');

/**
 * Parse Google Chat webhook message
 * @param {Object} body - Google Chat webhook body
 * @returns {Object|null} Parsed message data
 */
function parseGoogleChatMessage(body) {
  try {
    console.log('Parsing Google Chat message:', JSON.stringify(body, null, 2));

    // Google Chat webhook structure varies by event type
    if (body.type === 'MESSAGE') {
      const message = body.message;
      const user = body.user;
      const space = body.space;

      // Skip messages from bots (including our own)
      if (user.type === 'BOT') {
        console.log('Ignoring message from bot:', user.name);
        return null;
      }

      return {
        messageId: message.name,
        threadId: message.thread?.name || message.name,
        spaceId: space.name,
        userId: user.name,
        userDisplayName: user.displayName,
        messageText: message.text || '',
        createTime: message.createTime,
        originalEvent: body
      };
    }

    console.log('Non-MESSAGE event type:', body.type);
    return null;

  } catch (error) {
    console.error('Error parsing Google Chat message:', error);
    return null;
  }
}

/**
 * Extract reply message from various Google Chat message formats
 * @param {string} messageText - The message text
 * @returns {Object} Parsed reply information
 */
function parseReplyMessage(messageText) {
  if (!messageText || typeof messageText !== 'string') {
    return { isReply: false, replyText: null };
  }

  const text = messageText.trim();

  // For natural thread replies, just return the text as-is
  // No need for special commands - any message in a tracked thread is a reply
  return {
    isReply: true,
    replyText: text,
    method: 'thread'
  };
}

/**
 * Route reply message to appropriate platform
 * @param {Object} conversation - Conversation data
 * @param {string} replyText - Reply message text
 * @returns {Promise<Object>} Send result
 */
async function routeReplyMessage(conversation, replyText) {
  const { platform, userId, senderInfo } = conversation;

  console.log(`Routing reply to ${platform} user ${userId}`);
  console.log(`Reply message: ${replyText.substring(0, 100)}${replyText.length > 100 ? '...' : ''}`);

  try {
    let result;

    if (platform === 'whatsapp') {
      // For WhatsApp, use phone number
      const phoneNumber = senderInfo.phoneNumber || userId;
      if (!phoneNumber) {
        throw new Error('No phone number found for WhatsApp user');
      }
      result = await sendWhatsApp(phoneNumber, replyText);

    } else if (platform === 'line') {
      // For LINE, use user ID
      result = await sendLine(userId, replyText);

    } else {
      throw new Error(`Unsupported platform: ${platform}`);
    }

    if (result.success) {
      console.log(`✅ Reply sent successfully to ${platform} user ${userId}`);
      return {
        success: true,
        platform: platform,
        userId: userId,
        message: 'Reply sent successfully'
      };
    } else {
      console.error(`❌ Failed to send reply to ${platform} user ${userId}: ${result.error}`);
      return {
        success: false,
        platform: platform,
        userId: userId,
        error: result.error,
        message: 'Failed to send reply'
      };
    }

  } catch (error) {
    console.error(`❌ Error routing reply to ${platform}:`, error.message);
    return {
      success: false,
      platform: platform,
      userId: userId,
      error: error.message,
      message: 'Error routing reply'
    };
  }
}

/**
 * Process Google Chat webhook and handle replies
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function processGoogleChatWebhook(req, res) {
  try {
    console.log('===========================================');
    console.log('GOOGLE CHAT WEBHOOK RECEIVED!');
    console.log('Time:', new Date().toISOString());
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Body:', JSON.stringify(req.body, null, 2));
    console.log('===========================================');

    // Parse the Google Chat message
    const parsedMessage = parseGoogleChatMessage(req.body);

    if (!parsedMessage) {
      console.log('No valid message found in Google Chat webhook');
      return res.status(200).json({ text: 'No message to process' });
    }

    // Parse reply intent
    const replyInfo = parseReplyMessage(parsedMessage.messageText);

    if (!replyInfo.isReply || !replyInfo.replyText) {
      console.log('Message is not a reply or has no reply text');
      return res.status(200).json({ text: 'Message noted' });
    }

    console.log(`Reply detected via ${replyInfo.method}: ${replyInfo.replyText.substring(0, 50)}...`);

    // Find the conversation this reply belongs to
    const conversation = getConversationByThread(parsedMessage.threadId);

    if (!conversation) {
      console.log(`No conversation found for thread: ${parsedMessage.threadId}`);
      return res.status(200).json({
        text: '❌ No conversation found. This might be an old conversation that has expired (24 hours).'
      });
    }

    console.log(`Found conversation for ${conversation.platform} user: ${conversation.userId}`);

    // Route the reply to the appropriate platform
    const routeResult = await routeReplyMessage(conversation, replyInfo.replyText);

    // Respond to Google Chat with status
    if (routeResult.success) {
      return res.status(200).json({
        text: `✅ Reply sent to ${routeResult.platform} user successfully!`
      });
    } else {
      return res.status(200).json({
        text: `❌ Failed to send reply: ${routeResult.error}`
      });
    }

  } catch (error) {
    console.error('Error processing Google Chat webhook:', error);
    return res.status(200).json({
      text: `❌ Error processing reply: ${error.message}`
    });
  }
}

module.exports = {
  parseGoogleChatMessage,
  parseReplyMessage,
  routeReplyMessage,
  processGoogleChatWebhook
};