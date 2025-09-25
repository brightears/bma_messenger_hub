// Translation service tests for BMA Messenger Hub
// Tests language detection, translation, and caching functionality

const {
  translateMessage,
  detectLanguage,
  translateToEnglish,
  isEnglish,
  formatTranslatedMessage,
  clearCache,
  getCacheStats,
  healthCheck
} = require('../src/services/translator');

// Mock Google Generative AI
jest.mock('@google/generative-ai');
const { GoogleGenerativeAI } = require('@google/generative-ai');

describe('Translation Service', () => {
  let mockGenAI;
  let mockModel;
  let mockResponse;
  let mockResult;

  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment
    process.env = { ...originalEnv };
    process.env.GEMINI_API_KEY = 'test-api-key';

    // Clear cache before each test
    clearCache();

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

  describe('Language Detection', () => {
    test('should detect English correctly', async () => {
      mockResponse.text.mockReturnValue('english');

      const result = await detectLanguage('Hello, how are you?');

      expect(result).toBe('english');
      expect(mockGenAI.getGenerativeModel).toHaveBeenCalledWith({
        model: 'gemini-2.5-flash',
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 50,
          topK: 1,
          topP: 0.8
        }
      });
      expect(mockModel.generateContent).toHaveBeenCalledWith(
        'What language is this text? Reply with only the language name: Hello, how are you?'
      );
    });

    test('should detect Spanish correctly', async () => {
      mockResponse.text.mockReturnValue('spanish');

      const result = await detectLanguage('Hola, ¿cómo estás?');

      expect(result).toBe('spanish');
      expect(mockModel.generateContent).toHaveBeenCalledWith(
        'What language is this text? Reply with only the language name: Hola, ¿cómo estás?'
      );
    });

    test('should detect French correctly', async () => {
      mockResponse.text.mockReturnValue('french');

      const result = await detectLanguage('Bonjour, comment allez-vous?');

      expect(result).toBe('french');
    });

    test('should handle mixed language text', async () => {
      mockResponse.text.mockReturnValue('mixed languages');

      const result = await detectLanguage('Hello, bonjour, hola');

      expect(result).toBe('mixed languages');
    });

    test('should handle empty input gracefully', async () => {
      const result = await detectLanguage('');

      expect(result).toBe('english');
      expect(mockModel.generateContent).not.toHaveBeenCalled();
    });

    test('should handle null input', async () => {
      const result = await detectLanguage(null);

      expect(result).toBe('english');
      expect(mockModel.generateContent).not.toHaveBeenCalled();
    });

    test('should handle whitespace-only input', async () => {
      const result = await detectLanguage('   \t\n   ');

      expect(result).toBe('english');
      expect(mockModel.generateContent).not.toHaveBeenCalled();
    });

    test('should handle API errors gracefully', async () => {
      mockModel.generateContent.mockRejectedValue(new Error('API Error'));

      const result = await detectLanguage('Some text');

      expect(result).toBe('english');
    });

    test('should handle empty API response', async () => {
      mockResponse.text.mockReturnValue('');

      const result = await detectLanguage('Some text');

      expect(result).toBe('english');
    });

    test('should handle no response from API', async () => {
      mockResult.response = Promise.resolve(null);

      const result = await detectLanguage('Some text');

      expect(result).toBe('english');
    });
  });

  describe('Translation to English', () => {
    test('should translate Spanish to English', async () => {
      mockResponse.text.mockReturnValue('Hello, how are you?');

      const result = await translateToEnglish('Hola, ¿cómo estás?', 'spanish');

      expect(result).toBe('Hello, how are you?');
      expect(mockModel.generateContent).toHaveBeenCalledWith(
        'Translate to English. Reply with only the translation: Hola, ¿cómo estás?'
      );
    });

    test('should translate French to English', async () => {
      mockResponse.text.mockReturnValue('Good morning, how are you doing?');

      const result = await translateToEnglish('Bonjour, comment allez-vous?', 'french');

      expect(result).toBe('Good morning, how are you doing?');
    });

    test('should handle empty input', async () => {
      const result = await translateToEnglish('', 'spanish');

      expect(result).toBe('');
      expect(mockModel.generateContent).not.toHaveBeenCalled();
    });

    test('should handle null input', async () => {
      const result = await translateToEnglish(null, 'spanish');

      expect(result).toBe(null);
      expect(mockModel.generateContent).not.toHaveBeenCalled();
    });

    test('should handle API errors', async () => {
      mockModel.generateContent.mockRejectedValue(new Error('Translation failed'));

      const result = await translateToEnglish('Hola mundo', 'spanish');

      expect(result).toBe('Hola mundo'); // Should return original text
    });

    test('should handle empty translation response', async () => {
      mockResponse.text.mockReturnValue('');

      const result = await translateToEnglish('Hola mundo', 'spanish');

      expect(result).toBe('Hola mundo'); // Should return original text
    });

    test('should use cache for repeated translations', async () => {
      mockResponse.text.mockReturnValue('Hello world');

      // First call
      const result1 = await translateToEnglish('Hola mundo', 'spanish');
      expect(result1).toBe('Hello world');
      expect(mockModel.generateContent).toHaveBeenCalledTimes(1);

      // Second call with same text should use cache
      const result2 = await translateToEnglish('Hola mundo', 'spanish');
      expect(result2).toBe('Hello world');
      expect(mockModel.generateContent).toHaveBeenCalledTimes(1); // No additional API call
    });

    test('should handle cache expiry', async () => {
      mockResponse.text.mockReturnValue('Hello world');

      // Mock Date.now to test cache expiry
      const originalDateNow = Date.now;
      let currentTime = 1000000;
      Date.now = jest.fn(() => currentTime);

      // First call
      await translateToEnglish('Hola mundo', 'spanish');
      expect(mockModel.generateContent).toHaveBeenCalledTimes(1);

      // Advance time beyond cache TTL (1 hour = 3600000ms)
      currentTime += 3600001;

      // Second call should make new API call due to cache expiry
      await translateToEnglish('Hola mundo', 'spanish');
      expect(mockModel.generateContent).toHaveBeenCalledTimes(2);

      Date.now = originalDateNow;
    });
  });

  describe('English Language Detection', () => {
    test('should recognize "english" as English', () => {
      expect(isEnglish('english')).toBe(true);
    });

    test('should recognize "English" as English (case insensitive)', () => {
      expect(isEnglish('English')).toBe(true);
    });

    test('should recognize "en" as English', () => {
      expect(isEnglish('en')).toBe(true);
    });

    test('should recognize "EN" as English', () => {
      expect(isEnglish('EN')).toBe(true);
    });

    test('should recognize partial matches', () => {
      expect(isEnglish('american english')).toBe(true);
      expect(isEnglish('british english')).toBe(true);
    });

    test('should not recognize non-English languages', () => {
      expect(isEnglish('spanish')).toBe(false);
      expect(isEnglish('french')).toBe(false);
      expect(isEnglish('german')).toBe(false);
      expect(isEnglish('japanese')).toBe(false);
    });

    test('should handle null/undefined as English (safe default)', () => {
      expect(isEnglish(null)).toBe(true);
      expect(isEnglish(undefined)).toBe(true);
    });

    test('should handle empty string as English', () => {
      expect(isEnglish('')).toBe(true);
    });

    test('should handle whitespace', () => {
      expect(isEnglish('  english  ')).toBe(true);
      expect(isEnglish('   ')).toBe(true);
    });
  });

  describe('Message Formatting', () => {
    test('should format translated message correctly', () => {
      const result = formatTranslatedMessage(
        'Hola mundo',
        'Hello world',
        'spanish'
      );

      expect(result).toBe('Hola mundo\n---\n[English Translation]: Hello world');
    });

    test('should handle special characters in formatting', () => {
      const result = formatTranslatedMessage(
        'Café, ¿cómo estás?',
        'Coffee, how are you?',
        'spanish'
      );

      expect(result).toBe('Café, ¿cómo estás?\n---\n[English Translation]: Coffee, how are you?');
    });

    test('should handle multiline messages', () => {
      const original = 'Hola\nMundo';
      const translation = 'Hello\nWorld';

      const result = formatTranslatedMessage(original, translation, 'spanish');

      expect(result).toBe('Hola\nMundo\n---\n[English Translation]: Hello\nWorld');
    });
  });

  describe('Main Translation Function', () => {
    test('should detect and translate non-English message', async () => {
      // Mock language detection
      mockResponse.text.mockReturnValueOnce('spanish');
      // Mock translation
      mockResponse.text.mockReturnValueOnce('Hello world');

      const result = await translateMessage('Hola mundo');

      expect(result).toEqual({
        originalLanguage: 'spanish',
        translatedText: 'Hola mundo\n---\n[English Translation]: Hello world',
        isTranslated: true
      });

      expect(mockModel.generateContent).toHaveBeenCalledTimes(2); // Detection + Translation
    });

    test('should skip translation for English message', async () => {
      mockResponse.text.mockReturnValue('english');

      const result = await translateMessage('Hello world');

      expect(result).toEqual({
        originalLanguage: 'english',
        translatedText: 'Hello world',
        isTranslated: false
      });

      expect(mockModel.generateContent).toHaveBeenCalledTimes(1); // Only detection
    });

    test('should handle invalid input gracefully', async () => {
      const result = await translateMessage(null);

      expect(result).toEqual({
        originalLanguage: 'unknown',
        translatedText: '',
        isTranslated: false,
        error: 'Invalid input text'
      });
    });

    test('should handle missing API key', async () => {
      delete process.env.GEMINI_API_KEY;

      const result = await translateMessage('Hello world');

      expect(result).toEqual({
        originalLanguage: 'unknown',
        translatedText: 'Hello world',
        isTranslated: false,
        error: 'API key not configured'
      });
    });

    test('should handle empty message', async () => {
      const result = await translateMessage('   ');

      expect(result).toEqual({
        originalLanguage: 'unknown',
        translatedText: '   ',
        isTranslated: false,
        error: 'Empty message'
      });
    });

    test('should handle detection errors', async () => {
      mockModel.generateContent.mockRejectedValue(new Error('Detection failed'));

      const result = await translateMessage('Some text');

      expect(result).toEqual({
        originalLanguage: 'unknown',
        translatedText: 'Some text',
        isTranslated: false,
        error: 'Detection failed'
      });
    });

    test('should handle complex message with multiple languages', async () => {
      mockResponse.text
        .mockReturnValueOnce('mixed languages')
        .mockReturnValueOnce('Hello world and how are you');

      const result = await translateMessage('Hola world y how are you');

      expect(result).toEqual({
        originalLanguage: 'mixed languages',
        translatedText: 'Hola world y how are you\n---\n[English Translation]: Hello world and how are you',
        isTranslated: true
      });
    });

    test('should handle very long messages', async () => {
      const longMessage = 'Hola ' + 'mundo '.repeat(1000);
      const longTranslation = 'Hello ' + 'world '.repeat(1000);

      mockResponse.text
        .mockReturnValueOnce('spanish')
        .mockReturnValueOnce(longTranslation);

      const result = await translateMessage(longMessage);

      expect(result.isTranslated).toBe(true);
      expect(result.originalLanguage).toBe('spanish');
      expect(result.translatedText).toContain(longTranslation);
    });
  });

  describe('Cache Management', () => {
    test('should provide cache statistics', () => {
      const stats = getCacheStats();

      expect(stats).toEqual({
        size: 0,
        maxSize: 100,
        ttl: 3600000
      });
    });

    test('should track cache size correctly', async () => {
      mockResponse.text.mockReturnValue('Hello world');

      await translateToEnglish('Hola mundo', 'spanish');

      const stats = getCacheStats();
      expect(stats.size).toBe(1);
    });

    test('should clear cache correctly', async () => {
      mockResponse.text.mockReturnValue('Hello world');

      await translateToEnglish('Hola mundo', 'spanish');
      expect(getCacheStats().size).toBe(1);

      clearCache();
      expect(getCacheStats().size).toBe(0);
    });

    test('should handle cache overflow', async () => {
      mockResponse.text.mockReturnValue('Translation');

      // Fill cache beyond max size (100)
      for (let i = 0; i < 105; i++) {
        await translateToEnglish(`Message ${i}`, 'spanish');
      }

      const stats = getCacheStats();
      expect(stats.size).toBeLessThanOrEqual(stats.maxSize);
    });
  });

  describe('Health Check', () => {
    test('should return healthy status when service works', async () => {
      mockResponse.text
        .mockReturnValueOnce('spanish')
        .mockReturnValueOnce('Hello world');

      const result = await healthCheck();

      expect(result).toEqual({
        status: 'healthy',
        message: 'Translation service is working',
        model: 'gemini-2.5-flash',
        cache: {
          size: 1, // Cache will have one entry from test translation
          maxSize: 100,
          ttl: 3600000
        },
        testTranslation: {
          detected: 'spanish',
          translated: true
        }
      });
    });

    test('should return error status when API key missing', async () => {
      delete process.env.GEMINI_API_KEY;

      const result = await healthCheck();

      expect(result).toEqual({
        status: 'error',
        message: 'GEMINI_API_KEY not configured',
        model: 'gemini-2.5-flash'
      });
    });

    test('should handle health check errors', async () => {
      mockModel.generateContent.mockRejectedValue(new Error('Service unavailable'));

      const result = await healthCheck();

      expect(result).toEqual({
        status: 'error',
        message: 'Service unavailable',
        model: 'gemini-2.5-flash'
      });
    });
  });

  describe('Edge Cases and Error Scenarios', () => {
    test('should handle unicode characters correctly', async () => {
      mockResponse.text
        .mockReturnValueOnce('chinese')
        .mockReturnValueOnce('Hello world 👋');

      const result = await translateMessage('你好世界 👋');

      expect(result.isTranslated).toBe(true);
      expect(result.originalLanguage).toBe('chinese');
    });

    test('should handle emoji-only messages', async () => {
      mockResponse.text
        .mockReturnValueOnce('emoji')
        .mockReturnValueOnce('Happy face');

      const result = await translateMessage('😀');

      expect(result.isTranslated).toBe(true);
      expect(result.translatedText).toContain('Happy face');
    });

    test('should handle HTML and special markup', async () => {
      mockResponse.text
        .mockReturnValueOnce('spanish')
        .mockReturnValueOnce('Hello world');

      const result = await translateMessage('<b>Hola</b> mundo');

      expect(result.isTranslated).toBe(true);
      expect(result.translatedText).toContain('Hello world');
    });

    test('should handle concurrent translation requests', async () => {
      mockResponse.text.mockReturnValue('Hello');

      const requests = Array.from({ length: 5 }, (_, i) =>
        translateToEnglish(`Hola ${i}`, 'spanish')
      );

      const results = await Promise.all(requests);

      results.forEach(result => {
        expect(result).toBe('Hello');
      });

      expect(mockModel.generateContent).toHaveBeenCalledTimes(5);
    });

    test('should handle API rate limiting gracefully', async () => {
      mockModel.generateContent.mockRejectedValue(new Error('Rate limit exceeded'));

      const result = await translateMessage('Hola mundo');

      expect(result).toEqual({
        originalLanguage: 'unknown',
        translatedText: 'Hola mundo',
        isTranslated: false,
        error: 'Rate limit exceeded'
      });
    });

    test('should handle network timeouts', async () => {
      mockModel.generateContent.mockRejectedValue(new Error('Network timeout'));

      const result = await translateMessage('Bonjour le monde');

      expect(result).toEqual({
        originalLanguage: 'unknown',
        translatedText: 'Bonjour le monde',
        isTranslated: false,
        error: 'Network timeout'
      });
    });
  });
});