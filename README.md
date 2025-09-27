# BMAsia Messenger Hub

AI-driven multi-channel communication platform that intelligently routes customer messages from WhatsApp Business and LINE Business to Google Chat spaces for BMAsia's music and sound design services.

## Current Features (v1.1 Stable)

### Core Messaging
- **Single Space Routing**: All messages route to BMA Chat Support space for simplified management
- **Multi-Platform Support**: WhatsApp Business and LINE Business integration
- **Bidirectional Communication**: Reply from Google Chat back to customers on their original platform
- **Reply Portal**: Web interface for sending responses with full conversation history

### AI-Powered Features
- **Intelligent Information Gathering**: Automatically collects customer name and company on first contact
- **Smart Language Detection**: Responds in customer's language (Thai/English)
- **Natural Conversation**: Uses Gemini 2.5 Flash for contextual, polite information requests
- **One-Time Collection**: Only asks for information once per customer (24-hour memory)

### Data Management
- **24-Hour Message History**: Stores all conversations for 24 hours
- **Customer Information Cache**: Remembers customer details for returning visitors within 24 hours
- **Conversation Tracking**: Links WhatsApp/LINE conversations to Google Chat threads
- **Automatic Cleanup**: Old data is automatically removed after 24 hours

## Architecture

```
Customer → WhatsApp/LINE → Webhook → Router → Google Space
                                ↓
                           Translation
                                ↓
                        Human Agent Response
                                ↓
                           Translation
                                ↓
Customer ← WhatsApp/LINE ← Response Handler ← Google Space
```

## Tech Stack

- **Runtime**: Node.js with TypeScript
- **AI**: Google Gemini 2.5 Flash
- **Messaging**: WhatsApp Business API, LINE Business API, Google Chat API
- **Infrastructure**: Render (hosting), Redis (queue), PostgreSQL (optional)
- **CI/CD**: GitHub Actions

## Setup

### Prerequisites

- Node.js 20+
- Redis instance (for message queue)
- Render account
- API credentials for WhatsApp Business, LINE Business, and Google Chat

### Installation

```bash
npm install
```

### Environment Variables

Copy `.env.example` to `.env` and configure:

- `GCHAT_TECHNICAL_SPACE`: Google Chat Technical Support space ID
- `GCHAT_DESIGN_SPACE`: Google Chat Design space ID
- `GCHAT_SALES_SPACE`: Google Chat Sales space ID
- `WHATSAPP_*`: WhatsApp Business API credentials
- `LINE_*`: LINE Business API credentials
- `GEMINI_API_KEY`: Google Gemini API key
- `GOOGLE_CREDENTIALS_JSON`: Google service account JSON

### Development

```bash
npm run dev
```

### Production

```bash
npm run build
npm start
```

## Testing

```bash
npm test
```

## Deployment

Automatically deploys to Render on push to main branch via GitHub Actions.

## Message Flow

1. Customer sends message to WhatsApp/LINE Business account
2. Webhook receives and processes message
3. Keyword router attempts to classify message
4. If unclear, Gemini AI analyzes and may clarify
5. Message routed to appropriate Google Space
6. Translation applied if needed
7. Human agent responds in Google Space
8. Response translated back to original language
9. Message sent to customer via original platform

## Project Structure

```
src/
├── api/           # Webhook endpoints
├── services/      # Business logic
│   ├── routing/   # Message classification
│   └── translation/
├── integrations/  # External APIs
│   ├── whatsapp/
│   ├── line/
│   ├── google-chat/
│   └── gemini/
└── utils/        # Helpers
```

## License

MIT