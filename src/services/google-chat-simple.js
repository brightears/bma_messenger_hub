const { google } = require('googleapis');
const { storeConversation } = require('./conversation-store');
const { normalizePhoneNumber } = require('./message-history');

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

      // Create JWT auth with scopes for both sending and reading messages
      // Note: Bots can only read public messages, not private messages or thread replies
      this.auth = new google.auth.JWT(
        credentials.client_email,
        null,
        credentials.private_key,
        [
          'https://www.googleapis.com/auth/chat.bot',
          'https://www.googleapis.com/auth/chat.app.messages.readonly'
        ]
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
        console.log('Initializing Google Chat service...');
        await this.initialize();
      }

      const { platform, senderName, phoneNumber, senderId } = senderInfo;

      console.log(`Attempting to send message to space: ${spaceId}`);
      console.log(`Platform: ${platform}, Sender: ${senderName || senderId || 'Unknown'}`);

      // Validate space ID format
      if (!this.isValidSpaceId(spaceId)) {
        console.error(`Invalid space ID format: ${spaceId}. Must start with 'spaces/'`);
        return null;
      }

      // Format the message nicely
      // Generate conversation ID first if we have sender info
      let conversationId = null;
      let threadId = null;

      if (senderInfo.platform && senderInfo.senderId) {
        // Generate conversation ID before sending message
        const tempId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        conversationId = tempId;
      }

      // Format message with reply link
      const formattedMessage = this.formatMessage(message, senderInfo, conversationId);

      console.log('Sending message to Google Chat API...');
      const response = await this.chat.spaces.messages.create({
        parent: spaceId,
        requestBody: {
          text: formattedMessage
        }
      });

      console.log(`✅ Message successfully sent to ${spaceId}`);
      console.log(`Message ID: ${response.data.name}`);
      console.log(`Thread info:`, JSON.stringify(response.data.thread, null, 2));

      // Store conversation mapping for bidirectional messaging
      if (senderInfo.platform && senderInfo.senderId && conversationId) {
        // IMPORTANT: Use thread.name if available (message is in a thread)
        // Otherwise create a new thread ID from the message name
        // Google Chat creates a thread automatically for the first message
        threadId = response.data.thread?.name || response.data.name;

        console.log(`🔗 Storing conversation mapping:`);
        console.log(`   Platform: ${senderInfo.platform}`);
        console.log(`   User ID: ${senderInfo.senderId}`);
        console.log(`   Thread ID: ${threadId}`);
        console.log(`   Space ID: ${spaceId}`);
        console.log(`   Conversation ID: ${conversationId}`);

        // Actually store the conversation with the predetermined ID
        // Include customer info in senderInfo for conversation store
        // Normalize phone number for WhatsApp to ensure consistent lookups
        const normalizedUserId = senderInfo.platform === 'whatsapp'
          ? normalizePhoneNumber(senderInfo.senderId)
          : senderInfo.senderId;

        const enrichedSenderInfo = {
          ...senderInfo,
          phoneNumber: normalizedUserId, // Store normalized phone for lookups
          customerName: senderInfo.customerName,
          customerBusiness: senderInfo.customerBusiness
        };

        storeConversation(
          senderInfo.platform,
          normalizedUserId,  // Use normalized ID for consistent lookups
          threadId,
          spaceId,
          enrichedSenderInfo,
          conversationId  // Pass the pre-generated ID
        );
      }

      return response.data;
    } catch (error) {
      console.error('❌ Failed to send message to Google Chat');
      console.error('Space ID:', spaceId);
      console.error('Error message:', error.message);

      // Log the full error for debugging
      if (error.response) {
        console.error('API Response Status:', error.response.status);
        console.error('API Response Data:', JSON.stringify(error.response.data, null, 2));

        if (error.response.status === 403) {
          console.error('⚠️  Permission denied. Make sure the service account is added to the space.');
          console.error('Service account:', process.env.GOOGLE_CREDENTIALS_JSON ?
            JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON).client_email : 'Unknown');
        } else if (error.response.status === 404) {
          console.error('⚠️  Space not found. Check if the space ID is correct.');
        }
      } else if (error.code) {
        console.error('Error code:', error.code);
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

  formatMessage(message, senderInfo, conversationId = null) {
    const { platform, senderName, phoneNumber, senderId, timestamp, customerName, customerBusiness } = senderInfo;

    const platformIcon = this.getPlatformIcon(platform);
    const platformName = platform ? platform.toUpperCase() : 'MESSAGE';

    let formattedMessage = `${platformIcon} *${platformName} MESSAGE*\n\n`;

    // Add customer information (from AI gathering)
    const displayName = customerName || senderName;
    if (displayName) {
      formattedMessage += `*From:* ${displayName}\n`;
    }

    if (customerBusiness) {
      formattedMessage += `*Company:* ${customerBusiness}\n`;
    }

    if (phoneNumber) {
      formattedMessage += `*Phone:* ${phoneNumber}\n`;
    } else if (senderId) {
      formattedMessage += `*User ID:* ${senderId}\n`;
    }

    if (timestamp) {
      const date = new Date(timestamp * 1000).toLocaleString('en-US', { timeZone: 'Asia/Bangkok' });
      formattedMessage += `*Time:* ${date}\n`;
    }

    formattedMessage += `\n*Message:*\n${message}`;

    // Add reply instructions with portal link if conversation ID is provided
    // Skip if message already contains a reply link (e.g., escalation alerts)
    if (conversationId) {
      const replyUrl = `https://bma-messenger-hub-ooyy.onrender.com/reply/${conversationId}`;
      formattedMessage += `\n\n---\n`;
      formattedMessage += `↩️ *Reply to customer:* <${replyUrl}|Click here>`;
    } else if (!message.includes('Reply to customer:')) {
      formattedMessage += `\n\n---\n↩️ *Reply:* Processing link...`;
    }

    return formattedMessage;
  }

  /**
   * List recent messages in a Google Chat space
   * @param {string} spaceId - Google Chat space ID
   * @param {number} pageSize - Number of messages to retrieve (default: 20)
   * @returns {Promise<Array>} Array of message objects or empty array on error
   */
  async listSpaceMessages(spaceId, pageSize = 20) {
    try {
      if (!this.initialized) {
        console.log('Initializing Google Chat service for message listing...');
        await this.initialize();
      }

      // Validate space ID format
      if (!this.isValidSpaceId(spaceId)) {
        console.error(`Invalid space ID format: ${spaceId}. Must start with 'spaces/'`);
        return [];
      }

      console.log(`Fetching messages from space: ${spaceId} (pageSize: ${pageSize})`);

      // Log the auth scopes being used
      console.log(`Auth scopes: ${this.auth.scopes}`);

      const response = await this.chat.spaces.messages.list({
        parent: spaceId,
        pageSize: pageSize,
        orderBy: 'createTime desc' // Get newest messages first
      });

      const messages = response.data.messages || [];
      console.log(`Retrieved ${messages.length} messages from ${spaceId}`);

      // Log first message details for debugging
      if (messages.length > 0) {
        console.log(`First message:`, {
          name: messages[0].name,
          thread: messages[0].thread?.name,
          text: messages[0].text?.substring(0, 50),
          sender: messages[0].sender?.displayName,
          createTime: messages[0].createTime
        });
      }

      return messages;

    } catch (error) {
      console.error('❌ Failed to list messages from Google Chat space');
      console.error('Space ID:', spaceId);
      console.error('Error message:', error.message);

      // Log the full error for debugging
      if (error.response) {
        console.error('API Response Status:', error.response.status);
        console.error('API Response Data:', JSON.stringify(error.response.data, null, 2));

        if (error.response.status === 403) {
          console.error('⚠️  Permission denied. Make sure the service account can read messages from the space.');
        } else if (error.response.status === 404) {
          console.error('⚠️  Space not found. Check if the space ID is correct.');
        }
      }

      // Return empty array instead of throwing - graceful degradation
      return [];
    }
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
  },
  listSpaceMessages: (spaceId, pageSize) => {
    return googleChatService.listSpaceMessages(spaceId, pageSize);
  }
};