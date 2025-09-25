// Message routing service for BMA Messenger Hub
// Routes messages to appropriate Google Chat spaces based on keywords

// Google Chat space IDs
const SPACE_IDS = {
  technical: 'spaces/AAQA6WeunF8',
  design: 'spaces/AAQALSfR5k4',
  sales: 'spaces/AAQAfKFrdxQ'
};

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
 * Routes a message to the appropriate Google Chat space based on keywords
 * @param {string} messageText - The message text to analyze
 * @returns {Object} - Object containing spaceId and department
 */
function routeMessage(messageText) {
  if (!messageText || typeof messageText !== 'string') {
    console.log('Invalid message text, defaulting to sales');
    return {
      spaceId: SPACE_IDS.sales,
      department: 'sales'
    };
  }

  // Convert to lowercase for case-insensitive matching
  const lowerMessage = messageText.toLowerCase();

  console.log('Routing message:', lowerMessage.substring(0, 100) + '...');

  // Check each department's keywords
  for (const [department, keywords] of Object.entries(KEYWORDS)) {
    for (const keyword of keywords) {
      // Use partial matching - check if keyword is contained in the message
      if (lowerMessage.includes(keyword.toLowerCase())) {
        console.log(`Message routed to ${department} based on keyword: "${keyword}"`);
        return {
          spaceId: SPACE_IDS[department],
          department: department
        };
      }
    }
  }

  // Default to sales if no keywords match
  console.log('No keywords matched, defaulting to sales');
  return {
    spaceId: SPACE_IDS.sales,
    department: 'sales'
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
  KEYWORDS
};