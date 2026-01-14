# Claude Code Development Guide

## Project: BMAsia Messenger Hub

This document provides Claude Code-specific instructions and best practices for developing the BMAsia Messenger Hub platform.

## Current Status (v1.3-whatsapp-reply-working)

### Working Features
- ✅ Single-space routing (BMA Chat Support)
- ✅ AI information gathering (customer name & company) - **LINE only** (WhatsApp handled by ElevenLabs)
- ✅ 24-hour message history storage
- ✅ Customer info persistence (PostgreSQL - permanent)
- ✅ Language auto-detection (Thai/English)
- ✅ Reply portal with conversation tracking
- ✅ WhatsApp & LINE webhook integration
- ✅ ElevenLabs Conversational AI integration for WhatsApp
- ✅ **WhatsApp reply from Google Chat portal** (FROZEN - DO NOT MODIFY)
- ✅ **Customer profile lookup - agent recognizes returning customers** (FROZEN - DO NOT MODIFY)

---

## 🔒 FROZEN: WhatsApp Reply Flow (DO NOT MODIFY)

**Status: WORKING AS OF 2026-01-14**

This section documents the working WhatsApp reply flow. **DO NOT MODIFY** any of these components without explicit user approval.

### How It Works

1. **Customer → WhatsApp → ElevenLabs Agent**
   - Customer sends WhatsApp message
   - ElevenLabs Conversational AI handles the conversation
   - ElevenLabs stores conversation with WhatsApp metadata

2. **Agent Escalation → Google Chat**
   - When AI needs to escalate, it calls `escalate_to_team` webhook
   - Our webhook (`/webhooks/elevenlabs/escalate`) receives the escalation
   - **CRITICAL**: We fetch the customer's phone from ElevenLabs API (most recent conversation metadata)
   - Escalation alert posted to Google Chat with "Click here to respond" link

3. **Team Reply → Customer WhatsApp**
   - Team clicks reply link → opens reply portal
   - Portal shows full conversation history
   - Team types reply → POST to `/reply/:conversationId`
   - Message sent via WhatsApp Business API to customer's actual phone number

### Critical Code Paths (DO NOT MODIFY)

| File | Lines | Function |
|------|-------|----------|
| `src/index-simple.js` | 967-998 | Phone lookup from ElevenLabs API |
| `src/index-simple.js` | 1084-1145 | Conversation creation with phoneNumber |
| `src/index-simple.js` | 1864-1988 | Reply endpoint |
| `src/services/whatsapp-sender.js` | 45-123 | sendWhatsAppMessage |
| `src/services/conversation-store.js` | All | Conversation storage |
| `src/services/message-history.js` | All | Message history storage |

### Environment Variables Required
```
WHATSAPP_API_URL=https://graph.facebook.com/v18.0
WHATSAPP_ACCESS_TOKEN=<Meta access token>
WHATSAPP_PHONE_NUMBER_ID=742462142273418
ELEVENLABS_API_KEY=<ElevenLabs API key>
ELEVENLABS_AGENT_ID=agent_8501kesasj5fe8b8rm6nnxcvn4kb
```

### Why Phone Lookup Works
ElevenLabs stores WhatsApp metadata in conversation:
```json
{
  "metadata": {
    "whatsapp": {
      "whatsapp_user_id": "66856644142"  // Customer's phone
    }
  }
}
```

Our escalation handler fetches the most recent conversation and extracts this phone number, ensuring replies always go to the correct WhatsApp number.

---

## 🔒 FROZEN: Customer Profile Lookup (DO NOT MODIFY)

**Status: WORKING AS OF 2026-01-14**

The ElevenLabs agent recognizes returning customers by name on their FIRST message. **DO NOT MODIFY** these components:

### How It Works
1. Customer sends "Hi" on WhatsApp
2. ElevenLabs agent calls `get_customer_profile` tool
3. Tool sends `conversation_id` (auto-populated by ElevenLabs)
4. Our endpoint (`/api/customer-lookup`) receives the conversation_id
5. Endpoint fetches phone from ElevenLabs API: `metadata.whatsapp.whatsapp_user_id`
6. Looks up profile in PostgreSQL → returns customer name
7. Agent greets: "Hi Norbert! Welcome back to BMAsia."

### Critical Code Path (DO NOT MODIFY)

| File | Lines | Function |
|------|-------|----------|
| `src/index-simple.js` | 450-530 | `/api/customer-lookup` endpoint |
| `src/services/customer-profiles.js` | All | PostgreSQL profile storage |

### Key Implementation Details

```javascript
// Endpoint accepts conversation_id from ElevenLabs
app.post('/api/customer-lookup', async (req, res) => {
  let { phone, conversation_id } = req.body;

  // If conversation_id provided, fetch phone from ElevenLabs API
  if (!phone && conversation_id) {
    const convResponse = await axios.get(
      `https://api.elevenlabs.io/v1/convai/conversations/${conversation_id}`,
      { headers: { 'xi-api-key': ELEVENLABS_API_KEY } }
    );
    phone = convResponse.data?.metadata?.whatsapp?.whatsapp_user_id;
  }

  // Look up profile (with Thailand country code fallback)
  let profile = await getProfile(phone);
  // ...
});
```

### DO NOT
- Change the `/api/customer-lookup` endpoint logic
- Remove the conversation_id → phone lookup
- Remove the Thailand country code (66) fallback
- Modify the PostgreSQL customer_profiles table schema

### Environment Variables Required
```
ELEVENLABS_API_KEY=<ElevenLabs API key>
DATABASE_URL=<PostgreSQL connection string>
```

---

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
- **WhatsApp**: Disabled by default - ElevenLabs Conversational AI handles greetings
  - To re-enable: Set `ENABLE_WHATSAPP_AUTO_GREETING=true` in environment
- **LINE**: Still active - triggers on first customer contact
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