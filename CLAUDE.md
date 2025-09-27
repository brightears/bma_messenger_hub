# Claude Code Development Guide

## Project: BMAsia Messenger Hub

This document provides Claude Code-specific instructions and best practices for developing the BMAsia Messenger Hub platform.

## Current Status (v1.2-stable-line-ai-fix)

### Working Features
- ✅ Single-space routing (BMA Chat Support)
- ✅ AI information gathering (customer name & company) - WhatsApp & LINE
- ✅ 24-hour message history storage
- ✅ Customer info persistence (24 hours)
- ✅ Language auto-detection (Thai/English)
- ✅ Reply portal with conversation tracking
- ✅ WhatsApp & LINE webhook integration
- ✅ Platform parity - Both WhatsApp and LINE have identical AI gathering

## Sub-Agents Usage

**IMPORTANT**: Always use sub-agents when working on specialized tasks. The following sub-agents are available:

### Available Sub-Agents

1. **api-integrator**: Use for WhatsApp, LINE, and Google Chat API implementations
2. **message-router**: Use for routing logic and AI classification
3. **translator**: Use for translation service implementation
4. **devops-deployer**: Use for Render deployment and CI/CD setup
5. **test-orchestrator**: Use for creating and running tests

### When to Use Sub-Agents

- **API Integration**: Delegate webhook setup, API authentication, and message handling to `api-integrator`
- **Routing Logic**: Use `message-router` for keyword detection and AI classification
- **Translation**: Delegate all translation features to `translator`
- **Deployment**: Use `devops-deployer` for Render configuration and GitHub Actions
- **Testing**: Use `test-orchestrator` for comprehensive test creation

## Development Commands

### Essential Commands to Run

```bash
# Type checking (run after any TypeScript changes)
npm run typecheck

# Linting (run before committing)
npm run lint

# Testing (run after implementing features)
npm test

# Development server
npm run dev
```

## Environment Management

- Never commit `.env` file
- Use Render's environment variable management in production
- Access credentials are already configured in `.env`

## API Keys and Services

### Google Gemini 2.5 Flash
- Model: `gemini-2.5-flash` (configured via GEMINI_MODEL env var)
- Used for: AI information gathering, translation, message classification
- Temperature: 0.7 (configurable)
- Also powers the AI gatherer service for customer info collection

### Google Spaces
- BMA Chat Support (Single Space): `spaces/AAQAfKFrdxQ`
- (Legacy - not in use):
  - Technical: `spaces/AAQA6WeunF8`
  - Design: `spaces/AAQALSfR5k4`

### Service Account
- Already configured in `GOOGLE_CREDENTIALS_JSON`
- Has access to all necessary Google Chat spaces

## Implementation Priority

1. **Core Infrastructure First**: Webhooks, basic routing
2. **Then AI Features**: Classification, translation
3. **Finally Polish**: Error handling, monitoring

## Message Routing Logic

### Current Implementation
- All messages route to single BMA Chat Support space
- No keyword-based routing (simplified approach)
- AI is used for information gathering, not routing

### AI Information Gathering
- Triggers on first customer contact
- Asks for name and company in customer's language
- Stores info for 24 hours
- Uses fallback messages if AI unavailable
- Bypasses gathering for urgent messages

## Translation Strategy

- Always detect language first
- Preserve original message alongside translation
- Cache common translations for efficiency
- Format: `[Original Message]\n---\n[English Translation]`

## Error Handling

- All API calls must have retry logic
- Log all errors with context
- Never expose internal errors to customers
- Provide graceful fallbacks

## Deployment Checklist

Before deploying to Render:
1. Run `npm run typecheck`
2. Run `npm run lint`
3. Run `npm test`
4. Verify environment variables
5. Check webhook URLs are correct
6. Test with sample messages

## GitHub Workflow

- Main branch auto-deploys to Render
- Use feature branches for development
- Squash commits when merging
- Include clear commit messages

## Monitoring

- Health check endpoint: `/health`
- Metrics endpoint: `/metrics`
- Log levels: error, warn, info, debug
- Use Winston for structured logging

## Security

- Validate all webhook signatures
- Sanitize user inputs
- Use environment variables for secrets
- Implement rate limiting
- No sensitive data in logs

## Data Storage

### Current Implementation (Memory-based)
- All data stored in memory
- 24-hour TTL for messages and customer info
- Automatic cleanup every hour
- No database required

### Future Enhancement (Optional)
- PostgreSQL on Render for persistent storage
- Controlled by `USE_DATABASE` flag
- Would enable long-term conversation history

## Redis Queue

- Use Bull for job processing
- Implement retry logic
- Set reasonable TTLs
- Monitor queue health

## Common Issues

1. **Webhook not receiving**: Check ngrok/Render URL configuration
2. **AI gathering failing**: Check Gemini API key and model name (gemini-2.5-flash)
3. **Messages not forwarding**: Verify Google Chat service account permissions
4. **Customer info lost**: Normal - data expires after 24 hours
5. **Render cold starts**: Upgrade to paid tier to eliminate sleep/wake delays
6. **LINE AI not triggering**: Fixed in v1.2 - ensure sendInfoRequest is implemented in line-sender.js

## Testing Strategy

- Mock all external APIs
- Test each integration separately
- Test routing logic thoroughly
- Verify translation accuracy
- Test error scenarios

## Performance Considerations

- Cache translations
- Batch API calls when possible
- Use connection pooling
- Implement circuit breakers
- Monitor response times

## Remember

- Keep messages natural and conversational
- Don't over-engineer simple features
- Focus on reliability over complexity
- Test with real-world scenarios
- Document any deviations from plan