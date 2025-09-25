import { logger } from '../../utils/logger';

export enum Department {
  TECHNICAL = 'technical',
  SALES = 'sales',
  DESIGN = 'design',
  UNKNOWN = 'unknown'
}

export interface RoutingResult {
  department: Department;
  confidence: number;
  keywords: string[];
  reason?: string;
}

interface KeywordMapping {
  [key: string]: Department;
}

const KEYWORD_MAPPINGS: KeywordMapping = {
  // Technical keywords
  'support': Department.TECHNICAL,
  'help': Department.TECHNICAL,
  'issue': Department.TECHNICAL,
  'problem': Department.TECHNICAL,
  'technical': Department.TECHNICAL,
  'error': Department.TECHNICAL,
  'bug': Department.TECHNICAL,
  'not working': Department.TECHNICAL,
  'broken': Department.TECHNICAL,
  'fix': Department.TECHNICAL,
  'troubleshoot': Department.TECHNICAL,
  'crash': Department.TECHNICAL,
  'fail': Department.TECHNICAL,
  'cant': Department.TECHNICAL,
  "can't": Department.TECHNICAL,
  'cannot': Department.TECHNICAL,
  'doesnt work': Department.TECHNICAL,
  "doesn't work": Department.TECHNICAL,

  // Sales keywords
  'quote': Department.SALES,
  'quotation': Department.SALES,
  'price': Department.SALES,
  'cost': Department.SALES,
  'purchase': Department.SALES,
  'buy': Department.SALES,
  'order': Department.SALES,
  'pricing': Department.SALES,
  'discount': Department.SALES,
  'payment': Department.SALES,
  'invoice': Department.SALES,
  'subscription': Department.SALES,
  'plan': Department.SALES,
  'package': Department.SALES,
  'deal': Department.SALES,
  'offer': Department.SALES,
  'proposal': Department.SALES,

  // Design keywords
  'design': Department.DESIGN,
  'music': Department.DESIGN,
  'soundtrack': Department.DESIGN,
  'playlist': Department.DESIGN,
  'branding': Department.DESIGN,
  'audio': Department.DESIGN,
  'sound': Department.DESIGN,
  'atmosphere': Department.DESIGN,
  'mood': Department.DESIGN,
  'vibe': Department.DESIGN,
  'tempo': Department.DESIGN,
  'genre': Department.DESIGN,
  'track': Department.DESIGN,
  'song': Department.DESIGN,
  'artist': Department.DESIGN,
  'custom': Department.DESIGN,
  'brand identity': Department.DESIGN
};

// Hotel/hospitality specific patterns that might indicate sales
const HOTEL_PATTERNS = [
  /hilton/i,
  /marriott/i,
  /hotel/i,
  /resort/i,
  /restaurant/i,
  /cafe/i,
  /bar/i,
  /lobby/i,
  /guest/i,
  /hospitality/i
];

export class KeywordRouter {
  /**
   * Analyze message content for department-specific keywords
   */
  public analyzeKeywords(message: string): RoutingResult {
    const normalizedMessage = message.toLowerCase().trim();
    const detectedKeywords: string[] = [];
    const departmentScores: Map<Department, number> = new Map([
      [Department.TECHNICAL, 0],
      [Department.SALES, 0],
      [Department.DESIGN, 0]
    ]);

    // Check for exact keyword matches
    for (const [keyword, department] of Object.entries(KEYWORD_MAPPINGS)) {
      if (normalizedMessage.includes(keyword.toLowerCase())) {
        detectedKeywords.push(keyword);
        const currentScore = departmentScores.get(department) || 0;
        departmentScores.set(department, currentScore + 1);
      }
    }

    // Check for hotel/hospitality patterns (often sales-related)
    let hasHotelPattern = false;
    for (const pattern of HOTEL_PATTERNS) {
      if (pattern.test(normalizedMessage)) {
        hasHotelPattern = true;
        break;
      }
    }

    // If hotel pattern detected and no strong other department signal, lean towards sales
    if (hasHotelPattern && detectedKeywords.length === 0) {
      departmentScores.set(Department.SALES, departmentScores.get(Department.SALES)! + 0.5);
    }

    // Determine department with highest score
    let topDepartment = Department.UNKNOWN;
    let maxScore = 0;
    let totalScore = 0;

    for (const [dept, score] of departmentScores.entries()) {
      totalScore += score;
      if (score > maxScore) {
        maxScore = score;
        topDepartment = dept;
      }
    }

    // Calculate confidence based on keyword matches and message length
    const messageWords = normalizedMessage.split(/\s+/).length;
    let confidence = 0;

    if (maxScore > 0) {
      // Base confidence on how many keywords matched
      confidence = Math.min(maxScore * 0.3, 0.9); // Cap at 90% for keyword-only matching

      // Boost confidence if multiple keywords from same department
      if (maxScore >= 2) {
        confidence = Math.min(confidence + 0.2, 0.95);
      }

      // Reduce confidence if keywords from multiple departments detected
      const departmentsWithKeywords = Array.from(departmentScores.values()).filter(s => s > 0).length;
      if (departmentsWithKeywords > 1) {
        confidence *= 0.7; // Reduce confidence by 30% for mixed signals
      }

      // Boost confidence for short, clear messages
      if (messageWords <= 10 && maxScore > 0) {
        confidence = Math.min(confidence + 0.1, 0.95);
      }
    }

    // Log routing decision
    logger.debug('Keyword routing analysis', {
      message: normalizedMessage.substring(0, 100),
      department: topDepartment,
      confidence,
      keywords: detectedKeywords,
      scores: Object.fromEntries(departmentScores)
    });

    return {
      department: topDepartment,
      confidence,
      keywords: detectedKeywords,
      reason: this.generateReason(topDepartment, detectedKeywords, confidence)
    };
  }

  /**
   * Check if message is a greeting or general inquiry
   */
  public isGreeting(message: string): boolean {
    const greetings = [
      'hello', 'hi', 'hey', 'good morning', 'good afternoon',
      'good evening', 'greetings', 'howdy', 'hola', 'bonjour',
      'sawadee', 'สวัสดี', '你好', 'こんにちは'
    ];

    const normalized = message.toLowerCase().trim();
    return greetings.some(greeting =>
      normalized.startsWith(greeting) || normalized === greeting
    );
  }

  /**
   * Generate human-readable reason for routing decision
   */
  private generateReason(
    department: Department,
    keywords: string[],
    confidence: number
  ): string {
    if (department === Department.UNKNOWN) {
      return 'No clear department indicators found';
    }

    if (confidence >= 0.8) {
      return `Strong match for ${department} department based on keywords: ${keywords.join(', ')}`;
    } else if (confidence >= 0.5) {
      return `Moderate match for ${department} department based on keywords: ${keywords.join(', ')}`;
    } else {
      return `Weak match for ${department} department, may need clarification`;
    }
  }

  /**
   * Get suggested clarification based on detected patterns
   */
  public getSuggestedClarification(message: string): string | null {
    const result = this.analyzeKeywords(message);

    if (result.confidence >= 0.7) {
      return null; // Clear enough, no clarification needed
    }

    if (this.isGreeting(message)) {
      return "Hello! How can I help you today? Are you looking for technical support, a price quote, or help with music and design?";
    }

    if (result.department === Department.UNKNOWN) {
      return "I'd be happy to help! Could you tell me if you need:\n• Technical support\n• A price quote or sales information\n• Music and design services";
    }

    // Ambiguous case
    return `I see you might need help with ${result.department} services. Could you provide more details about what you're looking for?`;
  }
}