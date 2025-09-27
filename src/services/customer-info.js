/**
 * Customer Information Service
 * Tracks customer state and stores collected information
 * Only asks for info on first contact, remembers for 24 hours
 */

class CustomerInfo {
  constructor() {
    // Map: phoneNumber/userId -> customer data
    this.customerData = new Map();
    this.TTL_HOURS = 24;

    // Clean up old data every hour
    setInterval(() => this.cleanupOldData(), 60 * 60 * 1000);
  }

  /**
   * Customer states:
   * - 'new': First contact, need to ask for info
   * - 'gathering_info': Waiting for customer to provide info
   * - 'complete': Info collected, normal flow
   * - 'bypass': Customer bypassed info gathering (timeout or urgent)
   */

  /**
   * Check if this is a new customer
   * @param {string} identifier - Phone number or user ID
   * @returns {boolean} True if new customer
   */
  isNewCustomer(identifier) {
    if (!this.customerData.has(identifier)) {
      return true;
    }

    const customer = this.customerData.get(identifier);
    const now = Date.now();

    // If data is older than 24 hours, treat as new
    if (customer.lastActivity && (now - customer.lastActivity) > (this.TTL_HOURS * 60 * 60 * 1000)) {
      this.customerData.delete(identifier);
      return true;
    }

    return customer.state === 'new';
  }

  /**
   * Check if we need to gather info from customer
   * @param {string} identifier - Phone number or user ID
   * @returns {boolean} True if we should ask for info
   */
  needsInfo(identifier) {
    if (!this.customerData.has(identifier)) {
      return true;
    }

    const customer = this.customerData.get(identifier);
    return customer.state === 'new' || customer.state === 'gathering_info';
  }

  /**
   * Initialize a new customer record
   * @param {string} identifier - Phone number or user ID
   * @param {string} platform - Platform (whatsapp/line)
   */
  initializeCustomer(identifier, platform) {
    const now = Date.now();

    this.customerData.set(identifier, {
      identifier: identifier,
      platform: platform,
      state: 'new',
      name: null,
      businessName: null,
      firstContact: now,
      lastActivity: now,
      messageCount: 0,
      infoRequestSent: false
    });

    console.log(`📝 New customer initialized: ${identifier} (${platform})`);
  }

  /**
   * Update customer state
   * @param {string} identifier - Phone number or user ID
   * @param {string} newState - New state
   */
  updateState(identifier, newState) {
    if (!this.customerData.has(identifier)) {
      return;
    }

    const customer = this.customerData.get(identifier);
    customer.state = newState;
    customer.lastActivity = Date.now();

    console.log(`🔄 Customer ${identifier} state updated to: ${newState}`);
  }

  /**
   * Store customer information
   * @param {string} identifier - Phone number or user ID
   * @param {Object} info - Customer info {name, businessName}
   */
  storeCustomerInfo(identifier, info) {
    if (!this.customerData.has(identifier)) {
      this.initializeCustomer(identifier, 'unknown');
    }

    const customer = this.customerData.get(identifier);

    if (info.name) {
      customer.name = info.name;
    }

    if (info.businessName) {
      customer.businessName = info.businessName;
    }

    customer.state = 'complete';
    customer.lastActivity = Date.now();

    console.log(`✅ Customer info stored for ${identifier}:`, {
      name: customer.name,
      business: customer.businessName
    });
  }

  /**
   * Get customer information
   * @param {string} identifier - Phone number or user ID
   * @returns {Object|null} Customer info or null if not found
   */
  getCustomerInfo(identifier) {
    if (!this.customerData.has(identifier)) {
      return null;
    }

    const customer = this.customerData.get(identifier);

    return {
      name: customer.name,
      businessName: customer.businessName,
      state: customer.state,
      platform: customer.platform,
      firstContact: customer.firstContact,
      messageCount: customer.messageCount
    };
  }

