/**
 * WhatsApp Sender Service
 * Handles sending messages back to WhatsApp users via WhatsApp Business API
 */

const axios = require('axios');

class WhatsAppSender {
  constructor() {
    this.apiUrl = process.env.WHATSAPP_API_URL;
    this.accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    this.initialized = false;
  }

  /**
   * Initialize the WhatsApp sender service
   */
  initialize() {
    if (!this.apiUrl || !this.accessToken || !this.phoneNumberId) {
      throw new Error('Missing WhatsApp API credentials. Check WHATSAPP_API_URL, WHATSAPP_ACCESS_TOKEN, and WHATSAPP_PHONE_NUMBER_ID environment variables.');
    }

    this.initialized = true;
    console.log('WhatsApp sender service initialized');
  }

  /**
   * Send an automatic info request message
   * @param {string} phoneNumber - Recipient phone number
   * @param {string} message - Info request message
   * @returns {Promise<Object>} API response
   */
  async sendInfoRequest(phoneNumber, message) {
    console.log(`📤 Sending info request to ${phoneNumber}`);
    return this.sendWhatsAppMessage(phoneNumber, message);
  }

  /**
   * Send a text message to a WhatsApp user
   * @param {string} phoneNumber - Recipient phone number (without +)
   * @param {string} message - Message text to send
   * @returns {Promise<Object>} API response or null on error
   */
  async sendWhatsAppMessage(phoneNumber, message) {
    try {
      if (!this.initialized) {
        this.initialize();
      }

      // Ensure phone number is in correct format (remove + and any spaces)
      const cleanPhoneNumber = phoneNumber.replace(/\+|\s/g, '');

      console.log(`Sending WhatsApp message to ${cleanPhoneNumber}:`);
      console.log(`Message: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`);

      const url = `${this.apiUrl}/${this.phoneNumberId}/messages`;

      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanPhoneNumber,
        type: 'text',
        text: {
          preview_url: false,
          body: message
        }
      };

      const response = await axios.post(url, payload, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10 second timeout
      });

      console.log(`✅ WhatsApp message sent successfully to ${cleanPhoneNumber}`);
      console.log(`Message ID: ${response.data.messages[0].id}`);

