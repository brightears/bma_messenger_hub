import axios from 'axios';
import { logger } from '../../utils/logger';
import { config } from '../../config';

// Forward declaration to avoid circular dependency
export enum SupportedLanguage {
  ENGLISH = 'en',
  THAI = 'th',
  CHINESE_SIMPLIFIED = 'zh-cn',
  CHINESE_TRADITIONAL = 'zh-tw',
  SPANISH = 'es',
  FRENCH = 'fr',
  GERMAN = 'de',
  JAPANESE = 'ja',
  KOREAN = 'ko',
  VIETNAMESE = 'vi',
  MALAY = 'ms',
  INDONESIAN = 'id',
  PORTUGUESE = 'pt',
  ITALIAN = 'it',
  RUSSIAN = 'ru',
  ARABIC = 'ar',
  HINDI = 'hi'
}

/**
 * Language detection result interface
 */
export interface LanguageDetectionResult {
  language: string;
  confidence: number;
  alternativeLanguages: Array<{
    language: string;
    confidence: number;
  }>;
}

/**
 * Language detection patterns for common languages
 */
interface LanguagePattern {
  language: string;
  patterns: RegExp[];
  characterSets: RegExp[];
  commonWords: string[];
}

/**
 * Language detector class
 */
export class LanguageDetector {
  private patterns: LanguagePattern[];
  private cache: Map<string, LanguageDetectionResult>;
  private readonly maxCacheSize = 500;

  constructor() {
    this.patterns = this.initializeLanguagePatterns();
    this.cache = new Map();

    logger.debug('LanguageDetector initialized', {
      patternsCount: this.patterns.length,
      supportedLanguages: this.patterns.map(p => p.language),
    });
  }

  /**
   * Detect language of the given text
   */
  async detectLanguage(text: string): Promise<string> {
    try {
      if (!text?.trim()) {
        return SupportedLanguage.ENGLISH; // Default fallback
      }

      // Check cache first
      const cacheKey = this.generateCacheKey(text);
      const cachedResult = this.cache.get(cacheKey);
      if (cachedResult) {
        return cachedResult.language;
      }

      // Try pattern-based detection first (faster)
      const patternResult = this.detectByPatterns(text);
      if (patternResult.confidence > 0.8) {
        this.updateCache(cacheKey, patternResult);
        return patternResult.language;
      }

      // Fall back to AI-based detection for ambiguous cases
      const aiResult = await this.detectWithAI(text);
      this.updateCache(cacheKey, aiResult);

      return aiResult.language;
    } catch (error) {
      logger.warn('Language detection failed, using fallback', {
        error: error instanceof Error ? error.message : String(error),
        textLength: text?.length || 0,
      });

      // Fallback to English if detection fails
      return SupportedLanguage.ENGLISH;
    }
  }

  /**
   * Detect language with detailed results
   */
  async detectLanguageDetailed(text: string): Promise<LanguageDetectionResult> {
    try {
      if (!text?.trim()) {
        return {
          language: SupportedLanguage.ENGLISH,
          confidence: 0.5,
          alternativeLanguages: [],
        };
      }

      const cacheKey = this.generateCacheKey(text);
      const cachedResult = this.cache.get(cacheKey);
      if (cachedResult) {
        return cachedResult;
      }

      // Try pattern-based detection
      const patternResult = this.detectByPatterns(text);
      if (patternResult.confidence > 0.8) {
        this.updateCache(cacheKey, patternResult);
        return patternResult;
      }

      // Use AI for better accuracy
      const aiResult = await this.detectWithAI(text);
      this.updateCache(cacheKey, aiResult);

      return aiResult;
    } catch (error) {
      logger.error('Detailed language detection failed', {
        error: error instanceof Error ? error.message : String(error),
        textLength: text?.length || 0,
      });

      return {
        language: SupportedLanguage.ENGLISH,
        confidence: 0.3,
        alternativeLanguages: [],
      };
    }
  }

  /**
   * Pattern-based language detection (fast, local)
   */
  private detectByPatterns(text: string): LanguageDetectionResult {
    const cleanText = text.toLowerCase().trim();
    const scores: Map<string, number> = new Map();

    // Initialize scores
    this.patterns.forEach(pattern => {
      scores.set(pattern.language, 0);
    });

    for (const pattern of this.patterns) {
      let score = 0;

      // Check character sets
      for (const charSet of pattern.characterSets) {
        const matches = cleanText.match(charSet);
        if (matches) {
          score += matches.length * 2; // Character sets are strong indicators
        }
      }

      // Check regex patterns
      for (const regex of pattern.patterns) {
        const matches = cleanText.match(regex);
        if (matches) {
          score += matches.length;
        }
      }

      // Check common words
      for (const word of pattern.commonWords) {
        const wordRegex = new RegExp(`\\b${word}\\b`, 'gi');
        const matches = cleanText.match(wordRegex);
        if (matches) {
          score += matches.length * 1.5; // Common words are good indicators
        }
      }

      scores.set(pattern.language, score);
    }

    // Normalize scores based on text length
    const textLength = cleanText.length;
    const normalizedScores = Array.from(scores.entries()).map(([lang, score]) => ({
      language: lang,
      score: textLength > 0 ? score / textLength : 0,
    }));

    // Sort by score
    normalizedScores.sort((a, b) => b.score - a.score);

    const topResult = normalizedScores[0];
    const confidence = Math.min(topResult.score * 10, 1.0); // Scale to 0-1

    // Generate alternative languages
    const alternatives = normalizedScores
      .slice(1, 4) // Top 3 alternatives
      .filter(result => result.score > 0)
      .map(result => ({
        language: result.language,
        confidence: Math.min(result.score * 10, 1.0),
      }));

    return {
      language: topResult.language,
      confidence,
      alternativeLanguages: alternatives,
    };
  }

