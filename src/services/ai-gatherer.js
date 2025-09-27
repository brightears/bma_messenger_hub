/**
 * AI Gatherer Service
 * Uses Gemini AI to gather customer information intelligently
 * Generates polite requests and parses responses
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

class AIGatherer {
  constructor() {
    this.genAI = null;
    this.model = null;
    this.initialized = false;
    this.enabled = process.env.ENABLE_AI_GATHERING !== 'false'; // Default enabled
  }

  /**
   * Initialize Gemini AI
   */
  async initialize() {
    try {
      if (!this.enabled) {
        console.log('AI gathering is disabled via ENABLE_AI_GATHERING env var');
        return false;
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        console.log('AI gathering disabled - no GEMINI_API_KEY found');
        this.enabled = false;
        return false;
      }

      this.genAI = new GoogleGenerativeAI(apiKey);
      this.model = this.genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' });
      this.initialized = true;
      console.log(`✨ AI gatherer initialized with ${process.env.GEMINI_MODEL || 'gemini-2.5-flash'}`);
      return true;
    } catch (error) {
      console.error('Failed to initialize AI gatherer:', error.message);
      this.enabled = false;
      return false;
    }
  }

  /**
   * Generate a polite info request message
   * @param {string} platform - Platform (whatsapp/line)
   * @param {string} originalMessage - The customer's original message
   * @param {string} language - Language hint (en/th)
   * @returns {string} Polite request message
   */
  async generateInfoRequest(platform, originalMessage, language = 'en') {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.initialized) {
      // Fallback message if AI is not available
      return language === 'th'
        ? "สวัสดีค่ะ/ครับ ขอบคุณที่ติดต่อ BMAsia เพื่อให้บริการได้ดียิ่งขึ้น กรุณาแจ้งชื่อและชื่อบริษัทของท่านด้วยค่ะ/ครับ"
        : "Hello! Thank you for contacting BMAsia. To assist you better, could you please share your name and company name?";
    }

    try {
      const prompt = `Generate a polite, professional message asking a customer for their name and company name.
      Context:
      - Platform: ${platform}
      - Customer's message: "${originalMessage}"
      - Language: ${language === 'th' ? 'Thai' : 'English'}
      - Company name: BMAsia (music and sound design company)

      Requirements:
      - Be warm and welcoming
      - Acknowledge their message briefly
      - Ask for their name and company name
      - Keep it short (1-2 sentences)
      - Use appropriate language and tone for ${platform}
      ${language === 'th' ? '- Use polite Thai language with ค่ะ/ครับ' : ''}

      Provide only the message text, no quotes or formatting.`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const message = response.text().trim();

      return message || this.getDefaultInfoRequest(language);
    } catch (error) {
      console.error('AI generation failed, using fallback:', error.message);
      return this.getDefaultInfoRequest(language);
    }
  }

  /**
   * Parse customer response to extract name and business
   * @param {string} customerResponse - Customer's response message
   * @param {string} context - Previous conversation context
   * @returns {Object} {name, businessName, confidence}
   */
  async parseCustomerInfo(customerResponse, context = '') {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.initialized) {
      // Simple fallback parsing
      return this.fallbackParse(customerResponse);
    }

    try {
      const prompt = `Extract customer name and company name from their response.

      Context: We asked the customer to provide their name and company name.
      Customer response: "${customerResponse}"

      Extract and return in JSON format:
      {
        "name": "extracted personal name or null",
        "businessName": "extracted company/business name or null",
        "confidence": "high/medium/low",
        "needsMoreInfo": true/false
      }

      Rules:
      - Extract personal name (first name or full name)
      - Extract company/business/organization name
      - If info is unclear, set needsMoreInfo to true
      - Set confidence based on clarity of extraction
      - Return null for fields not found

      Examples:
      "I'm John from ABC Company" -> {"name": "John", "businessName": "ABC Company", "confidence": "high", "needsMoreInfo": false}
      "My name is Sarah, ABC Corp" -> {"name": "Sarah", "businessName": "ABC Corp", "confidence": "high", "needsMoreInfo": false}
      "John Smith" -> {"name": "John Smith", "businessName": null, "confidence": "medium", "needsMoreInfo": true}

      Return only valid JSON.`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const responseText = response.text();

      // Clean and parse JSON
      const cleanJson = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleanJson);

      console.log('📋 AI parsed customer info:', parsed);
      return parsed;
    } catch (error) {
      console.error('AI parsing failed, using fallback:', error.message);
      return this.fallbackParse(customerResponse);
    }
  }

  /**
   * Detect language from message
   * @param {string} message - Message to analyze
   * @returns {string} Language code (en/th)
   */
  async detectLanguage(message) {
    // Simple detection - check for Thai characters
    const hasThai = /[ก-๏]/.test(message);
    return hasThai ? 'th' : 'en';
  }

  /**
   * Get default info request message
   * @param {string} language - Language code
   * @returns {string} Default message
   */
  getDefaultInfoRequest(language) {
    const messages = {
      en: "Hello! Thank you for contacting BMAsia. To assist you better, could you please share your name and company name?",
      th: "สวัสดีค่ะ/ครับ ขอบคุณที่ติดต่อ BMAsia เพื่อให้บริการได้ดียิ่งขึ้น กรุณาแจ้งชื่อและชื่อบริษัทของท่านด้วยค่ะ/ครับ"
    };

    return messages[language] || messages.en;
  }

  /**
   * Simple fallback parser when AI is not available
   * @param {string} text - Text to parse
   * @returns {Object} Parsed info
   */
  fallbackParse(text) {
    const result = {
      name: null,
      businessName: null,
      confidence: 'low',
      needsMoreInfo: true
    };

    // Look for common patterns
    const namePatterns = [
      /(?:I'?m |my name is |this is |nama saya |ผม|ฉัน|ดิฉัน)\s*([A-Za-z\u0E00-\u0E7F\s]+)/i,
      /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/
    ];

    const companyPatterns = [
      /(?:from |at |with |company |บริษัท|องค์กร)\s*([A-Za-z0-9\u0E00-\u0E7F\s&.-]+)/i,
      /([A-Za-z0-9\s&.-]+)\s*(?:company|corp|corporation|ltd|limited|inc|co\.|บริษัท|จำกัด)/i
    ];

    // Try to extract name
    for (const pattern of namePatterns) {
      const match = text.match(pattern);
      if (match) {
        result.name = match[1].trim();
        result.confidence = 'medium';
        break;
      }
    }

    // Try to extract company
    for (const pattern of companyPatterns) {
      const match = text.match(pattern);
      if (match) {
        result.businessName = match[1].trim();
        result.confidence = result.name ? 'medium' : 'low';
        break;
      }
    }

    // Check if we got both
    if (result.name && result.businessName) {
      result.confidence = 'medium';
      result.needsMoreInfo = false;
    }

    return result;
  }

  /**
   * Generate a follow-up question if needed
   * @param {Object} parsedInfo - Previously parsed info
   * @param {string} language - Language code
   * @returns {string|null} Follow-up question or null
   */
  async generateFollowUp(parsedInfo, language = 'en') {
    if (!parsedInfo.needsMoreInfo) {
      return null;
    }

    if (!parsedInfo.name && !parsedInfo.businessName) {
      // Still need both
      return this.getDefaultInfoRequest(language);
    } else if (!parsedInfo.name) {
      // Need name
      return language === 'th'
        ? "ขอบคุณค่ะ/ครับ กรุณาแจ้งชื่อของท่านด้วยค่ะ/ครับ"
        : "Thank you! Could you also share your name?";
    } else if (!parsedInfo.businessName) {
      // Need company
      return language === 'th'
        ? "ขอบคุณค่ะ/ครับ คุณ" + parsedInfo.name + " กรุณาแจ้งชื่อบริษัทด้วยค่ะ/ครับ"
        : "Thank you, " + parsedInfo.name + "! Could you also share your company name?";
    }

    return null;
  }

  /**
   * Check if AI gathering is enabled
   * @returns {boolean}
   */
  isEnabled() {
    return this.enabled && this.initialized;
  }
}

// Export singleton instance
const aiGatherer = new AIGatherer();

module.exports = {
  aiGatherer,
  initializeAIGatherer: () => aiGatherer.initialize(),
  generateInfoRequest: (platform, message, language) =>
    aiGatherer.generateInfoRequest(platform, message, language),
  parseCustomerInfo: (response, context) =>
    aiGatherer.parseCustomerInfo(response, context),
  detectLanguage: (message) =>
    aiGatherer.detectLanguage(message),
  generateFollowUp: (parsedInfo, language) =>
    aiGatherer.generateFollowUp(parsedInfo, language),
  isAIGatheringEnabled: () =>
    aiGatherer.isEnabled()
};