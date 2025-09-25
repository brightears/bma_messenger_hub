// Message routing tests for BMA Messenger Hub
// Tests keyword-based routing and AI classification fallback

const { routeMessage, getDepartments, getKeywordsForDepartment, addKeyword, isValidSpaceId, SPACE_IDS, KEYWORDS } = require('../src/services/message-router');

// Mock the AI classifier
jest.mock('../src/services/ai-classifier');
const aiClassifier = require('../src/services/ai-classifier');

describe('Message Routing Service', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Set up default AI classifier mock
    aiClassifier.classifyMessage.mockResolvedValue({
      department: 'sales',
      confidence: 0.8,
      source: 'gemini',
      rawResponse: 'sales'
    });

    aiClassifier.shouldTrustClassification.mockReturnValue(true);
  });

  describe('Keyword-based Routing', () => {
    describe('Technical Department', () => {
      test('should route "support" to technical', async () => {
        const result = await routeMessage('I need support with my account');

        expect(result).toEqual({
          spaceId: SPACE_IDS.technical,
          department: 'technical',
          source: 'keyword',
          keyword: 'support',
          confidence: 1.0
        });
      });

      test('should route "help" to technical', async () => {
        const result = await routeMessage('Can you help me?');

        expect(result).toEqual({
          spaceId: SPACE_IDS.technical,
          department: 'technical',
          source: 'keyword',
          keyword: 'help',
          confidence: 1.0
        });
      });

      test('should route "issue" to technical', async () => {
        const result = await routeMessage('I have an issue with the application');

        expect(result).toEqual({
          spaceId: SPACE_IDS.technical,
          department: 'technical',
          source: 'keyword',
          keyword: 'issue',
          confidence: 1.0
        });
      });

      test('should route "problem" to technical', async () => {
        const result = await routeMessage('There is a problem with my order');

        expect(result).toEqual({
          spaceId: SPACE_IDS.technical,
          department: 'technical',
          source: 'keyword',
          keyword: 'problem',
          confidence: 1.0
        });
      });

      test('should route "bug" to technical', async () => {
        const result = await routeMessage('Found a bug in your system');

        expect(result).toEqual({
          spaceId: SPACE_IDS.technical,
          department: 'technical',
          source: 'keyword',
          keyword: 'bug',
          confidence: 1.0
        });
      });

      test('should route "not working" to technical', async () => {
        const result = await routeMessage('The feature is not working properly');

        expect(result).toEqual({
          spaceId: SPACE_IDS.technical,
          department: 'technical',
          source: 'keyword',
          keyword: 'not working',
          confidence: 1.0
        });
      });

      test('should route "broken" to technical', async () => {
        const result = await routeMessage('My account is broken');

        expect(result).toEqual({
          spaceId: SPACE_IDS.technical,
          department: 'technical',
          source: 'keyword',
          keyword: 'broken',
          confidence: 1.0
        });
      });

      test('should be case insensitive for technical keywords', async () => {
        const result = await routeMessage('I need HELP with TECHNICAL issues');

        expect(result.department).toBe('technical');
        expect(result.source).toBe('keyword');
      });
    });

    describe('Sales Department', () => {
      test('should route "quote" to sales', async () => {
        const result = await routeMessage('I need a quote for your services');

        expect(result).toEqual({
          spaceId: SPACE_IDS.sales,
          department: 'sales',
          source: 'keyword',
          keyword: 'quote',
          confidence: 1.0
        });
      });

      test('should route "price" to sales', async () => {
        const result = await routeMessage('What is the price of this product?');

        expect(result).toEqual({
          spaceId: SPACE_IDS.sales,
          department: 'sales',
          source: 'keyword',
          keyword: 'price',
          confidence: 1.0
        });
      });

      test('should route "purchase" to sales', async () => {
        const result = await routeMessage('I want to purchase your software');

        expect(result).toEqual({
          spaceId: SPACE_IDS.sales,
          department: 'sales',
          source: 'keyword',
          keyword: 'purchase',
          confidence: 1.0
        });
      });

      test('should route "buy" to sales', async () => {
        const result = await routeMessage('Where can I buy this?');

        expect(result).toEqual({
          spaceId: SPACE_IDS.sales,
          department: 'sales',
          source: 'keyword',
          keyword: 'buy',
          confidence: 1.0
        });
      });

      test('should route "order" to sales', async () => {
        const result = await routeMessage('How do I place an order?');

        expect(result).toEqual({
          spaceId: SPACE_IDS.sales,
          department: 'sales',
          source: 'keyword',
          keyword: 'order',
          confidence: 1.0
        });
      });

      test('should route "pricing" to sales', async () => {
        const result = await routeMessage('Can you send me the pricing information?');

        expect(result).toEqual({
          spaceId: SPACE_IDS.sales,
          department: 'sales',
          source: 'keyword',
          keyword: 'pricing',
          confidence: 1.0
        });
      });

      test('should be case insensitive for sales keywords', async () => {
        const result = await routeMessage('I need a QUOTE for PRICING information');

        expect(result.department).toBe('sales');
        expect(result.source).toBe('keyword');
      });
    });

    describe('Design Department', () => {
      test('should route "design" to design', async () => {
        const result = await routeMessage('I need design work for my project');

        expect(result).toEqual({
          spaceId: SPACE_IDS.design,
          department: 'design',
          source: 'keyword',
          keyword: 'design',
          confidence: 1.0
        });
      });

      test('should route "music" to design', async () => {
        const result = await routeMessage('I need music for my project');

        expect(result).toEqual({
          spaceId: SPACE_IDS.design,
          department: 'design',
          source: 'keyword',
          keyword: 'music',
          confidence: 1.0
        });
      });

      test('should route "soundtrack" to design', async () => {
        const result = await routeMessage('Can you create a soundtrack?');

        expect(result).toEqual({
          spaceId: SPACE_IDS.design,
          department: 'design',
          source: 'keyword',
          keyword: 'soundtrack',
          confidence: 1.0
        });
      });

      test('should route "branding" to design', async () => {
        const result = await routeMessage('We need branding services');

        expect(result).toEqual({
          spaceId: SPACE_IDS.design,
          department: 'design',
          source: 'keyword',
          keyword: 'branding',
          confidence: 1.0
        });
      });

      test('should route "logo" to design', async () => {
        const result = await routeMessage('Can you create a logo for us?');

        expect(result).toEqual({
          spaceId: SPACE_IDS.design,
          department: 'design',
          source: 'keyword',
          keyword: 'logo',
          confidence: 1.0
        });
      });

      test('should be case insensitive for design keywords', async () => {
        const result = await routeMessage('I need MUSIC and DESIGN services');

        expect(result.department).toBe('design');
        expect(result.source).toBe('keyword');
      });
    });

    describe('Keyword Priority', () => {
      test('should match first found keyword when multiple present', async () => {
        // Technical keywords appear first in the code, so "support" should match before "price"
        const result = await routeMessage('I need support with pricing information');

        expect(result.department).toBe('technical');
        expect(result.keyword).toBe('support');
      });

      test('should match partial keyword matches', async () => {
        const result = await routeMessage('My application has errors');

        expect(result.department).toBe('technical');
        expect(result.keyword).toBe('error');
      });

      test('should handle keywords in different parts of message', async () => {
        const result = await routeMessage('Hello there, I have a question about pricing for your services');

        expect(result.department).toBe('sales');
        expect(result.keyword).toBe('pricing');
      });
    });
  });

  describe('AI Classification Fallback', () => {
    test('should use AI when no keywords match', async () => {
      aiClassifier.classifyMessage.mockResolvedValue({
        department: 'technical',
        confidence: 0.8,
        source: 'gemini',
        rawResponse: 'technical'
      });

      const result = await routeMessage('The application is malfunctioning');

      expect(result).toEqual({
        spaceId: SPACE_IDS.technical,
        department: 'technical',
        source: 'ai',
        confidence: 0.8,
        aiResponse: 'technical'
      });

      expect(aiClassifier.classifyMessage).toHaveBeenCalledWith('The application is malfunctioning');
      expect(aiClassifier.shouldTrustClassification).toHaveBeenCalledWith(0.8);
    });

    test('should use AI classification for design department', async () => {
      aiClassifier.classifyMessage.mockResolvedValue({
        department: 'design',
        confidence: 0.9,
        source: 'gemini',
        rawResponse: 'design'
      });

      const result = await routeMessage('I need services for my corporate identity');

      expect(result).toEqual({
        spaceId: SPACE_IDS.design,
        department: 'design',
        source: 'ai',
        confidence: 0.9,
        aiResponse: 'design'
      });
    });

    test('should default to sales when AI confidence too low', async () => {
      aiClassifier.classifyMessage.mockResolvedValue({
        department: 'technical',
        confidence: 0.4,
        source: 'gemini',
        rawResponse: 'technical'
      });

      aiClassifier.shouldTrustClassification.mockReturnValue(false);

      const result = await routeMessage('This is an ambiguous message');

      expect(result).toEqual({
        spaceId: SPACE_IDS.sales,
        department: 'sales',
        source: 'default',
        confidence: 0
      });
    });

    test('should default to sales when AI classification fails', async () => {
      aiClassifier.classifyMessage.mockRejectedValue(new Error('AI service down'));

      const result = await routeMessage('Random message without keywords');

      expect(result).toEqual({
        spaceId: SPACE_IDS.sales,
        department: 'sales',
        source: 'default',
        confidence: 0
      });
    });

    test('should prefer keyword matching over AI when both available', async () => {
      // This message has "support" keyword but AI might classify differently
      const result = await routeMessage('I need support for creative projects');

      // Should match keyword first
      expect(result.department).toBe('technical');
      expect(result.source).toBe('keyword');
      expect(result.keyword).toBe('support');

      // AI should not be called when keyword matches
      expect(aiClassifier.classifyMessage).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('should handle null message', async () => {
      const result = await routeMessage(null);

      expect(result).toEqual({
        spaceId: SPACE_IDS.sales,
        department: 'sales',
        source: 'default',
        confidence: 0
      });
    });

    test('should handle undefined message', async () => {
      const result = await routeMessage(undefined);

      expect(result).toEqual({
        spaceId: SPACE_IDS.sales,
        department: 'sales',
        source: 'default',
        confidence: 0
      });
    });

    test('should handle empty string', async () => {
      const result = await routeMessage('');

      expect(result).toEqual({
        spaceId: SPACE_IDS.sales,
        department: 'sales',
        source: 'default',
        confidence: 0
      });
    });

    test('should handle non-string input', async () => {
      const result = await routeMessage(123);

      expect(result).toEqual({
        spaceId: SPACE_IDS.sales,
        department: 'sales',
        source: 'default',
        confidence: 0
      });
    });

    test('should handle whitespace only message', async () => {
      // Mock AI response for whitespace message that gets through
      aiClassifier.classifyMessage.mockResolvedValue({
        department: 'sales',
        confidence: 0.8,
        source: 'gemini',
        rawResponse: 'sales'
      });

      const result = await routeMessage('   \t\n   ');

      expect(result).toEqual({
        spaceId: SPACE_IDS.sales,
        department: 'sales',
        source: 'ai',
        confidence: 0.8,
        aiResponse: 'sales'
      });
    });

    test('should handle very long messages', async () => {
      const longMessage = 'I need support ' + 'a'.repeat(10000);

      const result = await routeMessage(longMessage);

      expect(result.department).toBe('technical');
      expect(result.source).toBe('keyword');
      expect(result.keyword).toBe('support');
    });

    test('should handle special characters', async () => {
      const result = await routeMessage('I need support! @#$%^&*()');

      expect(result.department).toBe('technical');
      expect(result.source).toBe('keyword');
      expect(result.keyword).toBe('support');
    });

    test('should handle unicode characters', async () => {
      const result = await routeMessage('我需要技术支持 support 👍');

      expect(result.department).toBe('technical');
      expect(result.source).toBe('keyword');
      expect(result.keyword).toBe('support');
    });
  });

  describe('Utility Functions', () => {
    describe('getDepartments', () => {
      test('should return all departments with space IDs', () => {
        const departments = getDepartments();

        expect(departments).toEqual({
          technical: 'spaces/AAQA6WeunF8',
          design: 'spaces/AAQALSfR5k4',
          sales: 'spaces/AAQAfKFrdxQ'
        });
      });

      test('should return a copy, not reference', () => {
        const departments1 = getDepartments();
        const departments2 = getDepartments();

        expect(departments1).toEqual(departments2);
        expect(departments1).not.toBe(departments2);
      });
    });

    describe('getKeywordsForDepartment', () => {
      test('should return technical keywords', () => {
        const keywords = getKeywordsForDepartment('technical');

        expect(keywords).toContain('support');
        expect(keywords).toContain('help');
        expect(keywords).toContain('issue');
        expect(keywords).toContain('problem');
        expect(keywords).toContain('bug');
      });

      test('should return sales keywords', () => {
        const keywords = getKeywordsForDepartment('sales');

        expect(keywords).toContain('quote');
        expect(keywords).toContain('price');
        expect(keywords).toContain('purchase');
        expect(keywords).toContain('buy');
        expect(keywords).toContain('order');
      });

      test('should return design keywords', () => {
        const keywords = getKeywordsForDepartment('design');

        expect(keywords).toContain('design');
        expect(keywords).toContain('music');
        expect(keywords).toContain('soundtrack');
        expect(keywords).toContain('branding');
        expect(keywords).toContain('logo');
      });

      test('should return empty array for unknown department', () => {
        const keywords = getKeywordsForDepartment('unknown');

        expect(keywords).toEqual([]);
      });
    });

    describe('addKeyword', () => {
      test('should add new keyword to existing department', () => {
        const result = addKeyword('technical', 'malfunction');

        expect(result).toBe(true);
        expect(KEYWORDS.technical).toContain('malfunction');
      });

      test('should not add duplicate keyword', () => {
        const result = addKeyword('technical', 'support'); // already exists

        expect(result).toBe(false);
      });

      test('should return false for unknown department', () => {
        const result = addKeyword('unknown', 'keyword');

        expect(result).toBe(false);
      });

      test('should handle case insensitive addition', () => {
        const result = addKeyword('sales', 'COMMISSION');

        expect(result).toBe(true);
        expect(KEYWORDS.sales).toContain('commission');
      });
    });

    describe('isValidSpaceId', () => {
      test('should validate correct space ID format', () => {
        expect(isValidSpaceId('spaces/AAQA6WeunF8')).toBe(true);
        expect(isValidSpaceId('spaces/test123')).toBe(true);
      });

      test('should reject invalid formats', () => {
        expect(isValidSpaceId('invalid')).toBe(false);
        expect(isValidSpaceId('space/test')).toBe(false);
        expect(isValidSpaceId('')).toBeFalsy();
        expect(isValidSpaceId(null)).toBeFalsy();
        expect(isValidSpaceId(undefined)).toBeFalsy();
      });

      test('should reject non-string inputs', () => {
        expect(isValidSpaceId(123)).toBe(false);
        expect(isValidSpaceId({})).toBe(false);
        expect(isValidSpaceId([])).toBe(false);
      });
    });
  });

  describe('Configuration Validation', () => {
    test('should have all required space IDs configured', () => {
      expect(SPACE_IDS.technical).toBe('spaces/AAQA6WeunF8');
      expect(SPACE_IDS.design).toBe('spaces/AAQALSfR5k4');
      expect(SPACE_IDS.sales).toBe('spaces/AAQAfKFrdxQ');
    });

    test('should have keywords for all departments', () => {
      expect(KEYWORDS.technical.length).toBeGreaterThan(0);
      expect(KEYWORDS.sales.length).toBeGreaterThan(0);
      expect(KEYWORDS.design.length).toBeGreaterThan(0);
    });

    test('should have no duplicate keywords within departments', () => {
      Object.values(KEYWORDS).forEach(keywordList => {
        const unique = [...new Set(keywordList)];
        expect(keywordList).toEqual(unique);
      });
    });
  });
});