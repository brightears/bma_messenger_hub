// Message routing service for BMA Messenger Hub
// Routes messages to appropriate Google Chat spaces based on keywords and AI classification

const aiClassifier = require('./ai-classifier');

// Google Chat space IDs from environment variables
const SPACE_IDS = {
  technical: process.env.GCHAT_TECHNICAL_SPACE || 'spaces/AAQA6WeunF8',
  design: process.env.GCHAT_DESIGN_SPACE || 'spaces/AAQALSfR5k4',
  sales: process.env.GCHAT_SALES_SPACE || 'spaces/AAQAfKFrdxQ'
};

console.log('Message Router initialized with spaces:', {
  technical: SPACE_IDS.technical,
  design: SPACE_IDS.design,
  sales: SPACE_IDS.sales
});

// Department keywords for routing
const KEYWORDS = {
  technical: [
    'support', 'help', 'issue', 'problem', 'technical', 'error', 'bug',
    'not working', 'broken', 'fix', 'troubleshoot', 'crash', 'debug',
    'maintenance', 'update', 'installation', 'setup', 'configure'
  ],
  sales: [
    'quote', 'quotation', 'price', 'cost', 'purchase', 'buy', 'order',
    'pricing', 'payment', 'invoice', 'billing', 'sale', 'discount',
    'contract', 'deal', 'offer', 'budget', 'estimate'
  ],
  design: [
    'design', 'music', 'soundtrack', 'playlist', 'branding', 'logo',
    'visual', 'audio', 'creative', 'artwork', 'graphics', 'brand',
    'style', 'theme', 'composition', 'mixing', 'mastering'
  ]
};

/**
 * Routes a message to the appropriate Google Chat space based on keywords and AI classification
 * @param {string} messageText - The message text to analyze
 * @returns {Promise<Object>} - Object containing spaceId, department, and routing info
 */
async function routeMessage(messageText) {
  if (!messageText || typeof messageText !== 'string') {
    console.log('Invalid message text, defaulting to sales');
    return {
      spaceId: SPACE_IDS.sales,
      department: 'sales',
      source: 'default',
      confidence: 0
    };
  }

  // Convert to lowercase for case-insensitive matching
  const lowerMessage = messageText.toLowerCase();

  console.log('Routing message:', lowerMessage.substring(0, 100) + '...');

  // Use scoring system - count matches for each department
  const scores = {
    technical: 0,
    sales: 0,
    design: 0
  };

  const matchedKeywords = {
    technical: [],
    sales: [],
    design: []
  };

  // Count keyword matches for each department
  for (const [department, keywords] of Object.entries(KEYWORDS)) {
    for (const keyword of keywords) {
      if (lowerMessage.includes(keyword.toLowerCase())) {
        scores[department]++;
        matchedKeywords[department].push(keyword);
      }
    }
  }

  // Find department with highest score
  let maxScore = 0;
  let selectedDepartment = null;

  for (const [department, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      selectedDepartment = department;
    }
  }

  // If we have keyword matches, use the department with most matches
  if (selectedDepartment && maxScore > 0) {
    console.log(`Message routed to ${selectedDepartment} based on ${maxScore} keyword match(es): ${matchedKeywords[selectedDepartment].join(', ')}`);

    // Log other departments if they also had matches for debugging
    for (const [dept, keywords] of Object.entries(matchedKeywords)) {
      if (dept !== selectedDepartment && keywords.length > 0) {
        console.log(`  Also matched ${dept} (${keywords.length}): ${keywords.join(', ')}`);
      }
    }

    return {
      spaceId: SPACE_IDS[selectedDepartment],
      department: selectedDepartment,
      source: 'keyword',
      matchedKeywords: matchedKeywords[selectedDepartment],
      score: maxScore,
      confidence: 1.0
    };
  }

  // No keywords matched, try AI classification as fallback
  console.log('No keywords matched, trying AI classification...');

  try {
    const aiResult = await aiClassifier.classifyMessage(messageText);

    // Check if AI classification should be trusted
    if (aiResult.source === 'gemini' && aiClassifier.shouldTrustClassification(aiResult.confidence)) {
      console.log(`Message routed to ${aiResult.department} via AI classification (confidence: ${aiResult.confidence})`);
      return {
        spaceId: SPACE_IDS[aiResult.department],
        department: aiResult.department,
        source: 'ai',
        confidence: aiResult.confidence,
        aiResponse: aiResult.rawResponse
      };
    } else {
      console.log(`AI classification confidence too low (${aiResult.confidence}) or failed, defaulting to sales`);
    }
  } catch (error) {
    console.error('Error during AI classification:', error.message);
  }

  // Default to sales if both keyword matching and AI classification fail
  console.log('Both keyword matching and AI classification failed, defaulting to sales');
  return {
    spaceId: SPACE_IDS.sales,
    department: 'sales',
    source: 'default',
    confidence: 0
  };
}

/**
 * Gets all available departments and their space IDs
 * @returns {Object} - Object mapping departments to space IDs
 */
function getDepartments() {
  return { ...SPACE_IDS };
}

/**
 * Gets keywords for a specific department
 * @param {string} department - The department name
 * @returns {Array} - Array of keywords for the department
 */
function getKeywordsForDepartment(department) {
  return KEYWORDS[department] || [];
}

/**
 * Adds a keyword to a department (for dynamic updates)
 * @param {string} department - The department name
 * @param {string} keyword - The keyword to add
 * @returns {boolean} - True if added successfully
 */
function addKeyword(department, keyword) {
  if (!KEYWORDS[department]) {
    console.error(`Department "${department}" not found`);
    return false;
  }

  const lowerKeyword = keyword.toLowerCase();
  if (!KEYWORDS[department].includes(lowerKeyword)) {
    KEYWORDS[department].push(lowerKeyword);
    console.log(`Added keyword "${lowerKeyword}" to ${department} department`);
    return true;
  }

  console.log(`Keyword "${lowerKeyword}" already exists in ${department} department`);
  return false;
}

/**
 * Validates if a space ID format is correct
 * @param {string} spaceId - The space ID to validate
 * @returns {boolean} - True if valid format
 */
function isValidSpaceId(spaceId) {
  return spaceId && typeof spaceId === 'string' && spaceId.startsWith('spaces/');
}

module.exports = {
  routeMessage,
  getDepartments,
  getKeywordsForDepartment,
  addKeyword,
  isValidSpaceId,
  SPACE_IDS,
  KEYWORDS,
  // Expose AI classifier functions
  classifyMessage: aiClassifier.classifyMessage,
  getAIModelInfo: aiClassifier.getModelInfo,
  aiHealthCheck: aiClassifier.healthCheck
};