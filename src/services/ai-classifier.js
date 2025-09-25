// AI Classification service for BMA Messenger Hub
// Uses Google Gemini 2.5 Flash for message classification when keyword matching fails

const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Model configuration
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const TEMPERATURE = parseFloat(process.env.GEMINI_TEMPERATURE) || 0.7;
const MAX_TOKENS = parseInt(process.env.GEMINI_MAX_TOKENS) || 8192;

// Valid departments
const VALID_DEPARTMENTS = ['technical', 'sales', 'design'];

/**
 * Classifies a message using Google Gemini AI
 * @param {string} messageText - The message text to classify
 * @returns {Promise<Object>} - Object containing department and confidence
 */
async function classifyMessage(messageText) {
  if (!messageText || typeof messageText !== 'string') {
    console.warn('AI Classifier: Invalid message text provided');
    return {
      department: 'sales',
      confidence: 0,
      source: 'default'
    };
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error('AI Classifier: GEMINI_API_KEY not configured');
    return {
      department: 'sales',
      confidence: 0,
      source: 'error'
    };
  }

  try {
    console.log('AI Classifier: Classifying message with Gemini 2.5 Flash...');

    // Get the model
    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      generationConfig: {
        temperature: TEMPERATURE,
        maxOutputTokens: 100, // We only need a short response
        topK: 1,
        topP: 0.8,
      },
    });

    // Create a concise, focused prompt
    const prompt = `You are a customer service routing system. Classify this customer message into exactly one department.

Message: "${messageText.trim()}"

Departments:
- technical: for support, help, issues, problems, bugs, troubleshooting, errors, fixes
- sales: for quotes, pricing, purchases, orders, billing, contracts, buying, costs
- design: for music, soundtracks, branding, logos, creative work, visual content

Respond with ONLY ONE WORD: either "technical", "sales", or "design"`;

    console.log('AI Classifier: Sending request to Gemini API...');

    const result = await model.generateContent(prompt);
    const response = await result.response;

    if (!response) {
      throw new Error('No response received from Gemini API');
    }

    const text = response.text();

    if (!text) {
      throw new Error('Empty response from Gemini API');
    }

    const cleanText = text.toLowerCase().trim();
    console.log('AI Classifier: Received response:', cleanText);

    // Parse the response - look for exact department matches
    let department = 'sales'; // Default fallback
    let confidence = 0.3; // Default confidence

    // Check if response exactly matches or contains a valid department
    if (cleanText === 'technical' || cleanText.includes('technical')) {
      department = 'technical';
      confidence = cleanText === 'technical' ? 0.9 : 0.7;
    } else if (cleanText === 'sales' || cleanText.includes('sales')) {
      department = 'sales';
      confidence = cleanText === 'sales' ? 0.9 : 0.7;
    } else if (cleanText === 'design' || cleanText.includes('design')) {
      department = 'design';
      confidence = cleanText === 'design' ? 0.9 : 0.7;
    } else {
      console.warn('AI Classifier: No valid department found in response, using sales default');
      confidence = 0.2; // Very low confidence for unrecognized response
    }

    console.log(`AI Classifier: Classified as "${department}" with confidence ${confidence}`);

    return {
      department,
      confidence,
      source: 'gemini',
      rawResponse: cleanText
    };

  } catch (error) {
    console.error('AI Classifier: Error during classification:', error.message);

    // Return safe fallback
    return {
      department: 'sales',
      confidence: 0,
      source: 'error',
      error: error.message
    };
  }
}

/**
 * Validates if AI classification should be trusted based on confidence
 * @param {number} confidence - The confidence score from AI classification
 * @returns {boolean} - True if confidence is high enough
 */
function shouldTrustClassification(confidence) {
  const MIN_CONFIDENCE = 0.6;
  return confidence >= MIN_CONFIDENCE;
}

/**
 * Gets information about the AI model configuration
 * @returns {Object} - Model configuration details
 */
function getModelInfo() {
  return {
    model: MODEL_NAME,
    temperature: TEMPERATURE,
    maxTokens: MAX_TOKENS,
    validDepartments: [...VALID_DEPARTMENTS]
  };
}

/**
 * Health check for AI classifier service
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

    // Test with a simple message
    const testResult = await classifyMessage('test message');

    return {
      status: 'healthy',
      message: 'AI classifier is working',
      model: MODEL_NAME,
      testClassification: testResult.department
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
  classifyMessage,
  shouldTrustClassification,
  getModelInfo,
  healthCheck,
  VALID_DEPARTMENTS
};