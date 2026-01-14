/**
 * Message History Service
 * Stores message history for 24 hours to provide conversation context
 */

/**
 * Normalize phone number to a consistent format for storage and lookup
 * Removes all non-digit characters and leading + for consistent keys
 * @param {string} phone - Phone number in any format
 * @returns {string|null} Normalized phone number or null
 */
function normalizePhoneNumber(phone) {
  if (!phone) return null;
  // Remove all non-digit characters (spaces, dashes, parentheses)
  let normalized = phone.replace(/[\s\-()]/g, '');
  // Remove leading + for consistent storage
  normalized = normalized.replace(/^\+/, '');
  return normalized || null;
}

class MessageHistory {
  constructor() {
    // Map: phoneNumber/userId -> array of messages
    this.messages = new Map();
    this.TTL_HOURS = 24;

    // Clean up old messages every hour
    setInterval(() => this.cleanupOldMessages(), 60 * 60 * 1000);
  }

  /**
   * Store a message in history
   * @param {string} identifier - Phone number or user ID
   * @param {string} text - Message text
   * @param {string} direction - 'incoming' or 'outgoing'
   * @param {string} platform - 'whatsapp' or 'line'
   * @param {Object} metadata - Additional message data (sender name, files, etc.)
   */
  storeMessage(identifier, text, direction, platform, metadata = {}, customTimestamp = null) {
    if (!identifier || !text) {
      console.log('Missing identifier or text, skipping message storage');
      return;
    }

    // Get or create message array for this identifier
    if (!this.messages.has(identifier)) {
      this.messages.set(identifier, []);
    }

    const messageHistory = this.messages.get(identifier);

    // Use custom timestamp if provided, otherwise use current time
    const timestamp = customTimestamp || Date.now();

    // Add new message
    const message = {
      id: `msg_${timestamp}_${Math.random().toString(36).substr(2, 9)}`,
      text: text,
      direction: direction, // 'incoming' from customer, 'outgoing' from agent
      platform: platform,
      timestamp: timestamp,
      metadata: metadata
    };

    messageHistory.push(message);

    console.log(`📝 Stored ${direction} message for ${identifier} (${platform})`);
    console.log(`   Total messages for this user: ${messageHistory.length}`);

    // Clean up old messages for this user
    this.cleanupUserMessages(identifier);

    return message.id;
  }

  /**
   * Get message history for a specific identifier (last 24 hours)
   * @param {string} identifier - Phone number or user ID
   * @returns {Array} Array of messages in chronological order
   */
  getHistory(identifier) {
    if (!this.messages.has(identifier)) {
      console.log(`No message history found for ${identifier}`);
      return [];
    }

    const messageHistory = this.messages.get(identifier);
    const cutoffTime = Date.now() - (this.TTL_HOURS * 60 * 60 * 1000);

    // Filter messages within 24 hours and sort chronologically
    const recentMessages = messageHistory
      .filter(msg => msg.timestamp > cutoffTime)
      .sort((a, b) => a.timestamp - b.timestamp);

    console.log(`📚 Retrieved ${recentMessages.length} messages for ${identifier} (last 24 hours)`);

    return recentMessages;
  }

  /**
   * Clean up messages older than 24 hours for a specific user
   * @param {string} identifier - Phone number or user ID
   */
  cleanupUserMessages(identifier) {
    if (!this.messages.has(identifier)) {
      return;
    }

    const messageHistory = this.messages.get(identifier);
    const cutoffTime = Date.now() - (this.TTL_HOURS * 60 * 60 * 1000);

    // Keep only messages within 24 hours
    const recentMessages = messageHistory.filter(msg => msg.timestamp > cutoffTime);

    if (recentMessages.length < messageHistory.length) {
      const removed = messageHistory.length - recentMessages.length;
      console.log(`🗑️ Cleaned up ${removed} old messages for ${identifier}`);
      this.messages.set(identifier, recentMessages);
    }

    // If no messages left, remove the user entirely
    if (recentMessages.length === 0) {
      this.messages.delete(identifier);
    }
  }

  /**
   * Clean up all old messages (called periodically)
   */
  cleanupOldMessages() {
    console.log('🧹 Running message history cleanup...');
    let totalCleaned = 0;

    for (const [identifier] of this.messages.entries()) {
      const before = this.messages.get(identifier).length;
      this.cleanupUserMessages(identifier);
      const after = this.messages.has(identifier) ? this.messages.get(identifier).length : 0;
      totalCleaned += (before - after);
    }

    if (totalCleaned > 0) {
      console.log(`🧹 Cleaned up ${totalCleaned} total old messages`);
    }
  }

  /**
   * Get statistics about stored messages
   * @returns {Object} Statistics
   */
  getStats() {
    let totalMessages = 0;
    let totalUsers = this.messages.size;

    for (const messages of this.messages.values()) {
      totalMessages += messages.length;
    }

    return {
      totalUsers,
      totalMessages,
      averageMessagesPerUser: totalUsers > 0 ? Math.round(totalMessages / totalUsers) : 0
    };
  }

  /**
   * Format messages for display in reply portal
   * @param {Array} messages - Array of message objects
   * @returns {Array} Formatted messages for display
   */
  formatForDisplay(messages) {
    return messages.map(msg => ({
      text: msg.text,
      direction: msg.direction,
      timestamp: new Date(msg.timestamp).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Bangkok'
      }),
      senderName: msg.direction === 'incoming'
        ? (msg.metadata.senderName || 'Customer')
        : (msg.metadata.senderName || 'BMAsia Support'),
      files: msg.metadata.files || []
    }));
  }
}

// Export singleton instance
const messageHistory = new MessageHistory();

module.exports = {
  messageHistory,
  normalizePhoneNumber,
  storeMessage: (identifier, text, direction, platform, metadata) =>
    messageHistory.storeMessage(identifier, text, direction, platform, metadata),
  getHistory: (identifier) => messageHistory.getHistory(identifier),
  getStats: () => messageHistory.getStats(),
  formatForDisplay: (messages) => messageHistory.formatForDisplay(messages)
};