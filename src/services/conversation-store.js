/**
 * Conversation Store Service
 * In-memory storage for mapping Google Chat conversations to platform users
 */

class ConversationStore {
  constructor() {
    // Main storage: conversationId -> conversation data
    this.conversations = new Map();
    // Reverse lookup: platform-user -> conversationId
    this.platformUserMap = new Map();
    this.TTL_HOURS = 24;
  }

  /**
   * Generate a unique conversation ID
   * @returns {string} Unique conversation ID
   */
  generateConversationId() {
    return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Create platform-user key for reverse lookup
   * @param {string} platform - Platform name (whatsapp, line)
   * @param {string} userId - User ID or phone number
   * @returns {string} Platform-user key
   */
  createPlatformUserKey(platform, userId) {
    return `${platform}:${userId}`;
  }

  /**
   * Store a conversation mapping
   * @param {string} platform - Platform name (whatsapp, line)
   * @param {string} userId - User ID or phone number
   * @param {string} gchatThreadId - Google Chat thread ID
   * @param {string} spaceId - Google Chat space ID
   * @param {Object} senderInfo - Additional sender information
   * @returns {string} Conversation ID
   */
  storeConversation(platform, userId, gchatThreadId, spaceId, senderInfo = {}) {
    const conversationId = this.generateConversationId();
    const platformUserKey = this.createPlatformUserKey(platform, userId);
    const now = Date.now();

    const conversation = {
      id: conversationId,
      platform: platform,
      userId: userId,
      threadId: gchatThreadId,  // Changed from gchatThreadId to threadId for consistency
      spaceId: spaceId,
      senderInfo: senderInfo,
      createdAt: now,
      lastActivity: now,
      expiresAt: now + (this.TTL_HOURS * 60 * 60 * 1000)
    };

    console.log(`🔗 Storing conversation mapping:`);
    console.log(`   ID: ${conversationId}`);
    console.log(`   Platform: ${platform}`);
    console.log(`   User: ${userId}`);
    console.log(`   Thread ID: ${gchatThreadId}`);
    console.log(`   Space: ${spaceId}`);

    // Store conversation
    this.conversations.set(conversationId, conversation);

    // Store reverse lookup
    this.platformUserMap.set(platformUserKey, conversationId);

    console.log(`Stored conversation: ${conversationId} for ${platform} user: ${userId}`);
    return conversationId;
  }

  /**
   * Get conversation by conversation ID
   * @param {string} conversationId - Conversation ID
   * @returns {Object|null} Conversation data or null
   */
  getConversation(conversationId) {
    const conversation = this.conversations.get(conversationId);

    if (!conversation) {
      return null;
    }

    // Check if expired
    if (Date.now() > conversation.expiresAt) {
      this.removeConversation(conversationId);
      return null;
    }

    // Update last activity
    conversation.lastActivity = Date.now();
    return conversation;
  }

  /**
   * Get conversation by platform and user ID
   * @param {string} platform - Platform name
   * @param {string} userId - User ID or phone number
   * @returns {Object|null} Conversation data or null
   */
  getConversationByUser(platform, userId) {
    const platformUserKey = this.createPlatformUserKey(platform, userId);
    const conversationId = this.platformUserMap.get(platformUserKey);

    if (!conversationId) {
      return null;
    }

    return this.getConversation(conversationId);
  }

  /**
   * Get conversation by Google Chat thread ID
   * @param {string} gchatThreadId - Google Chat thread ID
   * @returns {Object|null} Conversation data or null
   */
  getConversationByThread(gchatThreadId) {
    console.log(`🔍 Searching for conversation with thread ID: ${gchatThreadId}`);

    // Search through conversations for matching thread ID
    for (const [conversationId, conversation] of this.conversations.entries()) {
      console.log(`   Checking: ${conversation.threadId} === ${gchatThreadId}`);

      if (conversation.threadId === gchatThreadId) {  // Changed from gchatThreadId to threadId
        // Check if expired
        if (Date.now() > conversation.expiresAt) {
          this.removeConversation(conversationId);
          return null;
        }

        // Update last activity
        conversation.lastActivity = Date.now();
        console.log(`   ✅ Found conversation: ${conversationId}`);
        return conversation;
      }
    }

    console.log(`   ❌ No conversation found for thread ${gchatThreadId}`);
    return null;
  }

  /**
   * Update conversation with new activity
   * @param {string} conversationId - Conversation ID
   */
  updateActivity(conversationId) {
    const conversation = this.conversations.get(conversationId);
    if (conversation) {
      conversation.lastActivity = Date.now();
    }
  }

  /**
   * Remove a specific conversation
   * @param {string} conversationId - Conversation ID to remove
   */
  removeConversation(conversationId) {
    const conversation = this.conversations.get(conversationId);
    if (conversation) {
      // Remove from reverse lookup
      const platformUserKey = this.createPlatformUserKey(conversation.platform, conversation.userId);
      this.platformUserMap.delete(platformUserKey);

      // Remove main conversation
      this.conversations.delete(conversationId);

      console.log(`Removed expired conversation: ${conversationId}`);
    }
  }

  /**
   * Clean up expired conversations
   * @returns {number} Number of conversations cleaned up
   */
  clearExpired() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [conversationId, conversation] of this.conversations.entries()) {
      if (now > conversation.expiresAt) {
        this.removeConversation(conversationId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`Cleaned up ${cleanedCount} expired conversations`);
    }

    return cleanedCount;
  }

