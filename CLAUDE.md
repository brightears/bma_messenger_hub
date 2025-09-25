# Claude Code Development Guide

## Project: BMA Messenger Hub

This document provides Claude Code-specific instructions and best practices for developing the BMA Messenger Hub platform.

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
- Model: `gemini-2.5-flash`
- Used for: Message classification, translation
- Temperature: 0.7 (configurable)

### Google Spaces
- Technical: `spaces/AAQA6WeunF8`
- Design: `spaces/AAQALSfR5k4`
- Sales: `spaces/AAQAfKFrdxQ`

### Service Account
- Already configured in `GOOGLE_CREDENTIALS_JSON`
- Has access to all necessary Google Chat spaces

## Implementation Priority

1. **Core Infrastructure First**: Webhooks, basic routing
2. **Then AI Features**: Classification, translation
3. **Finally Polish**: Error handling, monitoring

## Message Routing Logic

### Keyword-Based Routing (Primary)

Keywords should be checked first for efficiency:
- **Technical**: "support", "help", "issue", "problem", "technical", "error", "bug"
- **Sales**: "quote", "quotation", "price", "cost", "purchase", "buy", "order"
- **Design**: "design", "music", "soundtrack", "playlist", "branding"

### AI Routing (Fallback)

Only use Gemini when keywords don't match. Keep prompts concise and focused.

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

## Database Usage

- Optional (controlled by `USE_DATABASE` flag)
- Use for conversation history if enabled
- PostgreSQL on Render
- Keep schema minimal

## Redis Queue

- Use Bull for job processing
- Implement retry logic
- Set reasonable TTLs
- Monitor queue health

## Common Issues

1. **Webhook not receiving**: Check ngrok/Render URL configuration
2. **Translation failing**: Verify Gemini API quota
3. **Messages not routing**: Check space IDs and permissions
4. **Auth errors**: Verify service account has correct permissions

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