  /**
   * AI-based language detection using Gemini
   */
  private async detectWithAI(text: string): Promise<LanguageDetectionResult> {
    const prompt = `You are a language detection expert. Analyze the following text and identify its language.

Instructions:
1. Identify the primary language of the text
2. Provide a confidence score from 0.0 to 1.0
3. List up to 3 alternative possible languages with their confidence scores
4. Use ISO 639-1 language codes (e.g., 'en' for English, 'th' for Thai, 'zh-cn' for Chinese Simplified)
5. Consider mixed language text and identify the dominant language

Supported languages: ${Object.values(SupportedLanguage).join(', ')}

Text to analyze:
${text}

Respond in this exact JSON format:
{
  "language": "language_code",
  "confidence": 0.95,
  "alternatives": [
    {"language": "language_code", "confidence": 0.80},
    {"language": "language_code", "confidence": 0.60}
  ]
}`;

    try {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${config.gemini.model}:generateContent?key=${config.gemini.apiKey}`,
        {
          contents: [
            {
              parts: [
                {
                  text: prompt,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1, // Low temperature for consistent detection
            maxOutputTokens: 500,
            topP: 0.9,
            topK: 32,
          },
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      );

      const content = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!content) {
        throw new Error('No content in AI response');
      }

      // Extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in AI response');
      }

      const result = JSON.parse(jsonMatch[0]);

      // Validate result
      if (!result.language || typeof result.confidence !== 'number') {
        throw new Error('Invalid AI response format');
      }

      // Ensure language is supported
      const supportedLanguages = Object.values(SupportedLanguage);
      if (!supportedLanguages.includes(result.language)) {
        logger.warn('AI detected unsupported language, falling back to English', {
          detectedLanguage: result.language,
          supportedLanguages,
        });
        result.language = SupportedLanguage.ENGLISH;
        result.confidence = 0.5;
      }

      return {
        language: result.language,
        confidence: Math.max(0, Math.min(1, result.confidence)),
        alternativeLanguages: (result.alternatives || [])
          .filter((alt: any) => supportedLanguages.includes(alt.language))
          .map((alt: any) => ({
            language: alt.language,
            confidence: Math.max(0, Math.min(1, alt.confidence)),
          })),
      };
    } catch (error) {
      logger.error('AI language detection failed', {
        error: error instanceof Error ? error.message : String(error),
        textLength: text.length,
      });

      // Fallback to pattern detection
      const patternResult = this.detectByPatterns(text);
      return {
        ...patternResult,
        confidence: Math.max(0.3, patternResult.confidence), // Minimum confidence
      };
    }
  }

  /**
   * Initialize language patterns for common languages
   */
  private initializeLanguagePatterns(): LanguagePattern[] {
    return [
      {
        language: SupportedLanguage.ENGLISH,
        patterns: [
          /\b(the|and|is|in|to|of|a|that|it|with|for|as|was|on|are|you)\b/g,
        ],
        characterSets: [
          /[a-zA-Z]/g,
        ],
        commonWords: ['the', 'and', 'is', 'in', 'to', 'of', 'a', 'that', 'it', 'with', 'for', 'you', 'have', 'this', 'be'],
      },
      {
        language: SupportedLanguage.THAI,
        patterns: [
          /\b(และ|ใน|ที่|เป็น|ของ|มี|นี้|จะ|ได้|แล้ว|ไป|มา|ดู|ทำ|รู้)\b/g,
        ],
        characterSets: [
          /[\u0E00-\u0E7F]/g, // Thai characters
        ],
        commonWords: ['และ', 'ใน', 'ที่', 'เป็น', 'ของ', 'มี', 'นี้', 'จะ', 'ได้', 'แล้ว', 'ไป', 'มา', 'ดู', 'ทำ', 'รู้'],
      },
      {
        language: SupportedLanguage.CHINESE_SIMPLIFIED,
        patterns: [
          /\b(的|是|在|和|有|我|你|他|了|不|会|说|来|去|看)\b/g,
        ],
        characterSets: [
          /[\u4e00-\u9fff]/g, // Chinese characters
        ],
        commonWords: ['的', '是', '在', '和', '有', '我', '你', '他', '了', '不', '会', '说', '来', '去', '看'],
      },
      {
        language: SupportedLanguage.SPANISH,
        patterns: [
          /\b(el|la|de|que|y|es|en|un|se|no|te|lo|le|da|su|por|son|con|para|al)\b/g,
        ],
        characterSets: [
          /[a-zA-ZñÑáéíóúÁÉÍÓÚüÜ]/g,
        ],
        commonWords: ['el', 'la', 'de', 'que', 'y', 'es', 'en', 'un', 'se', 'no', 'te', 'lo', 'le', 'da', 'su'],
      },
      {
        language: SupportedLanguage.FRENCH,
        patterns: [
          /\b(le|de|et|à|un|il|être|et|en|avoir|que|pour|dans|ce|son|une|sur|avec|ne|se|pas|tout|plus)\b/g,
        ],
        characterSets: [
          /[a-zA-ZàâäéèêëïîôöùûüÿçÀÂÄÉÈÊËÏÎÔÖÙÛÜŸÇ]/g,
        ],
        commonWords: ['le', 'de', 'et', 'à', 'un', 'il', 'être', 'et', 'en', 'avoir', 'que', 'pour', 'dans', 'ce', 'son'],
      },
      {
        language: SupportedLanguage.GERMAN,
        patterns: [
          /\b(der|die|und|in|den|von|zu|das|mit|sich|des|auf|für|ist|im|dem|nicht|ein|eine|als|auch|es|an|werden)\b/g,
        ],
        characterSets: [
          /[a-zA-ZäöüßÄÖÜ]/g,
        ],
        commonWords: ['der', 'die', 'und', 'in', 'den', 'von', 'zu', 'das', 'mit', 'sich', 'des', 'auf', 'für', 'ist'],
      },
      {
        language: SupportedLanguage.JAPANESE,
        patterns: [
          /\b(です|ます|した|ある|する|なる|いる|思う|言う|行く|来る|見る|聞く|話す)\b/g,
        ],
        characterSets: [
          /[\u3040-\u309f]/g, // Hiragana
          /[\u30a0-\u30ff]/g, // Katakana
          /[\u4e00-\u9faf]/g, // Kanji
        ],
        commonWords: ['です', 'ます', 'した', 'ある', 'する', 'なる', 'いる', '思う', '言う', '行く', '来る', '見る'],
      },
      {
        language: SupportedLanguage.KOREAN,
        patterns: [
          /\b(이|가|을|를|에|에서|으로|와|과|의|도|만|까지|부터|께서|에게|한테|로부터)\b/g,
        ],
        characterSets: [
          /[\uac00-\ud7af]/g, // Hangul
        ],
        commonWords: ['이', '가', '을', '를', '에', '에서', '으로', '와', '과', '의', '도', '만', '그', '저', '우리'],
      },
      {
        language: SupportedLanguage.VIETNAMESE,
        patterns: [
          /\b(và|của|trong|với|để|cho|từ|trên|về|theo|như|khi|vào|ra|đến|qua|tại|nên|được)\b/g,
        ],
        characterSets: [
          /[a-zA-ZàáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđĐ]/g,
        ],
        commonWords: ['và', 'của', 'trong', 'với', 'để', 'cho', 'từ', 'trên', 'về', 'theo', 'như', 'khi', 'vào'],
      },
      {
        language: SupportedLanguage.ARABIC,
        patterns: [
          /\b(في|من|إلى|على|عن|مع|هذا|هذه|التي|التي|ذلك|تلك|كان|كانت|يكون|تكون)\b/g,
        ],
        characterSets: [
          /[\u0600-\u06FF]/g, // Arabic characters
        ],
        commonWords: ['في', 'من', 'إلى', 'على', 'عن', 'مع', 'هذا', 'هذه', 'التي', 'ذلك', 'تلك', 'كان', 'كانت'],
      },
    ];
  }

  /**
   * Generate cache key for text
   */
  private generateCacheKey(text: string): string {
    // Use first 100 characters for caching to avoid memory issues
    const truncatedText = text.substring(0, 100);
    return `lang_detect:${Buffer.from(truncatedText).toString('base64')}`;
  }

  /**
   * Update cache with LRU eviction
   */
  private updateCache(key: string, result: LanguageDetectionResult): void {
    if (this.cache.size >= this.maxCacheSize) {
      // Remove oldest entry (LRU)
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, result);
  }

  /**
   * Clear detection cache
   */
  clearCache(): void {
    this.cache.clear();
    logger.info('Language detection cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxCacheSize,
      hitRatio: this.cache.size > 0 ? 'N/A' : 0, // Would need hit/miss tracking for actual ratio
    };
  }

  /**
   * Check if language is supported
   */
  isLanguageSupported(languageCode: string): boolean {
    return Object.values(SupportedLanguage).includes(languageCode as SupportedLanguage);
  }

  /**
   * Get list of supported languages
   */
  getSupportedLanguages(): string[] {
    return Object.values(SupportedLanguage);
  }
}