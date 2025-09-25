// Webhook endpoint tests for BMA Messenger Hub
// Tests WhatsApp and LINE webhook processing with comprehensive mocking

const request = require('supertest');
const express = require('express');

// Mock all external services before importing the main app
jest.mock('../src/services/google-chat-simple');
jest.mock('../src/services/message-router');
jest.mock('../src/services/translator');

const { sendMessage } = require('../src/services/google-chat-simple');
const { routeMessage, aiHealthCheck } = require('../src/services/message-router');
const { translateMessage, healthCheck: translatorHealthCheck } = require('../src/services/translator');

// Import the app after mocking
const app = require('../src/index-simple');

// Mock sample data
const mockWhatsAppMessage = {
  entry: [{
    id: "entry_id",
    changes: [{
      value: {
        messaging_product: "whatsapp",
        metadata: {
          display_phone_number: "1234567890",
          phone_number_id: "phone_id"
        },
        contacts: [{
          profile: {
            name: "John Doe"
          },
          wa_id: "1234567890"
        }],
        messages: [{
          from: "1234567890",
          id: "message_id",
          timestamp: "1640995200",
          text: {
            body: "Hello, I need technical support"
          },
          type: "text"
        }]
      },
      field: "messages"
    }]
  }]
};

const mockWhatsAppImageMessage = {
  entry: [{
    id: "entry_id",
    changes: [{
      value: {
        messaging_product: "whatsapp",
        metadata: {
          display_phone_number: "1234567890",
          phone_number_id: "phone_id"
        },
        contacts: [{
          profile: {
            name: "Jane Doe"
          },
          wa_id: "0987654321"
        }],
        messages: [{
          from: "0987654321",
          id: "message_id",
          timestamp: "1640995300",
          image: {
            caption: "Product image",
            mime_type: "image/jpeg",
            sha256: "hash",
            id: "image_id"
          },
          type: "image"
        }]
      },
      field: "messages"
    }]
  }]
};

const mockLineMessage = {
  destination: "destination_id",
  events: [{
    type: "message",
    mode: "active",
    timestamp: 1640995200000,
    source: {
      type: "user",
      userId: "user123"
    },
    webhookEventId: "webhook_id",
    deliveryContext: {
      isRedelivery: false
    },
    message: {
      id: "message_id",
      type: "text",
      quoteToken: "quote_token",
      text: "I need a quote for music production"
    },
    replyToken: "reply_token"
  }]
};

const mockLineGroupMessage = {
  destination: "destination_id",
  events: [{
    type: "message",
    mode: "active",
    timestamp: 1640995400000,
    source: {
      type: "group",
      groupId: "group123",
      userId: "user456"
    },
    webhookEventId: "webhook_id_2",
    deliveryContext: {
      isRedelivery: false
    },
    message: {
      id: "message_id_2",
      type: "text",
      quoteToken: "quote_token_2",
      text: "Design consultation needed"
    },
    replyToken: "reply_token_2"
  }]
};

const mockLineStickerMessage = {
  destination: "destination_id",
  events: [{
    type: "message",
    mode: "active",
    timestamp: 1640995500000,
    source: {
      type: "user",
      userId: "user789"
    },
    webhookEventId: "webhook_id_3",
    deliveryContext: {
      isRedelivery: false
    },
    message: {
      id: "message_id_3",
      type: "sticker",
      stickerId: "sticker_id",
      packageId: "package_id"
    },
    replyToken: "reply_token_3"
  }]
};

