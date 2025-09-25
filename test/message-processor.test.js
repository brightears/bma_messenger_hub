// Message processor tests for BMA Messenger Hub
// Tests parsing of WhatsApp and LINE webhook messages

const {
  parseWhatsAppMessage,
  parseLineMessage,
  parseMessage,
  isValidMessage,
  messageProcessor
} = require('../src/services/message-processor');

describe('Message Processor Service', () => {
  describe('WhatsApp Message Parsing', () => {
    const sampleWhatsAppMessage = {
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

    test('should parse basic text message correctly', () => {
      const result = parseWhatsAppMessage(sampleWhatsAppMessage);

      expect(result).toEqual({
        platform: 'whatsapp',
        senderId: '1234567890',
        senderName: 'John Doe',
        phoneNumber: '1234567890',
        messageText: 'Hello, I need technical support',
        timestamp: 1640995200,
        messageType: 'text',
        originalMessage: sampleWhatsAppMessage.entry[0].changes[0].value.messages[0]
      });
    });

    test('should parse message without contact name', () => {
      const messageWithoutName = {
        ...sampleWhatsAppMessage,
        entry: [{
          ...sampleWhatsAppMessage.entry[0],
          changes: [{
            ...sampleWhatsAppMessage.entry[0].changes[0],
            value: {
              ...sampleWhatsAppMessage.entry[0].changes[0].value,
              contacts: [{
                wa_id: "1234567890"
                // No profile name
              }]
            }
          }]
        }]
      };

      const result = parseWhatsAppMessage(messageWithoutName);

      expect(result.senderName).toBe('Unknown');
    });

    test('should parse message without any contacts', () => {
      const messageWithoutContacts = {
        ...sampleWhatsAppMessage,
        entry: [{
          ...sampleWhatsAppMessage.entry[0],
          changes: [{
            ...sampleWhatsAppMessage.entry[0].changes[0],
            value: {
              ...sampleWhatsAppMessage.entry[0].changes[0].value,
              contacts: []
            }
          }]
        }]
      };

      const result = parseWhatsAppMessage(messageWithoutContacts);

      expect(result.senderName).toBe('Unknown');
    });

    test('should parse image message with caption', () => {
      const imageMessage = {
        entry: [{
          id: "entry_id",
          changes: [{
            value: {
              messaging_product: "whatsapp",
              contacts: [{
                profile: { name: "Jane Doe" },
                wa_id: "0987654321"
              }],
              messages: [{
                from: "0987654321",
                id: "message_id",
                timestamp: "1640995300",
                image: {
                  caption: "Product screenshot",
                  mime_type: "image/jpeg",
                  sha256: "hash",
                  id: "image_id"
                },
                type: "image"
              }]
            }
          }]
        }]
      };

      const result = parseWhatsAppMessage(imageMessage);

      expect(result.messageText).toBe('[Image] Product screenshot');
      expect(result.messageType).toBe('image');
    });

    test('should parse image message without caption', () => {
      const imageMessage = {
        entry: [{
          id: "entry_id",
          changes: [{
            value: {
              messaging_product: "whatsapp",
              contacts: [{
                profile: { name: "Jane Doe" },
                wa_id: "0987654321"
              }],
              messages: [{
                from: "0987654321",
                id: "message_id",
                timestamp: "1640995300",
                image: {
                  mime_type: "image/jpeg",
                  sha256: "hash",
                  id: "image_id"
                },
                type: "image"
              }]
            }
          }]
        }]
      };

      const result = parseWhatsAppMessage(imageMessage);

      expect(result.messageText).toBe('[Image] Image sent');
    });

    test('should parse document message', () => {
      const documentMessage = {
        entry: [{
          id: "entry_id",
          changes: [{
            value: {
              messaging_product: "whatsapp",
              contacts: [{
                profile: { name: "John Doe" },
                wa_id: "1234567890"
              }],
              messages: [{
                from: "1234567890",
                id: "message_id",
                timestamp: "1640995400",
                document: {
                  filename: "contract.pdf",
                  mime_type: "application/pdf",
                  sha256: "hash",
                  id: "doc_id"
                },
                type: "document"
              }]
            }
          }]
        }]
      };

      const result = parseWhatsAppMessage(documentMessage);

      expect(result.messageText).toBe('[Document] contract.pdf');
      expect(result.messageType).toBe('document');
    });

    test('should parse audio message', () => {
      const audioMessage = {
        entry: [{
          id: "entry_id",
          changes: [{
            value: {
              messaging_product: "whatsapp",
              contacts: [{
                profile: { name: "John Doe" },
                wa_id: "1234567890"
              }],
              messages: [{
                from: "1234567890",
                id: "message_id",
                timestamp: "1640995500",
                audio: {
                  mime_type: "audio/ogg",
                  sha256: "hash",
                  id: "audio_id"
                },
                type: "audio"
              }]
            }
          }]
        }]
      };

      const result = parseWhatsAppMessage(audioMessage);

      expect(result.messageText).toBe('[Voice message]');
      expect(result.messageType).toBe('audio');
    });

    test('should parse video message', () => {
      const videoMessage = {
        entry: [{
          id: "entry_id",
          changes: [{
            value: {
              messaging_product: "whatsapp",
              contacts: [{
                profile: { name: "John Doe" },
                wa_id: "1234567890"
              }],
              messages: [{
                from: "1234567890",
                id: "message_id",
                timestamp: "1640995600",
                video: {
                  caption: "Funny video",
                  mime_type: "video/mp4",
                  sha256: "hash",
                  id: "video_id"
                },
                type: "video"
              }]
            }
          }]
        }]
      };

      const result = parseWhatsAppMessage(videoMessage);

      expect(result.messageText).toBe('[Video] Funny video');
      expect(result.messageType).toBe('video');
    });

    test('should handle unsupported message types', () => {
      const unsupportedMessage = {
        entry: [{
          id: "entry_id",
          changes: [{
            value: {
              messaging_product: "whatsapp",
              contacts: [{
                profile: { name: "John Doe" },
                wa_id: "1234567890"
              }],
              messages: [{
                from: "1234567890",
                id: "message_id",
                timestamp: "1640995700",
                type: "location"
              }]
            }
          }]
        }]
      };

      const result = parseWhatsAppMessage(unsupportedMessage);

      expect(result.messageText).toBe('[location] Unsupported message type');
      expect(result.messageType).toBe('location');
    });

    test('should handle empty entry array', () => {
      const result = parseWhatsAppMessage({ entry: [] });
      expect(result).toBeNull();
    });

    test('should handle missing entry', () => {
      const result = parseWhatsAppMessage({});
      expect(result).toBeNull();
    });

    test('should handle empty changes array', () => {
      const result = parseWhatsAppMessage({
        entry: [{ changes: [] }]
      });
      expect(result).toBeNull();
    });

    test('should handle missing messages', () => {
      const result = parseWhatsAppMessage({
        entry: [{
          changes: [{
            value: { messaging_product: "whatsapp" }
          }]
        }]
      });
      expect(result).toBeNull();
    });

    test('should handle parsing errors gracefully', () => {
      // Malformed message that would throw an error
      const malformedMessage = {
        entry: [{
          changes: [{
            value: {
              messages: [null] // null message
            }
          }]
        }]
      };

      const result = parseWhatsAppMessage(malformedMessage);
      expect(result).toBeNull();
    });
  });

  describe('LINE Message Parsing', () => {
    const sampleLineMessage = {
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
          text: "I need help with pricing"
        },
        replyToken: "reply_token"
      }]
    };

    test('should parse basic text message correctly', () => {
      const result = parseLineMessage(sampleLineMessage);

      expect(result).toEqual({
        platform: 'line',
        senderId: 'user123',
        senderName: 'LINE User',
        phoneNumber: null,
        messageText: 'I need help with pricing',
        timestamp: 1640995200,
        messageType: 'text',
        originalMessage: sampleLineMessage.events[0]
      });
    });

    test('should parse group message correctly', () => {
      const groupMessage = {
        destination: "destination_id",
        events: [{
          type: "message",
          timestamp: 1640995300000,
          source: {
            type: "group",
            groupId: "group123",
            userId: "user456"
          },
          message: {
            id: "message_id",
            type: "text",
            text: "Group discussion message"
          }
        }]
      };

      const result = parseLineMessage(groupMessage);

      expect(result).toEqual({
        platform: 'line',
        senderId: 'user456', // userId takes precedence over groupId
        senderName: 'Group: group123',
        phoneNumber: null,
        messageText: 'Group discussion message',
        timestamp: 1640995300,
        messageType: 'text',
        originalMessage: groupMessage.events[0]
      });
    });

    test('should parse room message correctly', () => {
      const roomMessage = {
        destination: "destination_id",
        events: [{
          type: "message",
          timestamp: 1640995400000,
          source: {
            type: "room",
            roomId: "room789"
          },
          message: {
            id: "message_id",
            type: "text",
            text: "Room chat message"
          }
        }]
      };

      const result = parseLineMessage(roomMessage);

      expect(result.senderName).toBe('Room: room789');
      expect(result.senderId).toBe('room789');
    });

    test('should parse image message', () => {
      const imageMessage = {
        destination: "destination_id",
        events: [{
          type: "message",
          timestamp: 1640995500000,
          source: {
            type: "user",
            userId: "user123"
          },
          message: {
            id: "message_id",
            type: "image"
          }
        }]
      };

      const result = parseLineMessage(imageMessage);

      expect(result.messageText).toBe('[Image] Image sent');
      expect(result.messageType).toBe('image');
    });

    test('should parse video message', () => {
      const videoMessage = {
        destination: "destination_id",
        events: [{
          type: "message",
          timestamp: 1640995600000,
          source: {
            type: "user",
            userId: "user123"
          },
          message: {
            id: "message_id",
            type: "video"
          }
        }]
      };

      const result = parseLineMessage(videoMessage);

      expect(result.messageText).toBe('[Video] Video sent');
      expect(result.messageType).toBe('video');
    });

    test('should parse audio message', () => {
      const audioMessage = {
        destination: "destination_id",
        events: [{
          type: "message",
          timestamp: 1640995700000,
          source: {
            type: "user",
            userId: "user123"
          },
          message: {
            id: "message_id",
            type: "audio"
          }
        }]
      };

      const result = parseLineMessage(audioMessage);

      expect(result.messageText).toBe('[Audio] Audio message sent');
      expect(result.messageType).toBe('audio');
    });

    test('should parse file message', () => {
      const fileMessage = {
        destination: "destination_id",
        events: [{
          type: "message",
          timestamp: 1640995800000,
          source: {
            type: "user",
            userId: "user123"
          },
          message: {
            id: "message_id",
            type: "file",
            fileName: "document.pdf"
          }
        }]
      };

      const result = parseLineMessage(fileMessage);

      expect(result.messageText).toBe('[File] document.pdf');
      expect(result.messageType).toBe('file');
    });

    test('should parse file message without filename', () => {
      const fileMessage = {
        destination: "destination_id",
        events: [{
          type: "message",
          timestamp: 1640995800000,
          source: {
            type: "user",
            userId: "user123"
          },
          message: {
            id: "message_id",
            type: "file"
          }
        }]
      };

      const result = parseLineMessage(fileMessage);

      expect(result.messageText).toBe('[File] File sent');
    });

    test('should parse location message', () => {
      const locationMessage = {
        destination: "destination_id",
        events: [{
          type: "message",
          timestamp: 1640995900000,
          source: {
            type: "user",
            userId: "user123"
          },
          message: {
            id: "message_id",
            type: "location"
          }
        }]
      };

      const result = parseLineMessage(locationMessage);

      expect(result.messageText).toBe('[Location] Location shared');
      expect(result.messageType).toBe('location');
    });

    test('should parse sticker message', () => {
      const stickerMessage = {
        destination: "destination_id",
        events: [{
          type: "message",
          timestamp: 1641000000000,
          source: {
            type: "user",
            userId: "user123"
          },
          message: {
            id: "message_id",
            type: "sticker",
            stickerId: "sticker_id",
            packageId: "package_id"
          }
        }]
      };

      const result = parseLineMessage(stickerMessage);

      expect(result.messageText).toBe('[Sticker] Sticker sent');
      expect(result.messageType).toBe('sticker');
    });

    test('should handle non-message events', () => {
      const followEvent = {
        destination: "destination_id",
        events: [{
          type: "follow",
          timestamp: 1641000100000,
          source: {
            type: "user",
            userId: "user123"
          }
        }]
      };

      const result = parseLineMessage(followEvent);
      expect(result).toBeNull();
    });

    test('should handle empty events array', () => {
      const result = parseLineMessage({
        destination: "destination_id",
        events: []
      });
      expect(result).toBeNull();
    });

    test('should handle missing events', () => {
      const result = parseLineMessage({
        destination: "destination_id"
      });
      expect(result).toBeNull();
    });

    test('should handle parsing errors gracefully', () => {
      const malformedMessage = {
        events: [null] // null event
      };

      const result = parseLineMessage(malformedMessage);
      expect(result).toBeNull();
    });
  });

  describe('Generic Message Parser', () => {
    const sampleWhatsAppMessage = {
      entry: [{
        changes: [{
          value: {
            contacts: [{ profile: { name: "Test User" }, wa_id: "123" }],
            messages: [{
              from: "123",
              timestamp: "1640995200",
              text: { body: "Test message" },
              type: "text"
            }]
          }
        }]
      }]
    };

    const sampleLineMessage = {
      events: [{
        type: "message",
        timestamp: 1640995200000,
        source: { type: "user", userId: "user123" },
        message: { type: "text", text: "Test message" }
      }]
    };

    test('should route to WhatsApp parser', () => {
      const result = parseMessage(sampleWhatsAppMessage, 'whatsapp');

      expect(result).not.toBeNull();
      expect(result.platform).toBe('whatsapp');
      expect(result.messageText).toBe('Test message');
    });

    test('should route to LINE parser', () => {
      const result = parseMessage(sampleLineMessage, 'line');

      expect(result).not.toBeNull();
      expect(result.platform).toBe('line');
      expect(result.messageText).toBe('Test message');
    });

    test('should handle unknown platform', () => {
      const result = parseMessage({}, 'unknown');
      expect(result).toBeNull();
    });
  });

  describe('Message Validation', () => {
    test('should validate complete message', () => {
      const validMessage = {
        platform: 'whatsapp',
        senderId: '1234567890',
        senderName: 'John Doe',
        messageText: 'Hello world',
        timestamp: 1640995200
      };

      expect(isValidMessage(validMessage)).toBe(true);
    });

    test('should reject message without platform', () => {
      const invalidMessage = {
        senderId: '1234567890',
        messageText: 'Hello world',
        timestamp: 1640995200
      };

      expect(isValidMessage(invalidMessage)).toBeFalsy();
    });

    test('should reject message without senderId', () => {
      const invalidMessage = {
        platform: 'whatsapp',
        messageText: 'Hello world',
        timestamp: 1640995200
      };

      expect(isValidMessage(invalidMessage)).toBeFalsy();
    });

    test('should reject message without messageText', () => {
      const invalidMessage = {
        platform: 'whatsapp',
        senderId: '1234567890',
        timestamp: 1640995200
      };

      expect(isValidMessage(invalidMessage)).toBeFalsy();
    });

    test('should reject message without timestamp', () => {
      const invalidMessage = {
        platform: 'whatsapp',
        senderId: '1234567890',
        messageText: 'Hello world'
      };

      expect(isValidMessage(invalidMessage)).toBe(false);
    });

    test('should reject message with invalid timestamp type', () => {
      const invalidMessage = {
        platform: 'whatsapp',
        senderId: '1234567890',
        messageText: 'Hello world',
        timestamp: '1640995200' // string instead of number
      };

      expect(isValidMessage(invalidMessage)).toBe(false);
    });

    test('should reject null message', () => {
      expect(isValidMessage(null)).toBeFalsy();
    });

    test('should reject undefined message', () => {
      expect(isValidMessage(undefined)).toBeFalsy();
    });
  });
});