  /**
   * Increment message count for customer
   * @param {string} identifier - Phone number or user ID
   */
  incrementMessageCount(identifier) {
    if (!this.customerData.has(identifier)) {
      return;
    }

    const customer = this.customerData.get(identifier);
    customer.messageCount++;
    customer.lastActivity = Date.now();

    // Auto-bypass after 5 messages without info
    if (customer.messageCount >= 5 && customer.state === 'gathering_info') {
      console.log(`⚠️ Auto-bypassing info gathering for ${identifier} after 5 messages`);
      customer.state = 'bypass';
    }
  }

  /**
   * Mark that info request was sent
   * @param {string} identifier - Phone number or user ID
   */
  markInfoRequestSent(identifier) {
    if (!this.customerData.has(identifier)) {
      return;
    }

    const customer = this.customerData.get(identifier);
    customer.infoRequestSent = true;
    customer.state = 'gathering_info';
    customer.lastActivity = Date.now();

    console.log(`📤 Info request marked as sent for ${identifier}`);
  }

  /**
   * Check if info request was already sent
   * @param {string} identifier - Phone number or user ID
   * @returns {boolean}
   */
  wasInfoRequestSent(identifier) {
    if (!this.customerData.has(identifier)) {
      return false;
    }

    return this.customerData.get(identifier).infoRequestSent;
  }

  /**
   * Check if message should bypass info gathering
   * @param {string} message - Message text
   * @returns {boolean} True if should bypass
   */
  shouldBypass(message) {
    const urgentKeywords = ['urgent', 'emergency', 'asap', 'immediately', 'help'];
    const lowerMessage = message.toLowerCase();

    return urgentKeywords.some(keyword => lowerMessage.includes(keyword));
  }

  /**
   * Clean up old customer data
   */
  cleanupOldData() {
    console.log('🧹 Running customer data cleanup...');
    const now = Date.now();
    const cutoffTime = now - (this.TTL_HOURS * 60 * 60 * 1000);
    let cleaned = 0;

    for (const [identifier, customer] of this.customerData.entries()) {
      if (customer.lastActivity < cutoffTime) {
        this.customerData.delete(identifier);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`🧹 Cleaned up ${cleaned} old customer records`);
    }
  }

  /**
   * Get statistics
   * @returns {Object} Statistics
   */
  getStats() {
    let newCustomers = 0;
    let gatheringInfo = 0;
    let complete = 0;
    let bypass = 0;

    for (const customer of this.customerData.values()) {
      switch (customer.state) {
        case 'new':
          newCustomers++;
          break;
        case 'gathering_info':
          gatheringInfo++;
          break;
        case 'complete':
          complete++;
          break;
        case 'bypass':
          bypass++;
          break;
      }
    }

    return {
      total: this.customerData.size,
      new: newCustomers,
      gatheringInfo: gatheringInfo,
      complete: complete,
      bypass: bypass
    };
  }
}

// Export singleton instance
const customerInfo = new CustomerInfo();

module.exports = {
  customerInfo,
  isNewCustomer: (identifier) => customerInfo.isNewCustomer(identifier),
  needsInfo: (identifier) => customerInfo.needsInfo(identifier),
  initializeCustomer: (identifier, platform) => customerInfo.initializeCustomer(identifier, platform),
  updateState: (identifier, state) => customerInfo.updateState(identifier, state),
  storeCustomerInfo: (identifier, info) => customerInfo.storeCustomerInfo(identifier, info),
  getCustomerInfo: (identifier) => customerInfo.getCustomerInfo(identifier),
  incrementMessageCount: (identifier) => customerInfo.incrementMessageCount(identifier),
  markInfoRequestSent: (identifier) => customerInfo.markInfoRequestSent(identifier),
  wasInfoRequestSent: (identifier) => customerInfo.wasInfoRequestSent(identifier),
  shouldBypass: (message) => customerInfo.shouldBypass(message),
  getCustomerStats: () => customerInfo.getStats()
};