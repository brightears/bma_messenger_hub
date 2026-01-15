# Claude Code Development Guide

## Project: BMAsia Messenger Hub

This document provides Claude Code-specific instructions and best practices for developing the BMAsia Messenger Hub platform.

---

## ⛔ CRITICAL: FROZEN COMPONENTS - DO NOT TOUCH ⛔

**The following features are PRODUCTION-CRITICAL and took significant effort to get working. DO NOT modify ANY code related to these features without EXPLICIT user approval:**

1. **WhatsApp Reply Flow** (`/reply-el/` endpoint) - Escalation → Google Chat → Reply Portal → WhatsApp
2. **Customer Profile Lookup** (`/api/customer-lookup`) - Agent recognizes returning customers
3. **ElevenLabs Integration** - Conversation handling, phone extraction, transcript fetching

**Before making ANY changes, ask yourself:**
- Does this touch the escalation webhook? → ASK USER FIRST
- Does this touch the reply portal? → ASK USER FIRST
- Does this touch customer lookup? → ASK USER FIRST
- Does this touch ElevenLabs API calls? → ASK USER FIRST

**If in doubt, DO NOT TOUCH IT.**

---

## Current Status (v1.5-reply-portal-fix)

**Last updated**: 2026-01-15

### Working Features
- ✅ Single-space routing (BMA Chat Support)
- ✅ AI information gathering (customer name & company) - **LINE only** (WhatsApp handled by ElevenLabs)
- ✅ 24-hour message history storage
- ✅ Customer info persistence (PostgreSQL - permanent)
- ✅ Language auto-detection (Thai/English)
- ✅ WhatsApp & LINE webhook integration
- ✅ ElevenLabs Conversational AI integration for WhatsApp
- ✅ **Soundtrack zone status with device pairing codes** (uses `device.pairingCode`)

### 🔒 FROZEN Features (DO NOT MODIFY)
- ✅ **WhatsApp reply from Google Chat portal** - Uses `/reply-el/{elevenlabs_id}` endpoint
- ✅ **Customer profile lookup** - Agent recognizes returning customers by name
- ✅ **Deploy-proof reply portal** - Fetches from ElevenLabs API, survives server restarts

---

## 🔒 FROZEN: WhatsApp Reply Flow (DO NOT MODIFY)

**Status: WORKING AS OF 2026-01-15**

This section documents the working WhatsApp reply flow. **DO NOT MODIFY** any of these components without explicit user approval.

### How It Works

1. **Customer → WhatsApp → ElevenLabs Agent**
   - Customer sends WhatsApp message
   - ElevenLabs Conversational AI handles the conversation
   - ElevenLabs stores conversation with WhatsApp metadata

2. **Agent Escalation → Google Chat**
   - When AI needs to escalate, it calls `escalate_to_team` webhook
   - Our webhook (`/webhooks/elevenlabs/escalate`) receives the escalation
   - **CRITICAL**: Reply link uses ElevenLabs conversation_id directly → survives deploys!
   - Escalation alert posted to Google Chat with "Click here to respond" link

3. **Team Reply → Customer WhatsApp**
   - Team clicks reply link → opens `/reply-el/{elevenlabs_conversation_id}`
   - **NEW**: Portal fetches conversation directly from ElevenLabs API (not local storage)
   - Portal shows full transcript from ElevenLabs
   - Team types reply → POST to `/reply-el/{id}`
   - Message sent via WhatsApp Business API to customer's actual phone number

### Deploy-Proof Reply Portal (Added 2026-01-15)

**Problem Solved**: Reply links used to break after Render deploys because conversations were stored in-memory (Map) and lost when the dyno restarted.

**Solution**: New `/reply-el/:elevenLabsConvId` endpoint that:
1. Takes ElevenLabs conversation_id from URL
2. Fetches conversation from ElevenLabs API directly
3. Extracts phone from `metadata.whatsapp.whatsapp_user_id`
4. Gets transcript for conversation history display
5. Sends replies via WhatsApp Business API

**Old endpoint** (`/reply/:conversationId`) kept for backward compatibility - uses local storage.

### Critical Code Paths (DO NOT MODIFY)

| File | Lines | Function |
|------|-------|----------|
| `src/index-simple.js` | 1217-1226 | Reply link generation (uses ElevenLabs ID) |
| `src/index-simple.js` | 1966-2346 | `/reply-el` GET endpoint (ElevenLabs-based) |
| `src/index-simple.js` | 2348-2416 | `/reply-el` POST endpoint (ElevenLabs-based) |
| `src/index-simple.js` | 1424-1960 | `/reply` GET endpoint (legacy, local storage) |
| `src/services/whatsapp-sender.js` | 45-123 | sendWhatsAppMessage |

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

## Google Chat Escalation Message Format

**Status: Working (Updated 2026-01-15)**

When the ElevenLabs agent escalates to the team, a formatted message appears in Google Chat:

```
🚨 *Escalation Alert - Customer Needs Assistance*

👤 *Name:* [customer name]
🏢 *Company:* [company]
📱 *Phone:* [phone]
📧 *Email:* [email]

❓ *Issue:* [issue summary]
⚠️ *Urgency:* [urgency level]

🔗 ElevenLabs Conv: [conversation_id]

---
↩️ *Reply to customer:* Click here to respond
```

**Key files:**
- `src/index-simple.js:1226-1256` - Builds escalation alert message
- `src/services/google-chat-simple.js:165-206` - `formatMessage()` formats for Google Chat

**Design decisions:**
- `escalation_reason` (e.g., "customer_requested") is NOT displayed - issue summary provides sufficient context
- `formatMessage()` checks `!message.includes('Reply to customer:')` before adding fallback link - prevents duplicate reply links on escalation alerts

---

## Soundtrack Zone Status Proxy

**Status: Working (Updated 2026-01-15)**

The `/api/soundtrack/zone-status` endpoint proxies requests to the Soundtrack Your Brand GraphQL API.

### Pairing Codes (IMPORTANT!)

**Two different codes exist - use the correct one:**

| Code | Field | Format | Purpose |
|------|-------|--------|---------|
| ❌ `remoteCode` | `soundZone.remoteCode` | "GZFDAV" | iOS Remote app control |
| ✅ `pairingCode` | `soundZone.device.pairingCode` | "RRMCBP" | **Device pairing** |

**CRITICAL**: Use `device.pairingCode` NOT `remoteCode` for device pairing!

### Current Implementation (lines 229-390)

```javascript
// GraphQL query includes device { pairingCode }
query: `query { soundZone(id: "${zoneId}") { id name isPaired device { pairingCode } playback { state } } }`

// Response includes pairing code when zone is not paired
if (!zone.isPaired && zone.device?.pairingCode) {
  responseData.zone.pairing_code = zone.device.pairingCode;
}
```

### API Token Access

The Test API token has access to **939 accounts**. Zones not in this list return "not managed by BMAsia".

To add more accounts: Contact Soundtrack Your Brand to update API token permissions.

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