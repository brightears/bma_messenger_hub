/**
 * Google Chat Poller Service
 * Polls Google Chat spaces for new replies and forwards them to original senders
 */

const { listSpaceMessages } = require('./google-chat-simple');
const { messageTracker, setLastProcessed, shouldProcessMessage } = require('./message-tracker');
const { conversationStore } = require('./conversation-store');
const { sendWhatsAppMessage } = require('./whatsapp-sender');
const { sendLineMessage } = require('./line-sender');

class GoogleChatPoller {
  constructor() {
    this.isPolling = false;
    this.pollInterval = null;
    this.pollIntervalMs = 5000; // 5 seconds
    this.spaces = [
      'spaces/AAQA6WeunF8', // Technical
      'spaces/AAQALSfR5k4', // Design
      'spaces/AAQAfKFrdxQ'  // Sales
    ];
    this.spaceNames = {
      'spaces/AAQA6WeunF8': 'Technical',
      'spaces/AAQALSfR5k4': 'Design',
      'spaces/AAQAfKFrdxQ': 'Sales'
    };
  }

  /**
   * Start polling all configured spaces
   */
  async startPolling() {
    if (this.isPolling) {
      console.log('Google Chat polling is already running');
      return;
    }

    this.isPolling = true;
    console.log(`Starting Google Chat polling (interval: ${this.pollIntervalMs}ms)`);
    console.log(`Monitoring spaces: ${this.spaces.map(s => this.spaceNames[s] || s).join(', ')}`);

    // Initial poll
    await this.pollAllSpaces();

    // Set up recurring polling
    this.pollInterval = setInterval(async () => {
      try {
        await this.pollAllSpaces();
      } catch (error) {
        console.error('Error during polling cycle:', error.message);
      }
    }, this.pollIntervalMs);

    console.log('✅ Google Chat polling started successfully');
  }

  /**
   * Stop polling
   */
  stopPolling() {
    if (!this.isPolling) {
      console.log('Google Chat polling is not running');
      return;
    }

    this.isPolling = false;

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    console.log('🛑 Google Chat polling stopped');
  }

  /**
   * Poll all configured spaces for new messages
   */
  async pollAllSpaces() {
    const startTime = Date.now();
    let totalMessages = 0;
    let forwardedCount = 0;

    for (const spaceId of this.spaces) {
      try {
        const result = await this.pollSpace(spaceId);
        totalMessages += result.totalMessages;
        forwardedCount += result.forwardedCount;
      } catch (error) {
        console.error(`Error polling space ${this.spaceNames[spaceId] || spaceId}:`, error.message);
      }
    }

    const elapsed = Date.now() - startTime;

    if (totalMessages > 0 || forwardedCount > 0) {
      console.log(`Polling cycle completed in ${elapsed}ms: ${totalMessages} messages checked, ${forwardedCount} forwarded`);
    }
  }

  /**
   * Poll a specific space for new messages
   * @param {string} spaceId - Google Chat space ID
   * @returns {Object} Polling results
   */
  async pollSpace(spaceId) {
    const spaceName = this.spaceNames[spaceId] || spaceId;

    try {
      // Get recent messages from the space
      const messages = await listSpaceMessages(spaceId, 20);

      console.log(`\n📊 Polling ${spaceName} space (${spaceId})`);
      console.log(`   Retrieved ${messages ? messages.length : 0} messages`);

      if (!messages || messages.length === 0) {
        console.log(`   No messages found in ${spaceName}`);
        return { totalMessages: 0, forwardedCount: 0 };
      }

      let forwardedCount = 0;

      // Process messages in reverse order (oldest first) to maintain conversation flow
      const messagesToProcess = messages.reverse();

      for (const message of messagesToProcess) {
        try {
          const wasForwarded = await this.processMessage(spaceId, message);
          if (wasForwarded) {
            forwardedCount++;
          }
        } catch (error) {
          console.error(`Error processing message ${message.name}:`, error.message);
        }
      }

      return { totalMessages: messages.length, forwardedCount };

    } catch (error) {
      console.error(`Failed to poll space ${spaceName}:`, error.message);
      return { totalMessages: 0, forwardedCount: 0 };
    }
  }

