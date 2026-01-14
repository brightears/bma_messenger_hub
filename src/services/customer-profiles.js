/**
 * Customer Profile Service - PostgreSQL Version
 * Stores customer information (name, company, email) by phone number
 * So returning customers don't need to repeat their info
 */

const { Pool } = require('pg');
const { normalizePhoneNumber } = require('./message-history');

class CustomerProfileService {
  constructor() {
    this.pool = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      console.log('⚠️ DATABASE_URL not set - customer profiles will not persist');
      this.initialized = false;
      return;
    }

    try {
      this.pool = new Pool({
        connectionString,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
      });

      // Create table if not exists
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS customer_profiles (
          phone VARCHAR(50) PRIMARY KEY,
          name VARCHAR(255),
          company VARCHAR(255),
          email VARCHAR(255),
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW(),
          last_seen TIMESTAMP DEFAULT NOW()
        )
      `);

      this.initialized = true;
      console.log('✅ Customer profiles PostgreSQL initialized');
    } catch (error) {
      console.error('❌ Failed to initialize PostgreSQL:', error.message);
      this.initialized = false;
    }
  }

  /**
   * Get customer profile by phone number
   * @param {string} phone - Phone number (any format)
   * @returns {Object|null} Customer profile or null if not found
   */
  async getProfile(phone) {
    const normalizedPhone = normalizePhoneNumber(phone);
    if (!normalizedPhone) {
      console.log('Cannot get profile: invalid phone number');
      return null;
    }

    await this.initialize();

    if (!this.pool) {
      console.log('📋 Database not available, no profile found');
      return null;
    }

    try {
      const result = await this.pool.query(
        'SELECT * FROM customer_profiles WHERE phone = $1',
        [normalizedPhone]
      );

      if (result.rows.length > 0) {
        const profile = result.rows[0];
        console.log(`📋 Found customer profile for ${normalizedPhone}:`, {
          name: profile.name,
          company: profile.company,
          hasEmail: !!profile.email
        });

        // Update last seen
        await this.pool.query(
          'UPDATE customer_profiles SET last_seen = NOW() WHERE phone = $1',
          [normalizedPhone]
        );

        return {
          phone: profile.phone,
          name: profile.name,
          company: profile.company,
          email: profile.email,
          createdAt: profile.created_at,
          updatedAt: profile.updated_at,
          lastSeen: profile.last_seen
        };
      }

      console.log(`📋 No profile found for ${normalizedPhone}`);
      return null;
    } catch (error) {
      console.error('Error getting profile:', error.message);
      return null;
    }
  }

  /**
   * Save or update customer profile
   * @param {string} phone - Phone number (any format)
   * @param {Object} data - Profile data { name, company, email }
   * @returns {Object} Updated profile
   */
  async saveProfile(phone, data) {
    const normalizedPhone = normalizePhoneNumber(phone);
    if (!normalizedPhone) {
      console.log('Cannot save profile: invalid phone number');
      return null;
    }

    await this.initialize();

    if (!this.pool) {
      console.log('📋 Database not available, profile not saved');
      return null;
    }

    try {
      // Upsert profile
      const name = data.name?.trim() || null;
      const company = data.company?.trim() || null;
      const email = data.email?.trim()?.toLowerCase() || null;

      const result = await this.pool.query(`
        INSERT INTO customer_profiles (phone, name, company, email)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (phone) DO UPDATE SET
          name = COALESCE(NULLIF($2, ''), customer_profiles.name),
          company = COALESCE(NULLIF($3, ''), customer_profiles.company),
          email = COALESCE(NULLIF($4, ''), customer_profiles.email),
          updated_at = NOW(),
          last_seen = NOW()
        RETURNING *
      `, [normalizedPhone, name, company, email]);

      const profile = result.rows[0];
      console.log(`💾 Saved customer profile for ${normalizedPhone}:`, {
        name: profile.name,
        company: profile.company,
        hasEmail: !!profile.email
      });

      return {
        phone: profile.phone,
        name: profile.name,
        company: profile.company,
        email: profile.email
      };
    } catch (error) {
      console.error('Error saving profile:', error.message);
      return null;
    }
  }

  /**
   * Check if we have any info for a customer
   * @param {string} phone - Phone number
   * @returns {boolean} True if profile exists with at least one field
   */
  async hasProfile(phone) {
    const profile = await this.getProfile(phone);
    if (!profile) return false;
    return !!(profile.name || profile.company || profile.email);
  }

  /**
   * Get statistics
   * @returns {Object} Stats about stored profiles
   */
  async getStats() {
    await this.initialize();

    if (!this.pool) {
      return { totalProfiles: 0, withName: 0, withCompany: 0, withEmail: 0, dbStatus: 'not connected' };
    }

    try {
      const result = await this.pool.query(`
        SELECT
          COUNT(*) as total,
          COUNT(name) as with_name,
          COUNT(company) as with_company,
          COUNT(email) as with_email
        FROM customer_profiles
      `);

      const stats = result.rows[0];
      return {
        totalProfiles: parseInt(stats.total),
        withName: parseInt(stats.with_name),
        withCompany: parseInt(stats.with_company),
        withEmail: parseInt(stats.with_email),
        dbStatus: 'connected'
      };
    } catch (error) {
      console.error('Error getting stats:', error.message);
      return { totalProfiles: 0, withName: 0, withCompany: 0, withEmail: 0, dbStatus: 'error' };
    }
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
