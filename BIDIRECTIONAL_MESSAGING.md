# Bidirectional Messaging System

The BMA Messenger Hub now supports bidirectional messaging, allowing Google Chat users to reply directly to WhatsApp and LINE messages.

## Architecture Overview

```
WhatsApp/LINE User → Hub → Google Chat
                   ↓
WhatsApp/LINE User ← Hub ← Google Chat
```

## Components Implemented

### 1. Conversation Store (`src/services/conversation-store.js`)
- **Purpose**: Maps Google Chat conversations to platform users
- **Storage**: In-memory with 24-hour TTL
- **Key Methods**:
  - `storeConversation(platform, userId, threadId, spaceId, senderInfo)`
  - `getConversationByUser(platform, userId)`
  - `getConversationByThread(threadId)`
  - `getStats()` - for monitoring

### 2. WhatsApp Sender (`src/services/whatsapp-sender.js`)
- **Purpose**: Send messages back to WhatsApp users
- **API**: WhatsApp Business API
- **Features**:
  - Retry logic with exponential backoff
  - Phone number validation
  - Health check endpoint
  - Comprehensive error handling

### 3. LINE Sender (`src/services/line-sender.js`)
- **Purpose**: Send messages back to LINE users
- **API**: LINE Messaging API
- **Features**:
  - Push message support
  - Rich message capabilities
  - User ID validation
  - Health check endpoint

### 4. Google Chat Webhook (`src/webhooks/google-chat.js`)
- **Purpose**: Process replies from Google Chat
- **Endpoint**: `POST /webhooks/google-chat`
- **Reply Methods**:
  - `/reply [message]` - explicit command
  - `@bot [message]` - bot mention
  - Direct thread replies - natural conversation

### 5. Enhanced Google Chat Service
- **Updates**: Added conversation tracking to `formatMessage()`
- **Features**: Includes reply instructions in forwarded messages
- **Storage**: Automatically stores conversation context when forwarding

## How It Works

### Incoming Message Flow
1. WhatsApp/LINE message received at webhook
2. Message parsed and processed
3. Conversation context stored (platform, userId, threadId, spaceId)
4. Message forwarded to appropriate Google Chat space
5. Thread ID captured and mapped to original user

### Reply Message Flow
1. Google Chat user replies in thread or uses `/reply` command
2. Webhook receives Google Chat event
3. System looks up conversation by thread ID
4. Reply routed to original platform (WhatsApp/LINE)
5. Message sent to original user

## Setup Instructions

### 1. Environment Variables
All necessary API credentials are already configured in `.env`:
- `WHATSAPP_API_URL`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`
- `LINE_API_URL`, `LINE_CHANNEL_ACCESS_TOKEN`
- `GOOGLE_CREDENTIALS_JSON`

### 2. Google Chat Webhook Configuration
1. Go to Google Cloud Console → APIs & Services → Credentials
2. Select your service account
3. Configure webhook URL: `https://your-app-url.onrender.com/webhooks/google-chat`
4. Enable Google Chat API events for your bot

### 3. Testing
Run the test script to verify functionality:
```bash
node test-bidirectional.js
```

## Usage Examples

### For Support Agents in Google Chat

**Method 1: Reply Command**
```
/reply Thank you for contacting us. We'll help you resolve this issue.
```

**Method 2: Natural Thread Reply**
Simply reply in the thread where the customer message appeared:
```
Hello! I can help you with that. What specific issue are you experiencing?
```

**Method 3: Bot Mention**
```
@BMA_Bot Please send the customer our refund policy information.
```

## Message Format

### Incoming Messages (Platform → Google Chat)
```
💬 WHATSAPP MESSAGE

From: John Doe
Phone: +1234567890
Time: 1/15/2024, 10:00:00 AM

Message:
Hello, I need help with my account.

---
💬 To reply: Simply reply to this message or use: `/reply [your message]`
```

### Reply Messages (Google Chat → Platform)
```
Thank you for contacting BMA. How can we help you today?
```

## Monitoring & Health Checks

### Health Endpoint
```bash
GET /health
```

Returns status of all services including:
- WhatsApp API connectivity
- LINE API connectivity
- Conversation store statistics
- AI translation services

### Conversation Statistics
```json
{
  "conversations": {
    "totalConversations": 5,
    "platformBreakdown": {
      "whatsapp": 3,
      "line": 2
    },
    "oldestConversation": 1642252800000,
    "newestConversation": 1642256400000
  }
}
```

## Error Handling

### Automatic Retry Logic
- WhatsApp: 3 retries with exponential backoff
- LINE: 3 retries with exponential backoff
- Skip retry for permanent errors (401, 403, 400)

### Conversation Expiry
- Conversations expire after 24 hours
- Automatic cleanup every hour
- Graceful handling of expired conversations

### Error Responses in Google Chat
```json
{
  "text": "❌ No conversation found. This might be an old conversation that has expired (24 hours)."
}
```

## Limitations & Considerations

1. **Memory Storage**: Conversations stored in memory (lost on restart)
2. **24-Hour Window**: WhatsApp Business API restriction
3. **Single Thread**: Each conversation maps to one Google Chat thread
4. **Rate Limits**: Respect platform API rate limits
5. **Media Messages**: Currently text-only replies (can be extended)

## Security Features

- Webhook signature verification (implement for production)
- Environment variable protection
- Input sanitization
- Error message filtering (no internal details exposed)

## Production Deployment

1. Deploy to Render with environment variables
2. Configure Google Chat webhook URL
3. Test with real messages
4. Monitor conversation metrics
5. Set up logging and alerting

## Troubleshooting

### Common Issues

**"No conversation found" error:**
- Check if conversation expired (>24 hours)
- Verify thread ID mapping
- Check conversation store statistics

**WhatsApp messages not sending:**
- Verify WHATSAPP_ACCESS_TOKEN
- Check phone number format
- Review rate limiting status

**LINE messages not sending:**
- Verify LINE_CHANNEL_ACCESS_TOKEN
- Check if user blocked the bot
- Ensure bot is friends with user

### Debug Commands
```javascript
// Check conversation stats
const { getStats } = require('./src/services/conversation-store');
console.log(getStats());

// Test phone number validation
const { isValidPhoneNumber } = require('./src/services/whatsapp-sender');
console.log(isValidPhoneNumber('+1234567890'));

// Test LINE user ID validation
const { isValidUserId } = require('./src/services/line-sender');
console.log(isValidUserId('U1234567890abcdef'));
```

## Future Enhancements

- Database persistence for conversation storage
- Media message reply support
- Multi-language reply templates
- Analytics and reporting dashboard
- Queue-based message processing
- Conversation history and context awareness