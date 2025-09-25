const { google } = require('googleapis');

class GoogleChatService {
  constructor() {
    this.chat = null;
    this.auth = null;
    this.initialized = false;
  }

  async initialize() {
    try {
      const credentialsJson = process.env.GOOGLE_CREDENTIALS_JSON;
      if (!credentialsJson) {
        throw new Error('GOOGLE_CREDENTIALS_JSON environment variable not found');
      }

      const credentials = JSON.parse(credentialsJson);

      // Create JWT auth
      this.auth = new google.auth.JWT(
        credentials.client_email,
        null,
        credentials.private_key,
        ['https://www.googleapis.com/auth/chat.bot']
      );

      // Initialize Google Chat API
      this.chat = google.chat({
        version: 'v1',
        auth: this.auth
      });

      this.initialized = true;
      console.log('Google Chat service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Google Chat service:', error.message);
      throw error;
    }
  }

  async sendMessage(spaceId, message, senderInfo = {}) {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      const { platform, senderName, phoneNumber, senderId } = senderInfo;

      // Create platform icon
      const platformIcon = this.getPlatformIcon(platform);

      // Format the message nicely
      const formattedMessage = this.formatMessage(message, senderInfo);

      const response = await this.chat.spaces.messages.create({
        parent: spaceId,
        requestBody: {
          text: formattedMessage
        }
      });

      console.log(`Message sent to ${spaceId}:`, formattedMessage);
      return response.data;
    } catch (error) {
      console.error('Error sending message to Google Chat:', error);

      // Log the full error for debugging
      if (error.response) {
        console.error('Response error:', error.response.status, error.response.data);
      }

      // Don't throw - graceful degradation
      return null;
    }
  }

  getPlatformIcon(platform) {
    const icons = {
      whatsapp: '💬',
      line: '📱',
      default: '📝'
    };
    return icons[platform?.toLowerCase()] || icons.default;
  }

  formatMessage(message, senderInfo) {
    const { platform, senderName, phoneNumber, senderId, timestamp } = senderInfo;

    const platformIcon = this.getPlatformIcon(platform);
    const platformName = platform ? platform.toUpperCase() : 'MESSAGE';

    let formattedMessage = `${platformIcon} *${platformName} MESSAGE*\n\n`;

    // Add sender information
    if (senderName) {
      formattedMessage += `*From:* ${senderName}\n`;
    }

    if (phoneNumber) {
      formattedMessage += `*Phone:* ${phoneNumber}\n`;
    } else if (senderId) {
      formattedMessage += `*User ID:* ${senderId}\n`;
    }

    if (timestamp) {
      const date = new Date(timestamp * 1000).toLocaleString();
      formattedMessage += `*Time:* ${date}\n`;
    }

    formattedMessage += `\n*Message:*\n${message}`;

    return formattedMessage;
  }

  // Helper method to validate space ID format
  isValidSpaceId(spaceId) {
    return spaceId && spaceId.startsWith('spaces/');
  }
}

// Export singleton instance
const googleChatService = new GoogleChatService();

module.exports = {
  googleChatService,
  sendMessage: (spaceId, message, senderInfo) => {
    return googleChatService.sendMessage(spaceId, message, senderInfo);
  }
};