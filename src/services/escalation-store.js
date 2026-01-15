/**
 * Escalation Store Service
 * Tracks phone numbers that have been escalated to human team
 * No auto-expiration - team must manually close escalations via reply portal
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

class EscalationStore {
  constructor() {
    // Map: normalizedPhone -> { escalatedAt, threadId, customerName, conversationId, conversationHistory }
    this.escalatedPhones = new Map();
  }

  /**
   * Mark a phone number as escalated
   * @param {string} phone - Customer phone number
   * @param {string} threadId - Google Chat thread ID for replies
   * @param {string} customerName - Customer name if known
   * @param {string} conversationId - ElevenLabs conversation ID
   * @param {Array} conversationHistory - Parsed messages from the escalation
   */
  markEscalated(phone, threadId, customerName, conversationId, conversationHistory = []) {
    const normalizedPhone = normalizePhoneNumber(phone);
    if (!normalizedPhone) {
      console.log('Cannot mark escalated: invalid phone number');
      return false;
    }

    this.escalatedPhones.set(normalizedPhone, {
      escalatedAt: Date.now(),
      threadId,
      customerName: customerName || 'Unknown',
      conversationId,
      conversationHistory
    });

    console.log(`[Escalation] Marked ${normalizedPhone} as escalated`);
    console.log(`  Customer: ${customerName || 'Unknown'}`);
    console.log(`  Conversation ID: ${conversationId}`);
    console.log(`  History messages: ${conversationHistory.length}`);

    return true;
  }

  /**
   * Check if a phone number is currently escalated
   * @param {string} phone - Customer phone number
   * @returns {boolean} True if escalated
   */
  isEscalated(phone) {
    const normalizedPhone = normalizePhoneNumber(phone);
    if (!normalizedPhone) return false;
    return this.escalatedPhones.has(normalizedPhone);
  }

  /**
   * Get escalation info for a phone number
   * @param {string} phone - Customer phone number
   * @returns {Object|null} Escalation info or null
   */
  getEscalationInfo(phone) {
    const normalizedPhone = normalizePhoneNumber(phone);
    if (!normalizedPhone) return null;
    return this.escalatedPhones.get(normalizedPhone) || null;
  }

  /**
   * Clear escalation for a phone number (manual close by team)
   * @param {string} phone - Customer phone number
   * @returns {boolean} True if escalation was cleared
   */
  clearEscalation(phone) {
    const normalizedPhone = normalizePhoneNumber(phone);
    if (!normalizedPhone) return false;

    const existed = this.escalatedPhones.has(normalizedPhone);
    if (existed) {
      this.escalatedPhones.delete(normalizedPhone);
      console.log(`[Escalation] Cleared escalation for ${normalizedPhone}`);
    }

    return existed;
  }

  /**
   * Get all currently escalated phone numbers
   * @returns {Array} Array of { phone, info } objects
   */
  getAllEscalated() {
    const result = [];
    for (const [phone, info] of this.escalatedPhones.entries()) {
      result.push({ phone, ...info });
    }
    return result;
  }

  /**
   * Get statistics about escalations
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      totalEscalated: this.escalatedPhones.size,
      phones: Array.from(this.escalatedPhones.keys())
    };
  }
}

// Export singleton instance
const escalationStore = new EscalationStore();

module.exports = {
  escalationStore,
  normalizePhoneNumber,
  markEscalated: (phone, threadId, customerName, conversationId, conversationHistory) =>
    escalationStore.markEscalated(phone, threadId, customerName, conversationId, conversationHistory),
  isEscalated: (phone) => escalationStore.isEscalated(phone),
  getEscalationInfo: (phone) => escalationStore.getEscalationInfo(phone),
  clearEscalation: (phone) => escalationStore.clearEscalation(phone),
  getAllEscalated: () => escalationStore.getAllEscalated(),
  getStats: () => escalationStore.getStats()
};
