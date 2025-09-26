/**
 * LINE Sender Service
 * Handles sending messages back to LINE users via LINE Messaging API
 */

const axios = require('axios');

class LineSender {
  constructor() {
    this.apiUrl = process.env.LINE_API_URL;
    this.channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    this.initialized = false;
  }

  /**
   * Initialize the LINE sender service
   */
  initialize() {
    if (!this.apiUrl || !this.channelAccessToken) {
      throw new Error('Missing LINE API credentials. Check LINE_API_URL and LINE_CHANNEL_ACCESS_TOKEN environment variables.');
    }

    this.initialized = true;
    console.log('LINE sender service initialized');
  }

  /**
   * Send a text message to a LINE user
   * @param {string} userId - Recipient LINE user ID
   * @param {string} message - Message text to send
   * @returns {Promise<Object>} API response or null on error
   */
  async sendLineMessage(userId, message) {
    try {
      if (!this.initialized) {
        this.initialize();
      }

      console.log(`Sending LINE message to ${userId}:`);
      console.log(`Message: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`);

      const url = `${this.apiUrl}/bot/message/push`;

      const payload = {
        to: userId,
        messages: [
          {
            type: 'text',
            text: message
          }
        ]
      };

      const response = await axios.post(url, payload, {
        headers: {
          'Authorization': `Bearer ${this.channelAccessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10 second timeout
      });

      console.log(`✅ LINE message sent successfully to ${userId}`);

      return {
        success: true,
        userId: userId,
        response: response.data,
        statusCode: response.status
      };

    } catch (error) {
      console.error('❌ Failed to send LINE message');
      console.error('User ID:', userId);
      console.error('Error message:', error.message);

      // Log detailed error information
      if (error.response) {
        console.error('API Response Status:', error.response.status);
        console.error('API Response Data:', JSON.stringify(error.response.data, null, 2));

        // Handle specific LINE API errors
        if (error.response.status === 401) {
          console.error('⚠️  Invalid channel access token. Check LINE_CHANNEL_ACCESS_TOKEN environment variable.');
        } else if (error.response.status === 400) {
          console.error('⚠️  Bad request. Check user ID format and message content.');
          if (error.response.data.details) {
            console.error('LINE API Error Details:', error.response.data.details);
          }
        } else if (error.response.status === 403) {
          console.error('⚠️  Forbidden. The bot might not be friends with the user or lacks permissions.');
        } else if (error.response.status === 409) {
          console.error('⚠️  Conflict. The user might have blocked the bot.');
        } else if (error.response.status === 429) {
          console.error('⚠️  Rate limited. Too many messages sent in a short time.');
        } else if (error.response.status === 500) {
          console.error('⚠️  LINE API internal server error.');
        }
      } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        console.error('⚠️  Network error. Check internet connection and LINE API URL.');
      } else if (error.code === 'ECONNABORTED') {
        console.error('⚠️  Request timeout. LINE API took too long to respond.');
      }

      return {
        success: false,
        error: error.message,
        userId: userId,
        statusCode: error.response?.status
      };
    }
  }

  /**
   * Send a message with retry logic
   * @param {string} userId - Recipient LINE user ID
   * @param {string} message - Message text
   * @param {number} maxRetries - Maximum number of retries (default: 3)
   * @returns {Promise<Object>} Final result after retries
   */
  async sendWithRetry(userId, message, maxRetries = 3) {
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      console.log(`LINE send attempt ${attempt}/${maxRetries} for ${userId}`);

      const result = await this.sendLineMessage(userId, message);

      if (result.success) {
        return result;
      }

      lastError = result;

      // Don't retry for certain errors
      if (result.statusCode && (
        result.statusCode === 401 || // Invalid token
        result.statusCode === 403 || // Forbidden/blocked
        result.statusCode === 409 || // User blocked bot
        result.statusCode === 400    // Bad request (likely permanent)
      )) {
        console.log('Not retrying due to permanent error type');
        break;
      }

      // Wait before retrying (exponential backoff)
      if (attempt < maxRetries) {
        const waitTime = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s...
        console.log(`Waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    return lastError;
  }

  /**
   * Send a rich message (with quick reply buttons)
   * @param {string} userId - Recipient LINE user ID
   * @param {string} message - Message text
   * @param {Array} quickReplies - Array of quick reply options
   * @returns {Promise<Object>} API response or null on error
   */
  async sendRichMessage(userId, message, quickReplies = []) {
    try {
      if (!this.initialized) {
        this.initialize();
      }

      const url = `${this.apiUrl}/bot/message/push`;

      const messageObj = {
        type: 'text',
        text: message
      };

      // Add quick reply if provided
      if (quickReplies.length > 0) {
        messageObj.quickReply = {
          items: quickReplies.map(reply => ({
            type: 'action',
            action: {
              type: 'message',
              label: reply.label || reply,
              text: reply.text || reply
            }
          }))
        };
      }

      const payload = {
        to: userId,
        messages: [messageObj]
      };

      const response = await axios.post(url, payload, {
        headers: {
          'Authorization': `Bearer ${this.channelAccessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      console.log(`✅ LINE rich message sent successfully to ${userId}`);

      return {
        success: true,
        userId: userId,
        response: response.data
      };

    } catch (error) {
      console.error('❌ Failed to send LINE rich message:', error.message);
      return {
        success: false,
        error: error.message,
        userId: userId
      };
    }
  }

  /**
   * Send a media message (image or video) to a LINE user
   * @param {string} userId - Recipient LINE user ID
   * @param {Object} file - File object with url, mimeType, originalName
   * @returns {Promise<Object>} API response
   */
  async sendMediaMessage(userId, file) {
    try {
      if (!this.initialized) {
        this.initialize();
      }

      console.log(`Sending LINE media to ${userId}:`);
      console.log(`File: ${file.originalName} (${file.mimeType})`);

      const url = `${this.apiUrl}/bot/message/push`;

      // Determine media type - LINE only supports image and video
      let messageType;
      if (file.mimeType.startsWith('image/')) {
        messageType = 'image';
      } else if (file.mimeType.startsWith('video/')) {
        messageType = 'video';
      } else {
        console.error(`❌ LINE doesn't support ${file.mimeType} files`);
        return {
          success: false,
          error: `LINE doesn't support ${file.mimeType} files. Only images and videos are supported.`,
          userId: userId
        };
      }

      const payload = {
        to: userId,
        messages: [
          {
            type: messageType,
            originalContentUrl: file.url,
            previewImageUrl: file.url // For images, preview and original can be same
          }
        ]
      };

      // For videos, we need a preview image URL (using video URL as fallback)
      if (messageType === 'video') {
        payload.messages[0].previewImageUrl = file.url; // In production, generate a thumbnail
      }

      const response = await axios.post(url, payload, {
        headers: {
          'Authorization': `Bearer ${this.channelAccessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000 // 15 second timeout for media
      });

      console.log(`✅ LINE media sent successfully to ${userId}`);

      return {
        success: true,
        userId: userId,
        mediaType: messageType,
        response: response.data,
        statusCode: response.status
      };

    } catch (error) {
      console.error('❌ Failed to send LINE media');
      console.error('User ID:', userId);
      console.error('File:', file.originalName);
      console.error('Error message:', error.message);

      if (error.response) {
        console.error('API Response Status:', error.response.status);
        console.error('API Response Data:', JSON.stringify(error.response.data, null, 2));
      }

      return {
        success: false,
        error: error.message,
        userId: userId
      };
    }
  }

  /**
   * Validate LINE user ID format
   * @param {string} userId - LINE user ID to validate
   * @returns {boolean} Whether user ID is valid
   */
  isValidUserId(userId) {
    if (!userId || typeof userId !== 'string') {
      return false;
    }

    // LINE user IDs are typically alphanumeric strings
    // They usually start with 'U' followed by 32 characters
    return /^U[a-fA-F0-9]{32}$/.test(userId) || userId.length > 10; // Fallback for other formats
  }

  /**
   * Health check for LINE sender service
   * @returns {Object} Service health status
   */
  async healthCheck() {
    try {
      if (!this.apiUrl || !this.channelAccessToken) {
        return {
          status: 'error',
          message: 'Missing LINE API credentials'
        };
      }

      // Test API connectivity by checking bot info
      const url = `${this.apiUrl}/bot/info`;
      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${this.channelAccessToken}`
        },
        timeout: 5000
      });

      return {
        status: 'ok',
        message: 'LINE API is accessible',
        botInfo: response.data
      };

    } catch (error) {
      return {
        status: 'error',
        message: `LINE API health check failed: ${error.message}`
      };
    }
  }

  /**
   * Get bot profile information
   * @returns {Promise<Object>} Bot profile data
   */
  async getBotProfile() {
    try {
      if (!this.initialized) {
        this.initialize();
      }

      const url = `${this.apiUrl}/bot/info`;
      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${this.channelAccessToken}`
        }
      });

      return response.data;
    } catch (error) {
      console.error('Failed to get LINE bot profile:', error.message);
      return null;
    }
  }
}

// Export singleton instance
const lineSender = new LineSender();

module.exports = {
  lineSender,
  sendLineMessage: (userId, message) => lineSender.sendLineMessage(userId, message),
  sendMediaMessage: (userId, file) => lineSender.sendMediaMessage(userId, file),
  sendWithRetry: (userId, message, maxRetries) => lineSender.sendWithRetry(userId, message, maxRetries),
  sendRichMessage: (userId, message, quickReplies) => lineSender.sendRichMessage(userId, message, quickReplies),
  isValidUserId: (userId) => lineSender.isValidUserId(userId),
  healthCheck: () => lineSender.healthCheck(),
  getBotProfile: () => lineSender.getBotProfile()
};