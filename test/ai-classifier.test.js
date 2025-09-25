// AI Classifier tests for BMA Messenger Hub
// Tests Gemini AI classification functionality

const {
  classifyMessage,
  shouldTrustClassification,
  getModelInfo,
  healthCheck,
  VALID_DEPARTMENTS
} = require('../src/services/ai-classifier');

// Mock Google Generative AI
jest.mock('@google/generative-ai');
const { GoogleGenerativeAI } = require('@google/generative-ai');

describe('AI Classifier Service', () => {
  let mockGenAI;
  let mockModel;
  let mockResponse;
  let mockResult;

  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment
    process.env = { ...originalEnv };
    process.env.GEMINI_API_KEY = 'test-api-key';
    process.env.GEMINI_MODEL = 'gemini-2.5-flash';
    process.env.GEMINI_TEMPERATURE = '0.7';

    // Reset all mocks
    jest.clearAllMocks();

    // Set up mock chain
    mockResponse = {
      text: jest.fn()
    };

    mockResult = {
      response: Promise.resolve(mockResponse)
    };

    mockModel = {
      generateContent: jest.fn().mockResolvedValue(mockResult)
    };

    mockGenAI = {
      getGenerativeModel: jest.fn().mockReturnValue(mockModel)
    };

    GoogleGenerativeAI.mockImplementation(() => mockGenAI);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Message Classification', () => {
    test('should classify technical message correctly', async () => {
      mockResponse.text.mockReturnValue('technical');

      const result = await classifyMessage('My application is not working properly');

      expect(result).toEqual({
        department: 'technical',
        confidence: 0.9,
        source: 'gemini',
        rawResponse: 'technical'
      });

      expect(mockGenAI.getGenerativeModel).toHaveBeenCalledWith({
        model: 'gemini-2.5-flash',
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 100,
          topK: 1,
          topP: 0.8
        }
      });
    });

    test('should classify sales message correctly', async () => {
      mockResponse.text.mockReturnValue('sales');

      const result = await classifyMessage('I want to buy your product');

      expect(result).toEqual({
        department: 'sales',
        confidence: 0.9,
        source: 'gemini',
        rawResponse: 'sales'
      });
    });

    test('should classify design message correctly', async () => {
      mockResponse.text.mockReturnValue('design');

      const result = await classifyMessage('I need a logo for my company');

      expect(result).toEqual({
        department: 'design',
        confidence: 0.9,
        source: 'gemini',
        rawResponse: 'design'
      });
    });

    test('should handle partial matches with lower confidence', async () => {
      mockResponse.text.mockReturnValue('I think this is technical support');

      const result = await classifyMessage('Complex technical issue');

      expect(result).toEqual({
        department: 'technical',
        confidence: 0.7,
        source: 'gemini',
        rawResponse: 'i think this is technical support'
      });
    });

    test('should handle case insensitive responses', async () => {
      mockResponse.text.mockReturnValue('SALES');

      const result = await classifyMessage('Pricing information needed');

      expect(result).toEqual({
        department: 'sales',
        confidence: 0.9,
        source: 'gemini',
        rawResponse: 'sales'
      });
    });

    test('should handle responses with extra whitespace', async () => {
      mockResponse.text.mockReturnValue('  technical  ');

      const result = await classifyMessage('Bug report');

      expect(result).toEqual({
        department: 'technical',
        confidence: 0.9,
        source: 'gemini',
        rawResponse: 'technical'
      });
    });

    test('should default to sales for unrecognized responses', async () => {
      mockResponse.text.mockReturnValue('unknown category');

      const result = await classifyMessage('Random message');

      expect(result).toEqual({
        department: 'sales',
        confidence: 0.2,
        source: 'gemini',
        rawResponse: 'unknown category'
      });
    });

    test('should include correct prompt in API call', async () => {
      mockResponse.text.mockReturnValue('technical');

      await classifyMessage('Test message');

      expect(mockModel.generateContent).toHaveBeenCalledWith(
        expect.stringContaining('You are a customer service routing system')
      );
      expect(mockModel.generateContent).toHaveBeenCalledWith(
        expect.stringContaining('Test message')
      );
      expect(mockModel.generateContent).toHaveBeenCalledWith(
        expect.stringContaining('technical: for support, help, issues')
      );
      expect(mockModel.generateContent).toHaveBeenCalledWith(
        expect.stringContaining('sales: for quotes, pricing, purchases')
      );
      expect(mockModel.generateContent).toHaveBeenCalledWith(
        expect.stringContaining('design: for music, soundtracks, branding')
      );
    });

    test('should handle empty message gracefully', async () => {
      const result = await classifyMessage('');

      expect(result).toEqual({
        department: 'sales',
        confidence: 0,
        source: 'default'
      });

      expect(mockModel.generateContent).not.toHaveBeenCalled();
    });

    test('should handle null message', async () => {
      const result = await classifyMessage(null);

      expect(result).toEqual({
        department: 'sales',
        confidence: 0,
        source: 'default'
      });

      expect(mockModel.generateContent).not.toHaveBeenCalled();
    });

    test('should handle non-string message', async () => {
      const result = await classifyMessage(123);

      expect(result).toEqual({
        department: 'sales',
        confidence: 0,
        source: 'default'
      });

      expect(mockModel.generateContent).not.toHaveBeenCalled();
    });

    test('should handle missing API key', async () => {
      delete process.env.GEMINI_API_KEY;

      const result = await classifyMessage('Test message');

      expect(result).toEqual({
        department: 'sales',
        confidence: 0,
        source: 'error'
      });

      expect(mockModel.generateContent).not.toHaveBeenCalled();
    });

    test('should handle API errors', async () => {
      mockModel.generateContent.mockRejectedValue(new Error('API Error'));

      const result = await classifyMessage('Test message');

      expect(result).toEqual({
        department: 'sales',
        confidence: 0,
        source: 'error',
        error: 'API Error'
      });
    });

    test('should handle empty API response', async () => {
      mockResponse.text.mockReturnValue('');

      const result = await classifyMessage('Test message');

      expect(result).toEqual({
        department: 'sales',
        confidence: 0.2,
        source: 'gemini',
        rawResponse: ''
      });
    });

    test('should handle null API response', async () => {
      mockResult.response = Promise.resolve(null);

      const result = await classifyMessage('Test message');

      expect(result).toEqual({
        department: 'sales',
        confidence: 0,
        source: 'error',
        error: 'No response received from Gemini API'
      });
    });

    test('should handle response with no text', async () => {
      mockResponse.text.mockReturnValue(null);

      const result = await classifyMessage('Test message');

      expect(result).toEqual({
        department: 'sales',
        confidence: 0,
        source: 'error',
        error: 'Empty response from Gemini API'
      });
    });

    test('should handle very long messages', async () => {
      mockResponse.text.mockReturnValue('technical');

      const longMessage = 'I have a technical problem: ' + 'details '.repeat(1000);
      const result = await classifyMessage(longMessage);

      expect(result.department).toBe('technical');
      expect(mockModel.generateContent).toHaveBeenCalledWith(
        expect.stringContaining(longMessage.trim())
      );
    });

    test('should handle messages with special characters', async () => {
      mockResponse.text.mockReturnValue('sales');

      const specialMessage = 'Price: $100! @#$%^&*()';
      const result = await classifyMessage(specialMessage);

      expect(result.department).toBe('sales');
      expect(mockModel.generateContent).toHaveBeenCalledWith(
        expect.stringContaining(specialMessage.trim())
      );
    });

    test('should handle unicode characters', async () => {
      mockResponse.text.mockReturnValue('design');

      const unicodeMessage = '我需要设计服务 🎨';
      const result = await classifyMessage(unicodeMessage);

      expect(result.department).toBe('design');
    });
  });

  describe('Confidence Assessment', () => {
    test('should trust high confidence classifications', () => {
      expect(shouldTrustClassification(0.8)).toBe(true);
      expect(shouldTrustClassification(0.9)).toBe(true);
      expect(shouldTrustClassification(1.0)).toBe(true);
    });

    test('should trust minimum threshold confidence', () => {
      expect(shouldTrustClassification(0.6)).toBe(true);
    });

    test('should not trust low confidence classifications', () => {
      expect(shouldTrustClassification(0.5)).toBe(false);
      expect(shouldTrustClassification(0.3)).toBe(false);
      expect(shouldTrustClassification(0.0)).toBe(false);
    });

    test('should handle edge cases', () => {
      expect(shouldTrustClassification(0.59)).toBe(false);
      expect(shouldTrustClassification(0.60)).toBe(true);
      expect(shouldTrustClassification(0.61)).toBe(true);
    });
  });

  describe('Model Information', () => {
    test('should return correct model configuration', () => {
      process.env.GEMINI_MODEL = 'gemini-2.0-flash';
      process.env.GEMINI_TEMPERATURE = '0.5';
      process.env.GEMINI_MAX_TOKENS = '4096';

      const info = getModelInfo();

      expect(info).toEqual({
        model: 'gemini-2.0-flash',
        temperature: 0.5,
        maxTokens: 4096,
        validDepartments: ['technical', 'sales', 'design']
      });
    });

    test('should return default configuration when env vars not set', () => {
      delete process.env.GEMINI_MODEL;
      delete process.env.GEMINI_TEMPERATURE;
      delete process.env.GEMINI_MAX_TOKENS;

      const info = getModelInfo();

      expect(info).toEqual({
        model: 'gemini-2.5-flash',
        temperature: 0.7,
        maxTokens: 8192,
        validDepartments: ['technical', 'sales', 'design']
      });
    });

    test('should handle invalid numeric environment variables', () => {
      process.env.GEMINI_TEMPERATURE = 'invalid';
      process.env.GEMINI_MAX_TOKENS = 'not-a-number';

      const info = getModelInfo();

      expect(info.temperature).toBeNaN();
      expect(info.maxTokens).toBeNaN();
    });
  });

  describe('Health Check', () => {
    test('should return healthy status when service works', async () => {
      mockResponse.text.mockReturnValue('technical');

      const result = await healthCheck();

      expect(result).toEqual({
        status: 'healthy',
        message: 'AI classifier is working',
        model: 'gemini-2.5-flash',
        testClassification: 'technical'
      });

      expect(mockModel.generateContent).toHaveBeenCalledWith(
        expect.stringContaining('test message')
      );
    });

    test('should return error when API key missing', async () => {
      delete process.env.GEMINI_API_KEY;

      const result = await healthCheck();

      expect(result).toEqual({
        status: 'error',
        message: 'GEMINI_API_KEY not configured',
        model: 'gemini-2.5-flash'
      });

      expect(mockModel.generateContent).not.toHaveBeenCalled();
    });

    test('should handle health check API errors', async () => {
      mockModel.generateContent.mockRejectedValue(new Error('Service unavailable'));

      const result = await healthCheck();

      expect(result).toEqual({
        status: 'error',
        message: 'Service unavailable',
        model: 'gemini-2.5-flash'
      });
    });

    test('should use correct model name in health check', async () => {
      process.env.GEMINI_MODEL = 'gemini-pro';
      mockResponse.text.mockReturnValue('sales');

      const result = await healthCheck();

      expect(result.model).toBe('gemini-pro');
    });
  });

  describe('Configuration Validation', () => {
    test('should have all valid departments defined', () => {
      expect(VALID_DEPARTMENTS).toEqual(['technical', 'sales', 'design']);
    });

    test('should have at least one valid department', () => {
      expect(VALID_DEPARTMENTS.length).toBeGreaterThan(0);
    });

    test('should not have duplicate departments', () => {
      const unique = [...new Set(VALID_DEPARTMENTS)];
      expect(VALID_DEPARTMENTS).toEqual(unique);
    });
  });

  describe('Edge Cases and Error Scenarios', () => {
    test('should handle concurrent classification requests', async () => {
      mockResponse.text.mockReturnValue('technical');

      const requests = Array.from({ length: 5 }, (_, i) =>
        classifyMessage(`Message ${i}`)
      );

      const results = await Promise.all(requests);

      results.forEach((result, i) => {
        expect(result.department).toBe('technical');
        expect(result.confidence).toBe(0.9);
      });

      expect(mockModel.generateContent).toHaveBeenCalledTimes(5);
    });

    test('should handle API rate limiting', async () => {
      mockModel.generateContent.mockRejectedValue(new Error('Rate limit exceeded'));

      const result = await classifyMessage('Test message');

      expect(result).toEqual({
        department: 'sales',
        confidence: 0,
        source: 'error',
        error: 'Rate limit exceeded'
      });
    });

    test('should handle network timeouts', async () => {
      mockModel.generateContent.mockRejectedValue(new Error('Network timeout'));

      const result = await classifyMessage('Test message');

      expect(result).toEqual({
        department: 'sales',
        confidence: 0,
        source: 'error',
        error: 'Network timeout'
      });
    });

    test('should handle malformed JSON in response', async () => {
      mockResponse.text.mockReturnValue('{"invalid": json}');

      const result = await classifyMessage('Test message');

      // Should treat as unrecognized response and default to sales
      expect(result.department).toBe('sales');
      expect(result.confidence).toBe(0.2);
    });

    test('should handle responses with multiple department mentions', async () => {
      mockResponse.text.mockReturnValue('This could be technical or sales');

      const result = await classifyMessage('Ambiguous message');

      // Should match first occurrence (technical)
      expect(result.department).toBe('technical');
      expect(result.confidence).toBe(0.7);
    });
  });
});