      return {
        success: true,
        messageId: response.data.messages[0].id,
        phoneNumber: cleanPhoneNumber,
        response: response.data
      };

    } catch (error) {
      console.error('❌ Failed to send WhatsApp message');
      console.error('Phone number:', phoneNumber);
      console.error('Error message:', error.message);

      // Log detailed error information
      if (error.response) {
        console.error('API Response Status:', error.response.status);
        console.error('API Response Data:', JSON.stringify(error.response.data, null, 2));

        // Handle specific WhatsApp API errors
        if (error.response.status === 401) {
          console.error('⚠️  Invalid access token. Check WHATSAPP_ACCESS_TOKEN environment variable.');
        } else if (error.response.status === 400) {
          console.error('⚠️  Bad request. Check phone number format and message content.');
          if (error.response.data.error) {
            console.error('WhatsApp API Error:', error.response.data.error.message);
          }
        } else if (error.response.status === 403) {
          console.error('⚠️  Forbidden. Check if phone number ID is correct and has necessary permissions.');
        } else if (error.response.status === 429) {
          console.error('⚠️  Rate limited. Too many messages sent in a short time.');
        }
      } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        console.error('⚠️  Network error. Check internet connection and WhatsApp API URL.');
      } else if (error.code === 'ECONNABORTED') {
        console.error('⚠️  Request timeout. WhatsApp API took too long to respond.');
      }

      return {
        success: false,
        error: error.message,
        phoneNumber: phoneNumber
      };
    }
  }

  /**
   * Send a message with retry logic
   * @param {string} phoneNumber - Recipient phone number
   * @param {string} message - Message text
   * @param {number} maxRetries - Maximum number of retries (default: 3)
   * @returns {Promise<Object>} Final result after retries
   */
  async sendWithRetry(phoneNumber, message, maxRetries = 3) {
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      console.log(`WhatsApp send attempt ${attempt}/${maxRetries} for ${phoneNumber}`);

      const result = await this.sendWhatsAppMessage(phoneNumber, message);

      if (result.success) {
        return result;
      }

      lastError = result;

      // Don't retry for certain errors
      if (result.error && (
        result.error.includes('401') || // Invalid token
        result.error.includes('403') || // Forbidden
        result.error.includes('400')    // Bad request (likely permanent)
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
   * Validate phone number format
   * @param {string} phoneNumber - Phone number to validate
   * @returns {boolean} Whether phone number is valid
   */
  isValidPhoneNumber(phoneNumber) {
    if (!phoneNumber || typeof phoneNumber !== 'string') {
      return false;
    }

    // Remove + and spaces for validation
    const cleaned = phoneNumber.replace(/\+|\s/g, '');

    // Should be numeric and reasonable length (7-15 digits)
    return /^\d{7,15}$/.test(cleaned);
  }

  /**
   * Send a media message (document, image, video) to a WhatsApp user
   * @param {string} phoneNumber - Recipient phone number
   * @param {Object} file - File object with url, mimeType, originalName
   * @returns {Promise<Object>} API response
   */
  async sendMediaMessage(phoneNumber, file) {
    try {
      if (!this.initialized) {
        this.initialize();
      }

      // Ensure phone number is in correct format
      const cleanPhoneNumber = phoneNumber.replace(/\+|\s/g, '');

      console.log(`Sending WhatsApp media to ${cleanPhoneNumber}:`);
      console.log(`File: ${file.originalName} (${file.mimeType})`);

      const url = `${this.apiUrl}/${this.phoneNumberId}/messages`;

      // Determine media type based on MIME type
      let mediaType;
      if (file.mimeType.startsWith('image/')) {
        mediaType = 'image';
      } else if (file.mimeType.startsWith('video/')) {
        mediaType = 'video';
      } else if (file.mimeType.startsWith('audio/')) {
        mediaType = 'audio';
      } else {
        mediaType = 'document';
      }

      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanPhoneNumber,
        type: mediaType,
        [mediaType]: {
          link: file.url
        }
      };

      // Add caption/filename for documents
      if (mediaType === 'document') {
        payload[mediaType].filename = file.originalName;
        payload[mediaType].caption = file.originalName;
      }

      const response = await axios.post(url, payload, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000 // 15 second timeout for media
      });

      console.log(`✅ WhatsApp media sent successfully to ${cleanPhoneNumber}`);
      console.log(`Message ID: ${response.data.messages[0].id}`);

      return {
        success: true,
        messageId: response.data.messages[0].id,
        phoneNumber: cleanPhoneNumber,
        mediaType: mediaType,
        response: response.data
      };

    } catch (error) {
      console.error('❌ Failed to send WhatsApp media');
      console.error('Phone number:', phoneNumber);
      console.error('File:', file.originalName);
      console.error('Error message:', error.message);

      if (error.response) {
        console.error('API Response Status:', error.response.status);
        console.error('API Response Data:', JSON.stringify(error.response.data, null, 2));
      }

      return {
        success: false,
        error: error.message,
        phoneNumber: phoneNumber
      };
    }
  }

  /**
   * Health check for WhatsApp sender service
   * @returns {Object} Service health status
   */
  async healthCheck() {
    try {
      if (!this.apiUrl || !this.accessToken || !this.phoneNumberId) {
        return {
          status: 'error',
          message: 'Missing WhatsApp API credentials'
        };
      }

      // Test API connectivity by checking business profile
      const url = `${this.apiUrl}/${this.phoneNumberId}`;
      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        },
        timeout: 5000
      });

      return {
        status: 'ok',
        message: 'WhatsApp API is accessible',
        phoneNumberId: this.phoneNumberId
      };

    } catch (error) {
      return {
        status: 'error',
        message: `WhatsApp API health check failed: ${error.message}`
      };
    }
  }
}

// Export singleton instance
const whatsappSender = new WhatsAppSender();

module.exports = {
  whatsappSender,
  sendWhatsAppMessage: (phoneNumber, message, files) => whatsappSender.sendWhatsAppMessage(phoneNumber, message, files),
  sendInfoRequest: (phoneNumber, message) => whatsappSender.sendInfoRequest(phoneNumber, message),
  sendMediaMessage: (phoneNumber, file) => whatsappSender.sendMediaMessage(phoneNumber, file),
  sendWithRetry: (phoneNumber, message, maxRetries) => whatsappSender.sendWithRetry(phoneNumber, message, maxRetries),
  isValidPhoneNumber: (phoneNumber) => whatsappSender.isValidPhoneNumber(phoneNumber),
  healthCheck: () => whatsappSender.healthCheck()
};