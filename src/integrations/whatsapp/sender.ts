import axios from 'axios';
import { config } from '../../config';
import { logger } from '../../utils/logger';

export interface WhatsAppMessage {
  to: string;
  text?: {
    body: string;
  };
  type?: 'text' | 'image' | 'document' | 'audio' | 'video';
}

export class WhatsAppSender {
  private readonly apiUrl: string;
  private readonly accessToken: string;
  private readonly phoneNumberId: string;

  constructor() {
    this.apiUrl = config.whatsApp.apiUrl;
    this.accessToken = config.whatsApp.accessToken;
    this.phoneNumberId = config.whatsApp.phoneNumberId;
  }

  /**
   * Send text message to WhatsApp user
   */
  public async sendTextMessage(to: string, message: string): Promise<boolean> {
    try {
      const url = `${this.apiUrl}/${this.phoneNumberId}/messages`;

      const payload: WhatsAppMessage = {
        to: to.replace('+', ''), // Remove + if present
        text: {
          body: message
        },
        type: 'text'
      };

      const response = await axios.post(url, payload, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      logger.info('WhatsApp message sent successfully', {
        to,
        messageId: response.data.messages?.[0]?.id
      });

      return true;
    } catch (error) {
      logger.error('Failed to send WhatsApp message', {
        error,
        to,
        message: message.substring(0, 100)
      });
      return false;
    }
  }

  /**
   * Send typing indicator
   */
  public async sendTypingIndicator(to: string): Promise<void> {
    try {
      const url = `${this.apiUrl}/${this.phoneNumberId}/messages`;

      await axios.post(url, {
        to: to.replace('+', ''),
        typing: 'on'
      }, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        }
      });
    } catch (error) {
      logger.warn('Failed to send typing indicator', { error, to });
    }
  }

  /**
   * Mark message as read
   */
  public async markAsRead(messageId: string): Promise<void> {
    try {
      const url = `${this.apiUrl}/${this.phoneNumberId}/messages`;

      await axios.post(url, {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId
      }, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        }
      });
    } catch (error) {
      logger.warn('Failed to mark message as read', { error, messageId });
    }
  }
}