/**
 * Customer Profile Service
 * Stores customer information (name, company, email) by phone number
 * So returning customers don't need to repeat their info
 */

const { normalizePhoneNumber } = require('./message-history');

class CustomerProfileService {
  constructor() {
    // Map: normalized phone number -> customer profile
    this.profiles = new Map();
  }

  /**
   * Get customer profile by phone number
   * @param {string} phone - Phone number (any format)
   * @returns {Object|null} Customer profile or null if not found
   */
  getProfile(phone) {
    const normalizedPhone = normalizePhoneNumber(phone);
    if (!normalizedPhone) {
      console.log('Cannot get profile: invalid phone number');
      return null;
    }

    const profile = this.profiles.get(normalizedPhone);

    if (profile) {
      console.log(`📋 Found customer profile for ${normalizedPhone}:`, {
        name: profile.name,
        company: profile.company,
        hasEmail: !!profile.email
      });

      // Update last seen
      profile.lastSeen = Date.now();
      return profile;
    }

    console.log(`📋 No profile found for ${normalizedPhone}`);
    return null;
  }

  /**
   * Save or update customer profile
   * @param {string} phone - Phone number (any format)
   * @param {Object} data - Profile data { name, company, email }
   * @returns {Object} Updated profile
   */
  saveProfile(phone, data) {
    const normalizedPhone = normalizePhoneNumber(phone);
    if (!normalizedPhone) {
      console.log('Cannot save profile: invalid phone number');
      return null;
    }

    // Get existing profile or create new one
    const existing = this.profiles.get(normalizedPhone) || {
      phone: normalizedPhone,
      createdAt: Date.now()
    };

    // Merge new data (only update fields that are provided and not empty)
    const updated = {
      ...existing,
      lastSeen: Date.now(),
      updatedAt: Date.now()
    };

    // Only update fields if they have actual values
    if (data.name && data.name.trim()) {
      updated.name = data.name.trim();
    }
    if (data.company && data.company.trim()) {
      updated.company = data.company.trim();
    }
    if (data.email && data.email.trim()) {
      updated.email = data.email.trim().toLowerCase();
    }

    this.profiles.set(normalizedPhone, updated);

    console.log(`💾 Saved customer profile for ${normalizedPhone}:`, {
      name: updated.name,
      company: updated.company,
      hasEmail: !!updated.email
    });

    return updated;
  }

  /**
   * Check if we have any info for a customer
   * @param {string} phone - Phone number
   * @returns {boolean} True if profile exists with at least one field
   */
  hasProfile(phone) {
    const profile = this.getProfile(phone);
    if (!profile) return false;
    return !!(profile.name || profile.company || profile.email);
  }

  /**
   * Get all profiles (for debugging/admin)
   * @returns {Array} All stored profiles
   */
  getAllProfiles() {
    return Array.from(this.profiles.values());
  }

  /**
   * Get statistics
   * @returns {Object} Stats about stored profiles
   */
  getStats() {
    const profiles = this.getAllProfiles();
    return {
      totalProfiles: profiles.length,
      withName: profiles.filter(p => p.name).length,
      withCompany: profiles.filter(p => p.company).length,
      withEmail: profiles.filter(p => p.email).length
    };
  }
}

// Export singleton instance
const customerProfiles = new CustomerProfileService();

module.exports = {
  customerProfiles,
  getProfile: (phone) => customerProfiles.getProfile(phone),
  saveProfile: (phone, data) => customerProfiles.saveProfile(phone, data),
  hasProfile: (phone) => customerProfiles.hasProfile(phone),
  getStats: () => customerProfiles.getStats()
};
