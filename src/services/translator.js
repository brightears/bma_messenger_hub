// Translation service for BMA Messenger Hub
// Uses Google Gemini 2.5 Flash for language detection and translation

const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Model configuration
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const TEMPERATURE = parseFloat(process.env.GEMINI_TEMPERATURE) || 0.7;

// Cache for common translations (simple in-memory cache)
const translationCache = new Map();
const CACHE_MAX_SIZE = 100;
const CACHE_TTL = 3600000; // 1 hour in milliseconds

// Languages that don't need translation
const ENGLISH_LANGUAGES = ['english', 'en'];

/**
 * Detects the language of a text using Gemini AI
 * @param {string} text - The text to analyze
 * @returns {Promise<string>} - The detected language name
 */
async function detectLanguage(text) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return 'english'; // Default to English for empty/invalid text
  }

  try {
    console.log('Translator: Detecting language with Gemini...');

    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      generationConfig: {
        temperature: 0.3, // Lower temperature for more consistent detection
        maxOutputTokens: 50,
        topK: 1,
        topP: 0.8,
      },
    });

    const prompt = `What language is this text? Reply with only the language name: ${text.trim()}`;

    const result = await model.generateContent(prompt);
    const response = await result.response;

    if (!response) {
      throw new Error('No response received from Gemini API');
    }

    const detectedLanguage = response.text().toLowerCase().trim();
    console.log('Translator: Detected language:', detectedLanguage);

    return detectedLanguage || 'english';

  } catch (error) {
    console.error('Translator: Error detecting language:', error.message);
    return 'english'; // Default fallback
  }
}

/**
 * Translates text to English using Gemini AI
 * @param {string} text - The text to translate
 * @param {string} sourceLanguage - The source language (for logging)
 * @returns {Promise<string>} - The translated text
 */
async function translateToEnglish(text, sourceLanguage) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return text; // Return original if invalid
  }

  // Check cache first
  const cacheKey = `${sourceLanguage}:${text}`;
  const cached = translationCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log('Translator: Using cached translation');
    return cached.translation;
  }

  try {
    console.log(`Translator: Translating from ${sourceLanguage} to English...`);

    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      generationConfig: {
        temperature: TEMPERATURE,
        maxOutputTokens: 1000, // Allow for longer translations
        topK: 1,
        topP: 0.9,
      },
    });

    const prompt = `Translate to English. Reply with only the translation: ${text.trim()}`;

    const result = await model.generateContent(prompt);
    const response = await result.response;

    if (!response) {
      throw new Error('No response received from Gemini API');
    }

    const translation = response.text().trim();
    console.log('Translator: Translation completed');

    // Cache the translation
    if (translationCache.size >= CACHE_MAX_SIZE) {
      // Remove oldest entry if cache is full
      const firstKey = translationCache.keys().next().value;
      translationCache.delete(firstKey);
    }

    translationCache.set(cacheKey, {
      translation,
      timestamp: Date.now()
    });

    return translation || text; // Return original if translation is empty

  } catch (error) {
    console.error('Translator: Error translating text:', error.message);
    return text; // Return original text if translation fails
  }
}

/**
 * Checks if a language is English or doesn't need translation
 * @param {string} language - The language to check
 * @returns {boolean} - True if the language is English
 */
function isEnglish(language) {
  if (!language || typeof language !== 'string') {
    return true; // Default to English for safety
  }

  const lang = language.toLowerCase().trim();
  return ENGLISH_LANGUAGES.some(englishLang =>
    lang === englishLang || lang.includes(englishLang)
  );
}

/**
 * Formats the message with original and translation
 * @param {string} originalText - The original message
 * @param {string} translatedText - The translated message
 * @param {string} originalLanguage - The original language
 * @returns {string} - Formatted message
 */
function formatTranslatedMessage(originalText, translatedText, originalLanguage) {
  return `${originalText}\n---\n[English Translation]: ${translatedText}`;
}

/**
 * Main translation function - detects language and translates if needed
 * @param {string} messageText - The message to process
 * @returns {Promise<Object>} - Object containing translation results
 */
async function translateMessage(messageText) {
  // Validate input
  if (!messageText || typeof messageText !== 'string') {
    console.warn('Translator: Invalid message text provided');
    return {
      originalLanguage: 'unknown',
      translatedText: messageText || '',
      isTranslated: false,
      error: 'Invalid input text'
    };
  }

  // Check if API key is configured
  if (!process.env.GEMINI_API_KEY) {
    console.error('Translator: GEMINI_API_KEY not configured');
    return {
      originalLanguage: 'unknown',
      translatedText: messageText,
      isTranslated: false,
      error: 'API key not configured'
    };
  }

  const trimmedText = messageText.trim();
  if (trimmedText.length === 0) {
    return {
      originalLanguage: 'unknown',
      translatedText: messageText,
      isTranslated: false,
      error: 'Empty message'
    };
  }

  try {
    // Step 1: Detect language
    const detectedLanguage = await detectLanguage(trimmedText);

    // Step 2: Check if translation is needed
    if (isEnglish(detectedLanguage)) {
      console.log('Translator: Message is already in English, no translation needed');
      return {
        originalLanguage: detectedLanguage,
        translatedText: trimmedText,
        isTranslated: false
      };
    }

    // Step 3: Translate to English
    const translation = await translateToEnglish(trimmedText, detectedLanguage);

    // Step 4: Format the result
    const formattedText = formatTranslatedMessage(trimmedText, translation, detectedLanguage);

    console.log(`Translator: Successfully translated from ${detectedLanguage} to English`);

    return {
      originalLanguage: detectedLanguage,
      translatedText: formattedText,
      isTranslated: true
    };

  } catch (error) {
    console.error('Translator: Error processing message:', error.message);

    // Return safe fallback
    return {
      originalLanguage: 'unknown',
      translatedText: messageText,
      isTranslated: false,
      error: error.message
    };
  }
}

/**
 * Clears the translation cache
 */
function clearCache() {
  translationCache.clear();
  console.log('Translator: Cache cleared');
}

/**
 * Gets cache statistics
 * @returns {Object} - Cache statistics
 */
function getCacheStats() {
  return {
    size: translationCache.size,
    maxSize: CACHE_MAX_SIZE,
    ttl: CACHE_TTL
  };
}

/**
 * Health check for translation service
 * @returns {Promise<Object>} - Health status
 */
async function healthCheck() {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return {
        status: 'error',
        message: 'GEMINI_API_KEY not configured',
        model: MODEL_NAME
      };
    }

    // Test with a simple non-English message
    const testResult = await translateMessage('Hola mundo');

    return {
      status: 'healthy',
      message: 'Translation service is working',
      model: MODEL_NAME,
      cache: getCacheStats(),
      testTranslation: {
        detected: testResult.originalLanguage,
        translated: testResult.isTranslated
      }
    };
  } catch (error) {
    return {
      status: 'error',
      message: error.message,
      model: MODEL_NAME
    };
  }
}

module.exports = {
  translateMessage,
  detectLanguage,
  translateToEnglish,
  isEnglish,
  formatTranslatedMessage,
  clearCache,
  getCacheStats,
  healthCheck
};