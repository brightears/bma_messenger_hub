# BMA Messenger Hub Test Suite

This directory contains comprehensive tests for the BMA Messenger Hub platform, covering webhook endpoints, message processing, routing, translation, and AI classification functionality.

## Test Files Overview

### 1. `webhooks.test.js` - HTTP Endpoint Tests
Tests the Express.js server endpoints for WhatsApp and LINE webhooks.

**Coverage includes:**
- Health check and root endpoints
- WhatsApp webhook verification (GET requests)
- WhatsApp message processing (POST requests)
- LINE message processing (POST requests)
- Error handling for malformed requests
- Concurrent request handling
- Service failure scenarios

**Key features:**
- Mocks all external services (Google Chat API, message routing, translation)
- Tests both success and failure scenarios
- Validates proper HTTP response codes
- Tests with various message types (text, image, video, audio, documents)

### 2. `message-routing.test.js` - Routing Logic Tests
Tests the message routing service that determines which department should receive messages.

**Coverage includes:**
- Keyword-based routing for technical, sales, and design departments
- AI classification fallback when keywords don't match
- Confidence threshold validation
- Edge cases (null/undefined inputs, very long messages)
- Utility functions (getDepartments, getKeywordsForDepartment, addKeyword)
- Space ID validation

**Key features:**
- Tests keyword priority (technical > sales > design order)
- Validates AI classifier integration
- Tests default fallback to sales department
- Covers case-insensitive keyword matching

### 3. `message-processor.test.js` - Message Parsing Tests
Tests the parsing of incoming webhook messages from different platforms.

**Coverage includes:**
- WhatsApp message parsing (text, image, video, audio, document types)
- LINE message parsing (individual, group, room messages)
- Message validation logic
- Error handling for malformed payloads
- Contact information extraction

**Key features:**
- Tests various message formats and edge cases
- Validates standardized message format output
- Tests graceful handling of missing or invalid data
- Covers both platforms comprehensively

### 4. `translation.test.js` - Translation Service Tests
Tests the Google Gemini-powered translation functionality.

**Coverage includes:**
- Language detection
- Text translation to English
- Caching mechanisms
- English language recognition
- Message formatting with translations
- Health check functionality

**Key features:**
- Mocks Google Generative AI completely
- Tests cache TTL and overflow handling
- Validates translation workflows
- Tests error scenarios and fallbacks

### 5. `ai-classifier.test.js` - AI Classification Tests
Tests the Gemini AI message classification service.

**Coverage includes:**
- Message classification into technical/sales/design departments
- Confidence score validation
- Model configuration
- Health check functionality
- Error handling and rate limiting

**Key features:**
- Tests exact and partial department matches
- Validates confidence thresholds
- Tests various input scenarios (unicode, special characters)
- Mocks complete AI service interaction

## Running Tests

### Run All Tests
```bash
npm test
```

### Run Specific Test Files
```bash
npm test -- test/webhooks.test.js
npm test -- test/message-routing.test.js
npm test -- test/message-processor.test.js
npm test -- test/translation.test.js
npm test -- test/ai-classifier.test.js
```

### Run with Coverage
```bash
npm test -- --coverage
```

## Test Architecture

### Mocking Strategy
- **External APIs**: All Google services (Gemini AI, Google Chat) are completely mocked
- **Service Dependencies**: Each test file mocks its dependencies to ensure isolation
- **Database**: No real database connections (controlled by `USE_DATABASE` flag)
- **Network Calls**: All HTTP requests are intercepted and mocked

### Test Data
Each test file includes comprehensive mock data:
- Realistic webhook payloads from WhatsApp and LINE
- Various message types and formats
- Edge cases and error scenarios
- Multi-language content examples

### Assertions
- Uses Jest matchers for precise validation
- Tests both success and failure paths
- Validates exact function calls and parameters
- Checks proper error handling and fallbacks

## Key Testing Principles

1. **Isolation**: Each test is independent and can run in any order
2. **Comprehensive Coverage**: Tests cover happy paths, edge cases, and error scenarios
3. **Realistic Scenarios**: Uses actual webhook payload formats from real services
4. **Mocking**: All external dependencies are mocked for reliable, fast tests
5. **Documentation**: Tests serve as living documentation of expected behavior

## Mock Data Examples

The tests include realistic examples of:
- WhatsApp webhook messages (text, media, documents)
- LINE webhook messages (user, group, room chats)
- Google Chat API responses
- Gemini AI classification results
- Translation service responses

This comprehensive test suite ensures the BMA Messenger Hub platform works correctly across all integration points and handles edge cases gracefully.