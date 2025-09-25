/**
 * Message Tracker Service
 * Tracks last processed message ID per Google Chat space to avoid duplicate processing
 */

class MessageTracker {
  constructor() {
    // Map: spaceId -> { lastMessageId, lastTimestamp }
    this.lastProcessed = new Map();
    this.TTL_HOURS = 24;
  }

  /**
   * Get the last processed message ID for a space
   * @param {string} spaceId - Google Chat space ID
   * @returns {string|null} Last processed message ID or null
   */
  getLastProcessed(spaceId) {
    const entry = this.lastProcessed.get(spaceId);

    if (!entry) {
      return null;
    }

    // Check if entry has expired
    const now = Date.now();
    const expiresAt = entry.timestamp + (this.TTL_HOURS * 60 * 60 * 1000);

    if (now > expiresAt) {
      this.lastProcessed.delete(spaceId);
      return null;
    }

    return entry.lastMessageId;
  }

  /**
   * Set the last processed message ID for a space
   * @param {string} spaceId - Google Chat space ID
   * @param {string} messageId - Message ID that was processed
   */
  setLastProcessed(spaceId, messageId) {
    const now = Date.now();

    this.lastProcessed.set(spaceId, {
      lastMessageId: messageId,
      timestamp: now
    });

    console.log(`Updated last processed message for ${spaceId}: ${messageId}`);
  }

  /**
   * Check if a message has already been processed
   * @param {string} spaceId - Google Chat space ID
   * @param {string} messageId - Message ID to check
   * @returns {boolean} True if already processed
   */
  isAlreadyProcessed(spaceId, messageId) {
    const lastProcessed = this.getLastProcessed(spaceId);
    return lastProcessed === messageId;
  }

  /**
   * Check if we should process messages after a certain timestamp
   * @param {string} spaceId - Google Chat space ID
   * @param {string} messageTimestamp - Message timestamp from Google Chat
   * @returns {boolean} True if message is newer than last processed
   */
  shouldProcessMessage(spaceId, messageTimestamp) {
    const entry = this.lastProcessed.get(spaceId);

    if (!entry) {
      // No previous messages tracked, only process recent messages (last hour)
      const messageTime = new Date(messageTimestamp).getTime();
      const oneHourAgo = Date.now() - (60 * 60 * 1000);
      return messageTime > oneHourAgo;
    }

    // Process if message is newer than our last processed timestamp
    const messageTime = new Date(messageTimestamp).getTime();
    return messageTime > entry.timestamp;
  }

  /**
   * Clean up expired entries
   * @returns {number} Number of entries cleaned up
   */
  cleanupExpired() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [spaceId, entry] of this.lastProcessed.entries()) {
      const expiresAt = entry.timestamp + (this.TTL_HOURS * 60 * 60 * 1000);

      if (now > expiresAt) {
        this.lastProcessed.delete(spaceId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`Cleaned up ${cleanedCount} expired message tracker entries`);
    }

    return cleanedCount;
  }

  /**
   * Get tracker statistics
   * @returns {Object} Statistics about tracked spaces
   */
  getStats() {
    this.cleanupExpired(); // Clean up first

    const stats = {
      totalSpaces: this.lastProcessed.size,
      spaces: {}
    };

    for (const [spaceId, entry] of this.lastProcessed.entries()) {
      stats.spaces[spaceId] = {
        lastMessageId: entry.lastMessageId,
        lastProcessedAt: new Date(entry.timestamp).toISOString(),
        age: Date.now() - entry.timestamp
      };
    }

    return stats;
  }

  /**
   * Reset tracking for a specific space (useful for testing)
   * @param {string} spaceId - Google Chat space ID
   */
  resetSpace(spaceId) {
    this.lastProcessed.delete(spaceId);
    console.log(`Reset message tracking for space: ${spaceId}`);
  }

  /**
   * Reset all tracking (useful for testing)
   */
  resetAll() {
    this.lastProcessed.clear();
    console.log('Reset all message tracking');
  }
}

// Export singleton instance
const messageTracker = new MessageTracker();

// Set up automatic cleanup every hour
setInterval(() => {
  messageTracker.cleanupExpired();
}, 60 * 60 * 1000); // 1 hour

module.exports = {
  messageTracker,
  getLastProcessed: (spaceId) => messageTracker.getLastProcessed(spaceId),
  setLastProcessed: (spaceId, messageId) => messageTracker.setLastProcessed(spaceId, messageId),
  isAlreadyProcessed: (spaceId, messageId) => messageTracker.isAlreadyProcessed(spaceId, messageId),
  shouldProcessMessage: (spaceId, messageTimestamp) => messageTracker.shouldProcessMessage(spaceId, messageTimestamp),
  cleanupExpired: () => messageTracker.cleanupExpired(),
  getStats: () => messageTracker.getStats(),
  resetSpace: (spaceId) => messageTracker.resetSpace(spaceId),
  resetAll: () => messageTracker.resetAll()
};