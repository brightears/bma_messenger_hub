import axios from 'axios';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { Department, RoutingResult } from './keyword-router';

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text: string;
      }>;
    };
  }>;
}

interface ClassificationResult {
  department: Department;
  confidence: number;
  reasoning: string;
  needsClarification: boolean;
  clarificationMessage?: string;
}

export class AIRouter {
  private readonly apiKey: string;
  private readonly apiUrl: string;
  private readonly model: string;

  constructor() {
    this.apiKey = config.gemini.apiKey;
    this.model = config.gemini.model;
    this.apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;
  }

  /**
   * Use Gemini AI to classify message intent
   */
  public async classifyMessage(
    message: string,
    context?: string
  ): Promise<ClassificationResult> {
    try {
      const prompt = this.buildClassificationPrompt(message, context);
      const response = await this.callGeminiAPI(prompt);
      return this.parseClassificationResponse(response);
    } catch (error) {
      logger.error('AI classification failed', { error, message });
      return {
        department: Department.UNKNOWN,
        confidence: 0,
        reasoning: 'AI classification failed',
        needsClarification: true,
        clarificationMessage: "I'm having trouble understanding your request. Could you please tell me if you need technical support, sales information, or design services?"
      };
    }
  }

  /**
   * Generate natural clarification response
   */
  public async generateClarification(
    message: string,
    previousAttempts: number = 0
  ): Promise<string> {
    try {
      const prompt = this.buildClarificationPrompt(message, previousAttempts);
      const response = await this.callGeminiAPI(prompt);
      return this.extractText(response).trim() || this.getFallbackClarification();
    } catch (error) {
      logger.error('Failed to generate clarification', { error });
      return this.getFallbackClarification();
    }
  }

  /**
   * Build classification prompt for Gemini
   */
  private buildClassificationPrompt(message: string, context?: string): string {
    const contextPart = context ? `\nPrevious context: ${context}` : '';

    return `You are a message classifier for a business communication system. Classify the following message into one of these departments:
- TECHNICAL: Technical support, issues, problems, errors, bugs, troubleshooting
- SALES: Quotes, pricing, purchases, orders, payment inquiries
- DESIGN: Music, soundtracks, playlists, branding, audio design

Message to classify: "${message}"${contextPart}

Respond in JSON format:
{
  "department": "TECHNICAL" | "SALES" | "DESIGN" | "UNKNOWN",
  "confidence": 0.0 to 1.0,
  "reasoning": "brief explanation",
  "needsClarification": true | false,
  "clarificationMessage": "optional natural clarification question if needed"
}

Rules:
- If the message is a greeting or very unclear, set department to UNKNOWN and needsClarification to true
- Be conservative with confidence scores
- Keep clarificationMessage natural and conversational
- Hotels/restaurants usually want sales (quotes)`;
  }

  /**
   * Build clarification prompt for natural conversation
   */
  private buildClarificationPrompt(message: string, previousAttempts: number): string {
    const attemptContext = previousAttempts > 0
      ? `This is attempt ${previousAttempts + 1} to understand the customer.`
      : '';

    return `You are a friendly business assistant. A customer sent this message: "${message}"

${attemptContext}

Their intent is unclear. Generate a natural, conversational response to understand what they need.
- Be friendly and professional
- Don't identify yourself as AI or bot
- Offer the three service options naturally: technical support, sales/quotes, or music design
- Keep it brief (1-2 sentences)
- If they mention a company name (like Hilton), acknowledge it

Example responses:
"Hello! I'd be happy to help. Are you looking for a quotation, technical assistance, or help with music design?"
"Thanks for reaching out! Could you let me know if you need support with an existing system, pricing information, or design services?"

Generate response:`;
  }

  /**
   * Call Gemini API
   */
  private async callGeminiAPI(prompt: string): Promise<GeminiResponse> {
    const payload = {
      contents: [{
        parts: [{
          text: prompt
        }]
      }],
      generationConfig: {
        temperature: config.gemini.temperature,
        maxOutputTokens: 500,
        topK: 40,
        topP: 0.95
      }
    };

    const response = await axios.post(
      `${this.apiUrl}?key=${this.apiKey}`,
      payload,
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    return response.data;
  }

  /**
   * Parse Gemini classification response
   */
  private parseClassificationResponse(response: GeminiResponse): ClassificationResult {
    try {
      const text = this.extractText(response);

      // Try to parse as JSON
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          department: this.normalizeDepartment(parsed.department),
          confidence: Math.max(0, Math.min(1, parseFloat(parsed.confidence) || 0)),
          reasoning: parsed.reasoning || '',
          needsClarification: Boolean(parsed.needsClarification),
          clarificationMessage: parsed.clarificationMessage
        };
      }

      // Fallback parsing if not proper JSON
      return this.parseTextResponse(text);
    } catch (error) {
      logger.error('Failed to parse AI response', { error, response });
      return {
        department: Department.UNKNOWN,
        confidence: 0,
        reasoning: 'Failed to parse AI response',
        needsClarification: true
      };
    }
  }

  /**
   * Extract text from Gemini response
   */
  private extractText(response: GeminiResponse): string {
    try {
      return response.candidates[0].content.parts[0].text;
    } catch (error) {
      logger.error('Failed to extract text from Gemini response', { error });
      return '';
    }
  }

  /**
   * Parse text-based response as fallback
   */
  private parseTextResponse(text: string): ClassificationResult {
    const textLower = text.toLowerCase();

    let department = Department.UNKNOWN;
    if (textLower.includes('technical')) {
      department = Department.TECHNICAL;
    } else if (textLower.includes('sales')) {
      department = Department.SALES;
    } else if (textLower.includes('design')) {
      department = Department.DESIGN;
    }

    return {
      department,
      confidence: department !== Department.UNKNOWN ? 0.5 : 0,
      reasoning: 'Parsed from text response',
      needsClarification: department === Department.UNKNOWN
    };
  }

  /**
   * Normalize department string to enum
   */
  private normalizeDepartment(dept: string): Department {
    const normalized = (dept || '').toUpperCase();
    if (normalized in Department) {
      return Department[normalized as keyof typeof Department];
    }
    return Department.UNKNOWN;
  }

  /**
   * Get fallback clarification message
   */
  private getFallbackClarification(): string {
    return "Hello! I'd be happy to help. Are you looking for technical support, a price quote, or help with music and design?";
  }
}