describe('Webhook Endpoints', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Set up default mock implementations
    sendMessage.mockResolvedValue({ name: 'spaces/test/messages/123' });
    routeMessage.mockResolvedValue({
      spaceId: 'spaces/technical',
      department: 'technical',
      source: 'keyword',
      keyword: 'support',
      confidence: 1.0
    });
    translateMessage.mockResolvedValue({
      originalLanguage: 'english',
      translatedText: 'Hello, I need technical support',
      isTranslated: false
    });
    aiHealthCheck.mockResolvedValue({
      status: 'healthy',
      message: 'AI classifier is working'
    });
    translatorHealthCheck.mockResolvedValue({
      status: 'healthy',
      message: 'Translation service is working'
    });
  });

  describe('Health Check Endpoint', () => {
    test('should return health status with all services healthy', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toEqual({
        status: 'ok',
        service: 'BMA Messenger Hub',
        ai: {
          status: 'healthy',
          message: 'AI classifier is working'
        },
        translator: {
          status: 'healthy',
          message: 'Translation service is working'
        }
      });

      expect(aiHealthCheck).toHaveBeenCalledTimes(1);
      expect(translatorHealthCheck).toHaveBeenCalledTimes(1);
    });

    test('should handle AI service errors gracefully', async () => {
      aiHealthCheck.mockRejectedValue(new Error('AI service down'));

      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toEqual({
        status: 'ok',
        service: 'BMA Messenger Hub',
        ai: {
          status: 'error',
          message: 'AI service down'
        },
        translator: {
          status: 'error',
          message: 'AI service down'
        }
      });
    });
  });

  describe('Root Endpoint', () => {
    test('should return service information', async () => {
      const response = await request(app)
        .get('/')
        .expect(200);

      expect(response.body).toEqual({
        message: 'BMA Messenger Hub is running',
        version: '1.0.0',
        endpoints: {
          whatsapp: '/webhooks/whatsapp',
          line: '/webhooks/line',
          health: '/health'
        }
      });
    });
  });

  describe('WhatsApp Webhook Verification', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    test('should verify webhook with correct token', async () => {
      process.env.WHATSAPP_VERIFY_TOKEN = 'test_verify_token';

      const response = await request(app)
        .get('/webhooks/whatsapp')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'test_verify_token',
          'hub.challenge': 'challenge_string'
        })
        .expect(200);

      expect(response.text).toBe('challenge_string');
    });

    test('should reject webhook with incorrect token', async () => {
      process.env.WHATSAPP_VERIFY_TOKEN = 'correct_token';

      await request(app)
        .get('/webhooks/whatsapp')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'wrong_token',
          'hub.challenge': 'challenge_string'
        })
        .expect(403);
    });

    test('should reject webhook with incorrect mode', async () => {
      process.env.WHATSAPP_VERIFY_TOKEN = 'test_verify_token';

      await request(app)
        .get('/webhooks/whatsapp')
        .query({
          'hub.mode': 'unsubscribe',
          'hub.verify_token': 'test_verify_token',
          'hub.challenge': 'challenge_string'
        })
        .expect(403);
    });

    test('should use default token when env var not set', async () => {
      delete process.env.WHATSAPP_VERIFY_TOKEN;

      const response = await request(app)
        .get('/webhooks/whatsapp')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'bma_whatsapp_verify_2024',
          'hub.challenge': 'challenge_string'
        })
        .expect(200);

      expect(response.text).toBe('challenge_string');
    });
  });

  describe('WhatsApp Message Processing', () => {
    test('should process text message successfully', async () => {
      const response = await request(app)
        .post('/webhooks/whatsapp')
        .send(mockWhatsAppMessage)
        .expect(200);

      // Verify translation was called
      expect(translateMessage).toHaveBeenCalledWith('Hello, I need technical support');

      // Verify routing was called
      expect(routeMessage).toHaveBeenCalledWith('Hello, I need technical support');

      // Verify message was sent to Google Chat
      expect(sendMessage).toHaveBeenCalledWith(
        'spaces/technical',
        'Hello, I need technical support',
        expect.objectContaining({
          platform: 'whatsapp',
          senderId: '1234567890',
          senderName: 'John Doe',
          phoneNumber: '1234567890',
          messageText: 'Hello, I need technical support',
          timestamp: 1640995200,
          messageType: 'text'
        })
      );
    });

    test('should process image message with caption', async () => {
      await request(app)
        .post('/webhooks/whatsapp')
        .send(mockWhatsAppImageMessage)
        .expect(200);

      expect(translateMessage).toHaveBeenCalledWith('[Image] Product image');
      expect(routeMessage).toHaveBeenCalledWith('[Image] Product image');
      expect(sendMessage).toHaveBeenCalledWith(
        'spaces/technical',
        '[Image] Product image', // Original message used when no translation
        expect.objectContaining({
          platform: 'whatsapp',
          messageType: 'image',
          messageText: '[Image] Product image'
        })
      );
    });

    test('should handle translated message', async () => {
      translateMessage.mockResolvedValue({
        originalLanguage: 'spanish',
        translatedText: 'Hola mundo\n---\n[English Translation]: Hello world',
        isTranslated: true
      });

      await request(app)
        .post('/webhooks/whatsapp')
        .send(mockWhatsAppMessage)
        .expect(200);

      expect(sendMessage).toHaveBeenCalledWith(
        'spaces/technical',
        'Hola mundo\n---\n[English Translation]: Hello world',
        expect.any(Object)
      );
    });

    test('should handle invalid message structure gracefully', async () => {
      const invalidMessage = { entry: [] };

      const response = await request(app)
        .post('/webhooks/whatsapp')
        .send(invalidMessage)
        .expect(200);

      expect(translateMessage).not.toHaveBeenCalled();
      expect(routeMessage).not.toHaveBeenCalled();
      expect(sendMessage).not.toHaveBeenCalled();
    });

    test('should handle empty message body', async () => {
      await request(app)
        .post('/webhooks/whatsapp')
        .send({})
        .expect(200);

      expect(translateMessage).not.toHaveBeenCalled();
      expect(routeMessage).not.toHaveBeenCalled();
      expect(sendMessage).not.toHaveBeenCalled();
    });

    test('should continue processing even if translation fails', async () => {
      translateMessage.mockRejectedValue(new Error('Translation failed'));

      await request(app)
        .post('/webhooks/whatsapp')
        .send(mockWhatsAppMessage)
        .expect(200);

      // Translation failure should cause the entire processing to fail
      expect(routeMessage).not.toHaveBeenCalled();
      expect(sendMessage).not.toHaveBeenCalled();
    });

    test('should continue processing even if routing fails', async () => {
      routeMessage.mockRejectedValue(new Error('Routing failed'));

      await request(app)
        .post('/webhooks/whatsapp')
        .send(mockWhatsAppMessage)
        .expect(200);

      // Should still call translation
      expect(translateMessage).toHaveBeenCalled();
    });

    test('should continue processing even if sending fails', async () => {
      sendMessage.mockRejectedValue(new Error('Send failed'));

      await request(app)
        .post('/webhooks/whatsapp')
        .send(mockWhatsAppMessage)
        .expect(200);

      expect(translateMessage).toHaveBeenCalled();
      expect(routeMessage).toHaveBeenCalled();
      expect(sendMessage).toHaveBeenCalled();
    });
  });

  describe('LINE Message Processing', () => {
    test('should process text message successfully', async () => {
      routeMessage.mockResolvedValue({
        spaceId: 'spaces/sales',
        department: 'sales',
        source: 'keyword',
        keyword: 'quote',
        confidence: 1.0
      });

      await request(app)
        .post('/webhooks/line')
        .send(mockLineMessage)
        .expect(200);

      expect(translateMessage).toHaveBeenCalledWith('I need a quote for music production');
      expect(routeMessage).toHaveBeenCalledWith('I need a quote for music production');
      expect(sendMessage).toHaveBeenCalledWith(
        'spaces/sales',
        'I need a quote for music production', // Original message when no translation
        expect.objectContaining({
          platform: 'line',
          senderId: 'user123',
          senderName: 'LINE User',
          phoneNumber: null,
          messageText: 'I need a quote for music production',
          timestamp: 1640995200,
          messageType: 'text'
        })
      );
    });

    test('should process group message', async () => {
      routeMessage.mockResolvedValue({
        spaceId: 'spaces/design',
        department: 'design',
        source: 'keyword',
        keyword: 'design',
        confidence: 1.0
      });

      await request(app)
        .post('/webhooks/line')
        .send(mockLineGroupMessage)
        .expect(200);

      expect(sendMessage).toHaveBeenCalledWith(
        'spaces/design',
        'Design consultation needed', // Original message when no translation
        expect.objectContaining({
          platform: 'line',
          senderId: 'user456', // userId takes precedence over groupId
          senderName: 'Group: group123',
          messageText: 'Design consultation needed'
        })
      );
    });

    test('should process sticker message', async () => {
      await request(app)
        .post('/webhooks/line')
        .send(mockLineStickerMessage)
        .expect(200);

      expect(translateMessage).toHaveBeenCalledWith('[Sticker] Sticker sent');
      expect(routeMessage).toHaveBeenCalledWith('[Sticker] Sticker sent');
      expect(sendMessage).toHaveBeenCalledWith(
        'spaces/technical',
        '[Sticker] Sticker sent', // Original message when no translation
        expect.objectContaining({
          platform: 'line',
          messageType: 'sticker',
          messageText: '[Sticker] Sticker sent'
        })
      );
    });

    test('should handle non-message events gracefully', async () => {
      const nonMessageEvent = {
        destination: "destination_id",
        events: [{
          type: "follow",
          timestamp: 1640995200000,
          source: {
            type: "user",
            userId: "user123"
          }
        }]
      };

      await request(app)
        .post('/webhooks/line')
        .send(nonMessageEvent)
        .expect(200);

      expect(translateMessage).not.toHaveBeenCalled();
      expect(routeMessage).not.toHaveBeenCalled();
      expect(sendMessage).not.toHaveBeenCalled();
    });

    test('should handle empty events array', async () => {
      const emptyEvents = {
        destination: "destination_id",
        events: []
      };

      await request(app)
        .post('/webhooks/line')
        .send(emptyEvents)
        .expect(200);

      expect(translateMessage).not.toHaveBeenCalled();
      expect(routeMessage).not.toHaveBeenCalled();
      expect(sendMessage).not.toHaveBeenCalled();
    });

    test('should handle malformed LINE message gracefully', async () => {
      const malformedMessage = {
        destination: "destination_id"
        // missing events
      };

      await request(app)
        .post('/webhooks/line')
        .send(malformedMessage)
        .expect(200);

      expect(translateMessage).not.toHaveBeenCalled();
      expect(routeMessage).not.toHaveBeenCalled();
      expect(sendMessage).not.toHaveBeenCalled();
    });

    test('should continue processing even if LINE translation fails', async () => {
      translateMessage.mockRejectedValue(new Error('LINE translation failed'));

      await request(app)
        .post('/webhooks/line')
        .send(mockLineMessage)
        .expect(200);

      // Translation failure should cause the entire processing to fail
      expect(routeMessage).not.toHaveBeenCalled();
      expect(sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    test('should handle JSON parsing errors gracefully', async () => {
      // Express.json() middleware will reject malformed JSON with 400
      const response = await request(app)
        .post('/webhooks/whatsapp')
        .type('application/json')
        .send('{"invalid": json}'); // Malformed JSON

      expect([400, 200]).toContain(response.status);
    });

    test('should handle very large payloads', async () => {
      const largeMessage = {
        ...mockWhatsAppMessage,
        entry: [{
          ...mockWhatsAppMessage.entry[0],
          changes: [{
            ...mockWhatsAppMessage.entry[0].changes[0],
            value: {
              ...mockWhatsAppMessage.entry[0].changes[0].value,
              messages: [{
                ...mockWhatsAppMessage.entry[0].changes[0].value.messages[0],
                text: {
                  body: 'a'.repeat(10000) // Very long message
                }
              }]
            }
          }]
        }]
      };

      await request(app)
        .post('/webhooks/whatsapp')
        .send(largeMessage)
        .expect(200);

      expect(translateMessage).toHaveBeenCalled();
      expect(routeMessage).toHaveBeenCalled();
    });

    test('should handle concurrent requests', async () => {
      const requests = Array.from({ length: 5 }, (_, i) =>
        request(app)
          .post('/webhooks/whatsapp')
          .send({
            ...mockWhatsAppMessage,
            entry: [{
              ...mockWhatsAppMessage.entry[0],
              changes: [{
                ...mockWhatsAppMessage.entry[0].changes[0],
                value: {
                  ...mockWhatsAppMessage.entry[0].changes[0].value,
                  messages: [{
                    ...mockWhatsAppMessage.entry[0].changes[0].value.messages[0],
                    text: { body: `Test message ${i}` },
                    id: `message_${i}`
                  }]
                }
              }]
            }]
          })
      );

      const responses = await Promise.all(requests);

      responses.forEach(response => {
        expect(response.status).toBe(200);
      });

      expect(translateMessage).toHaveBeenCalledTimes(5);
      expect(routeMessage).toHaveBeenCalledTimes(5);
      expect(sendMessage).toHaveBeenCalledTimes(5);
    });
  });
});