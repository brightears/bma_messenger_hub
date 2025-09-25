import axios from 'axios';
import { config } from '../../config';
import { logger } from '../../utils/logger';

export interface LINEMessage {
  type: 'text' | 'image' | 'video' | 'audio' | 'file' | 'location' | 'sticker';
  text?: string;
  originalContentUrl?: string;
  previewImageUrl?: string;
}

export class LINESender {
  private readonly apiUrl: string;
  private readonly channelAccessToken: string;

  constructor() {
    this.apiUrl = config.line.apiUrl;
    this.channelAccessToken = config.line.channelAccessToken;
  }

  /**
   * Send reply message to LINE user
   */
  public async sendReplyMessage(
    replyToken: string,
    message: string
  ): Promise<boolean> {
    try {
      const url = `${this.apiUrl}/bot/message/reply`;

      const payload = {
        replyToken,
        messages: [{
          type: 'text',
          text: message
        }]
      };

      await axios.post(url, payload, {
        headers: {
          'Authorization': `Bearer ${this.channelAccessToken}`,
          'Content-Type': 'application/json'
        }
      });

      logger.info('LINE reply message sent successfully', {
        replyToken: replyToken.substring(0, 10) + '...'
      });

      return true;
    } catch (error) {
      logger.error('Failed to send LINE reply message', {
        error,
        replyToken
      });
      return false;
    }
  }

  /**
   * Send push message to LINE user
   */
  public async sendPushMessage(
    userId: string,
    message: string
  ): Promise<boolean> {
    try {
      const url = `${this.apiUrl}/bot/message/push`;

      const payload = {
        to: userId,
        messages: [{
          type: 'text',
          text: message
        }]
      };

      await axios.post(url, payload, {
        headers: {
          'Authorization': `Bearer ${this.channelAccessToken}`,
          'Content-Type': 'application/json'
        }
      });

      logger.info('LINE push message sent successfully', { userId });

      return true;
    } catch (error) {
      logger.error('Failed to send LINE push message', {
        error,
        userId
      });
      return false;
    }
  }

  /**
   * Send multicast message to multiple LINE users
   */
  public async sendMulticastMessage(
    userIds: string[],
    message: string
  ): Promise<boolean> {
    try {
      const url = `${this.apiUrl}/bot/message/multicast`;

      const payload = {
        to: userIds,
        messages: [{
          type: 'text',
          text: message
        }]
      };

      await axios.post(url, payload, {
        headers: {
          'Authorization': `Bearer ${this.channelAccessToken}`,
          'Content-Type': 'application/json'
        }
      });

      logger.info('LINE multicast message sent successfully', {
        userCount: userIds.length
      });

      return true;
    } catch (error) {
      logger.error('Failed to send LINE multicast message', {
        error,
        userCount: userIds.length
      });
      return false;
    }
  }

  /**
   * Get user profile
   */
  public async getUserProfile(userId: string): Promise<any> {
    try {
      const url = `${this.apiUrl}/bot/profile/${userId}`;

      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${this.channelAccessToken}`
        }
      });

      return response.data;
    } catch (error) {
      logger.error('Failed to get LINE user profile', { error, userId });
      return null;
    }
  }
}