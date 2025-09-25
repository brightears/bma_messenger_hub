/**
 * Message processor to parse incoming messages from different platforms
 * and return them in a standardized format
 */

class MessageProcessor {
  /**
   * Parse WhatsApp webhook message
   * @param {Object} body - WhatsApp webhook body
   * @returns {Object} Standardized message format
   */
  parseWhatsAppMessage(body) {
    try {
      // WhatsApp webhook structure
      if (!body.entry || !Array.isArray(body.entry) || body.entry.length === 0) {
        console.log('No WhatsApp entry found');
        return null;
      }

      const entry = body.entry[0];
      if (!entry.changes || !Array.isArray(entry.changes) || entry.changes.length === 0) {
        console.log('No WhatsApp changes found');
        return null;
      }

      const change = entry.changes[0];
      if (!change.value || !change.value.messages || change.value.messages.length === 0) {
        console.log('No WhatsApp messages found');
        return null;
      }

      const message = change.value.messages[0];
      const contacts = change.value.contacts || [];
      const contact = contacts.find(c => c.wa_id === message.from) || {};

      // Extract message text based on type
      let messageText = '';
      if (message.type === 'text') {
        messageText = message.text.body;
      } else if (message.type === 'image') {
        messageText = `[Image] ${message.image.caption || 'Image sent'}`;
      } else if (message.type === 'document') {
        messageText = `[Document] ${message.document.filename || 'Document sent'}`;
      } else if (message.type === 'audio') {
        messageText = '[Voice message]';
      } else if (message.type === 'video') {
        messageText = `[Video] ${message.video.caption || 'Video sent'}`;
      } else {
        messageText = `[${message.type}] Unsupported message type`;
      }

      return {
        platform: 'whatsapp',
        senderId: message.from,
        senderName: contact.profile?.name || 'Unknown',
        phoneNumber: message.from,
        messageText: messageText,
        timestamp: parseInt(message.timestamp),
        messageType: message.type,
        originalMessage: message
      };

    } catch (error) {
      console.error('Error parsing WhatsApp message:', error);
      return null;
    }
  }

  /**
   * Parse LINE webhook message
   * @param {Object} body - LINE webhook body
   * @returns {Object} Standardized message format
   */
  parseLineMessage(body) {
    try {
      // LINE webhook structure
      if (!body.events || !Array.isArray(body.events) || body.events.length === 0) {
        console.log('No LINE events found');
        return null;
      }

      const event = body.events[0];

      // Only process message events
      if (event.type !== 'message') {
        console.log('LINE event is not a message:', event.type);
        return null;
      }

      let messageText = '';
      if (event.message.type === 'text') {
        messageText = event.message.text;
      } else if (event.message.type === 'image') {
        messageText = '[Image] Image sent';
      } else if (event.message.type === 'video') {
        messageText = '[Video] Video sent';
      } else if (event.message.type === 'audio') {
        messageText = '[Audio] Audio message sent';
      } else if (event.message.type === 'file') {
        messageText = `[File] ${event.message.fileName || 'File sent'}`;
      } else if (event.message.type === 'location') {
        messageText = '[Location] Location shared';
      } else if (event.message.type === 'sticker') {
        messageText = '[Sticker] Sticker sent';
      } else {
        messageText = `[${event.message.type}] Unsupported message type`;
      }

      // Extract source information
      let senderName = 'Unknown';
      let phoneNumber = null;

      if (event.source.type === 'user') {
        senderName = `LINE User`;
      } else if (event.source.type === 'group') {
        senderName = `Group: ${event.source.groupId}`;
      } else if (event.source.type === 'room') {
        senderName = `Room: ${event.source.roomId}`;
      }

      return {
        platform: 'line',
        senderId: event.source.userId || event.source.groupId || event.source.roomId,
        senderName: senderName,
        phoneNumber: phoneNumber,
        messageText: messageText,
        timestamp: Math.floor(event.timestamp / 1000), // Convert to seconds
        messageType: event.message.type,
        originalMessage: event
      };

    } catch (error) {
      console.error('Error parsing LINE message:', error);
      return null;
    }
  }

  /**
   * Generic message parser - detects platform and routes to appropriate parser
   * @param {Object} body - Webhook body
   * @param {string} platform - Platform identifier ('whatsapp' or 'line')
   * @returns {Object} Standardized message format
   */
  parseMessage(body, platform) {
    if (platform === 'whatsapp') {
      return this.parseWhatsAppMessage(body);
    } else if (platform === 'line') {
      return this.parseLineMessage(body);
    } else {
      console.error('Unknown platform:', platform);
      return null;
    }
  }

  /**
   * Validate parsed message
   * @param {Object} message - Parsed message
   * @returns {boolean} Whether message is valid
   */
  isValidMessage(message) {
    return message &&
           message.platform &&
           message.senderId &&
           message.messageText &&
           typeof message.timestamp === 'number';
  }
}

// Export singleton instance
const messageProcessor = new MessageProcessor();

module.exports = {
  messageProcessor,
  parseWhatsAppMessage: (body) => messageProcessor.parseWhatsAppMessage(body),
  parseLineMessage: (body) => messageProcessor.parseLineMessage(body),
  parseMessage: (body, platform) => messageProcessor.parseMessage(body, platform),
  isValidMessage: (message) => messageProcessor.isValidMessage(message)
};