  /**
   * Get all active conversations (for debugging)
   * @returns {Array} Array of conversation objects
   */
  getAllConversations() {
    this.clearExpired(); // Clean up first
    return Array.from(this.conversations.values());
  }

  /**
   * Get conversation statistics
   * @returns {Object} Statistics about stored conversations
   */
  getStats() {
    this.clearExpired(); // Clean up first

    const stats = {
      totalConversations: this.conversations.size,
      platformBreakdown: {},
      oldestConversation: null,
      newestConversation: null,
      activeConversations: []  // Add list of active conversations for debugging
    };

    for (const conversation of this.conversations.values()) {
      // Platform breakdown
      stats.platformBreakdown[conversation.platform] =
        (stats.platformBreakdown[conversation.platform] || 0) + 1;

      // Age tracking
      if (!stats.oldestConversation || conversation.createdAt < stats.oldestConversation) {
        stats.oldestConversation = conversation.createdAt;
      }

      if (!stats.newestConversation || conversation.createdAt > stats.newestConversation) {
        stats.newestConversation = conversation.createdAt;
      }

      // Add to active conversations list
      stats.activeConversations.push({
        id: conversation.id,
        platform: conversation.platform,
        userId: conversation.userId,
        threadId: conversation.threadId,
        spaceId: conversation.spaceId,
        lastActivity: new Date(conversation.lastActivity).toISOString()
      });
    }

    return stats;
  }
}

// Export singleton instance
const conversationStore = new ConversationStore();

// Set up automatic cleanup every hour
setInterval(() => {
  conversationStore.clearExpired();
}, 60 * 60 * 1000); // 1 hour

module.exports = {
  conversationStore,
  storeConversation: (platform, userId, gchatThreadId, spaceId, senderInfo) =>
    conversationStore.storeConversation(platform, userId, gchatThreadId, spaceId, senderInfo),
  getConversation: (conversationId) => conversationStore.getConversation(conversationId),
  getConversationByUser: (platform, userId) => conversationStore.getConversationByUser(platform, userId),
  getConversationByThread: (gchatThreadId) => conversationStore.getConversationByThread(gchatThreadId),
  updateActivity: (conversationId) => conversationStore.updateActivity(conversationId),
  clearExpired: () => conversationStore.clearExpired(),
  getStats: () => conversationStore.getStats()
};