  /**
   * Process a single message from Google Chat
   * @param {string} spaceId - Google Chat space ID
   * @param {Object} message - Google Chat message object
   * @returns {boolean} True if message was forwarded
   */
  async processMessage(spaceId, message) {
    const spaceName = this.spaceNames[spaceId] || spaceId;

    console.log(`\n   🔍 Processing message in ${spaceName}:`);
    console.log(`      Message ID: ${message.name}`);
    console.log(`      Thread ID: ${message.thread?.name || 'No thread'}`);
    console.log(`      Sender: ${message.sender?.displayName || 'Unknown'} (Type: ${message.sender?.type || 'Unknown'})`);
    console.log(`      Text preview: ${message.text ? message.text.substring(0, 50) + '...' : 'No text'}`);
    console.log(`      Created at: ${message.createTime}`);

    // Skip if no message content
    if (!message.text) {
      console.log(`      ⏭️  Skipped: No message content`);
      return false;
    }

    // Skip if message is from a bot
    if (message.sender && message.sender.type === 'BOT') {
      console.log(`      ⏭️  Skipped: Message from bot`);
      return false;
    }

    // Check if we should process this message based on timestamp
    if (!shouldProcessMessage(spaceId, message.createTime)) {
      return false;
    }

    // Check if message is in a thread we started (reply to our message)
    const threadId = message.thread?.name;
    if (!threadId) {
      // Not in a thread, skip
      console.log(`      ⏭️  Skipped: Not in a thread`);
      setLastProcessed(spaceId, message.name);
      return false;
    }

    console.log(`      📍 Thread ID: ${threadId}`);

    // Look for conversation mapping by thread ID
    console.log(`      🔎 Looking for conversation with thread ID: ${threadId}`);
    const conversation = conversationStore.getConversationByThread(threadId);

    // Also log all stored conversations for debugging
    const allConversations = conversationStore.getStats();
    console.log(`      📋 Total stored conversations: ${allConversations.totalConversations}`);
    if (allConversations.totalConversations > 0) {
      console.log(`      📋 Active conversations:`);
      for (const conv of allConversations.activeConversations) {
        console.log(`         - ${conv.platform} user ${conv.userId}: thread=${conv.threadId}`);
      }
    }

    if (!conversation) {
      // No conversation mapping found, skip
      console.log(`      ⏭️  Skipped: No conversation found for thread ${threadId}`);
      setLastProcessed(spaceId, message.name);
      return false;
    }

    console.log(`      ✅ Found conversation: ${conversation.platform} user ${conversation.userId}`);

    // This is a reply in a thread we started - forward it!
    console.log(`📤 Forwarding reply from ${spaceName} to ${conversation.platform} user ${conversation.userId}`);

    const success = await this.forwardReply(conversation, message);

    // Mark message as processed
    setLastProcessed(spaceId, message.name);

    return success;
  }

  /**
   * Forward a Google Chat reply to the original sender
   * @param {Object} conversation - Conversation mapping object
   * @param {Object} message - Google Chat message to forward
   * @returns {boolean} True if forwarded successfully
   */
  async forwardReply(conversation, message) {
    try {
      // Format the reply message
      const replyText = this.formatReply(message, conversation);

      let result;

      // Forward based on original platform
      if (conversation.platform === 'whatsapp') {
        // For WhatsApp, use phone number from senderInfo
        const phoneNumber = conversation.senderInfo.phoneNumber || conversation.userId;
        result = await sendWhatsAppMessage(phoneNumber, replyText);
      } else if (conversation.platform === 'line') {
        // For LINE, use user ID
        result = await sendLineMessage(conversation.userId, replyText);
      } else {
        console.error(`Unknown platform: ${conversation.platform}`);
        return false;
      }

      if (result && result.success) {
        console.log(`✅ Successfully forwarded reply to ${conversation.platform} user ${conversation.userId}`);

        // Update conversation activity
        conversationStore.updateActivity(conversation.id);
        return true;
      } else {
        console.error(`❌ Failed to forward reply to ${conversation.platform} user ${conversation.userId}`);
        return false;
      }

    } catch (error) {
      console.error(`Error forwarding reply:`, error.message);
      return false;
    }
  }

  /**
   * Format a Google Chat reply for forwarding
   * @param {Object} message - Google Chat message object
   * @param {Object} conversation - Conversation mapping object
   * @returns {string} Formatted reply text
   */
  formatReply(message, conversation) {
    // Extract sender info
    const senderName = message.sender?.displayName || 'Support Team';
    const timestamp = new Date(message.createTime).toLocaleString();

    // Get department from space
    const department = this.spaceNames[conversation.spaceId] || 'Support';

    // Format the reply
    let replyText = `💬 Reply from ${department} Team\n\n`;
    replyText += `${message.text}\n\n`;
    replyText += `---\n`;
    replyText += `👤 ${senderName}\n`;
    replyText += `⏰ ${timestamp}`;

    return replyText;
  }

  /**
   * Get polling status
   * @returns {Object} Polling status information
   */
  getStatus() {
    return {
      isPolling: this.isPolling,
      pollIntervalMs: this.pollIntervalMs,
      spacesMonitored: this.spaces.length,
      spaces: this.spaces.map(spaceId => ({
        id: spaceId,
        name: this.spaceNames[spaceId] || spaceId
      })),
      trackerStats: messageTracker.getStats()
    };
  }

  /**
   * Get polling statistics
   * @returns {Object} Detailed statistics
   */
  getStats() {
    const status = this.getStatus();
    const conversationStats = conversationStore.getStats();

    return {
      polling: status,
      conversations: conversationStats,
      uptime: this.isPolling ? Date.now() - this.startTime : 0
    };
  }

  /**
   * Reset message tracking for all spaces (useful for testing)
   */
  resetTracking() {
    messageTracker.resetAll();
    console.log('Reset message tracking for all spaces');
  }
}

// Export singleton instance
const googleChatPoller = new GoogleChatPoller();

module.exports = {
  googleChatPoller,
  startPolling: () => googleChatPoller.startPolling(),
  stopPolling: () => googleChatPoller.stopPolling(),
  getStatus: () => googleChatPoller.getStatus(),
  getStats: () => googleChatPoller.getStats(),
  resetTracking: () => googleChatPoller.resetTracking()
};