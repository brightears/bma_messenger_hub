import { GoogleAuth } from 'google-auth-library';
import { chat_v1, google } from 'googleapis';
import { config } from '../../config';
import { logger } from '../../utils/logger';

/**
 * Google Chat message types
 */
export interface GoogleChatMessage {
  text: string;
  thread?: {
    name: string;
  };
  cards?: any[];
  cardsV2?: any[];
  attachment?: any[];
}

export interface GoogleChatSendOptions {
  space: 'technical' | 'design' | 'sales';
  threadKey?: string;
  requestId?: string;
}

export interface OutgoingMessage {
  platform: 'whatsapp' | 'line';
  senderId: string;
  senderName?: string;
  content: {
    type: string;
    text?: string;
    mediaUrl?: string;
    location?: {
      latitude: number;
      longitude: number;
      name?: string;
      address?: string;
    };
  };
  timestamp: Date;
  context?: {
    isReply?: boolean;
    replyToMessageId?: string;
    groupId?: string;
    roomId?: string;
  };
}

/**
 * Google Chat Service for sending messages to configured spaces
 */
export class GoogleChatService {
  private auth: GoogleAuth;
  private chatApi: chat_v1.Chat;
  private spaceIds: Record<string, string>;

  constructor() {
    try {
      // Parse the credentials JSON
      const credentials = JSON.parse(config.googleChat.credentialsJson);

      // Initialize authentication
      this.auth = new GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/chat.bot'],
      });

      // Initialize Chat API
      this.chatApi = google.chat({
        version: 'v1',
        auth: this.auth,
      });

      // Map space identifiers to space IDs
      this.spaceIds = {
        technical: config.googleChat.technicalSpace,
        design: config.googleChat.designSpace,
        sales: config.googleChat.salesSpace,
      };

      logger.info('Google Chat service initialized successfully', {
        spacesConfigured: Object.keys(this.spaceIds).length,
      });
    } catch (error) {
      logger.error('Failed to initialize Google Chat service:', error);
      throw error;
    }
  }

  /**
   * Get space ID for a given space name
   */
  private getSpaceId(space: string): string {
    const spaceId = this.spaceIds[space];
    if (!spaceId) {
      throw new Error(`Unknown space: ${space}. Available spaces: ${Object.keys(this.spaceIds).join(', ')}`);
    }
    return spaceId;
  }

  /**
   * Format message from other platforms for Google Chat
   */
  private formatMessageForGoogleChat(message: OutgoingMessage): GoogleChatMessage {
    const platformEmoji = message.platform === 'whatsapp' ? '📱' : '💬';
    const platformName = message.platform === 'whatsapp' ? 'WhatsApp' : 'LINE';

    let formattedText = `${platformEmoji} *${platformName} Message*\n`;
    formattedText += `*From:* ${message.senderName || message.senderId}\n`;
    formattedText += `*Time:* ${message.timestamp.toLocaleString()}\n\n`;

    // Add context information
    if (message.context?.isReply) {
      formattedText += `↪️ *Reply to:* ${message.context.replyToMessageId}\n`;
    }

    if (message.context?.groupId) {
      formattedText += `👥 *Group:* ${message.context.groupId}\n`;
    }

    if (message.context?.roomId) {
      formattedText += `🏠 *Room:* ${message.context.roomId}\n`;
    }

    // Add content based on type
    switch (message.content.type) {
      case 'text':
        formattedText += `💬 ${message.content.text}`;
        break;

      case 'image':
        formattedText += `🖼️ *Image*`;
        if (message.content.mediaUrl) {
          formattedText += `\n📎 ${message.content.mediaUrl}`;
        }
        break;

      case 'video':
        formattedText += `🎥 *Video*`;
        if (message.content.mediaUrl) {
          formattedText += `\n📎 ${message.content.mediaUrl}`;
        }
        break;

      case 'audio':
        formattedText += `🎵 *Audio*`;
        if (message.content.mediaUrl) {
          formattedText += `\n📎 ${message.content.mediaUrl}`;
        }
        break;

      case 'document':
        formattedText += `📄 *Document*`;
        if (message.content.mediaUrl) {
          formattedText += `\n📎 ${message.content.mediaUrl}`;
        }
        break;

      case 'location':
        if (message.content.location) {
          formattedText += `📍 *Location*\n`;
          if (message.content.location.name) {
            formattedText += `📌 ${message.content.location.name}\n`;
          }
          if (message.content.location.address) {
            formattedText += `🏠 ${message.content.location.address}\n`;
          }
          formattedText += `🌐 ${message.content.location.latitude}, ${message.content.location.longitude}`;
        }
        break;

      case 'sticker':
        formattedText += `😀 *Sticker*`;
        if (message.content.text) {
          formattedText += `\n${message.content.text}`;
        }
        break;

      default:
        formattedText += `❓ *${message.content.type}*`;
        if (message.content.text) {
          formattedText += `\n${message.content.text}`;
        }
        break;
    }

    return {
      text: formattedText,
    };
  }

  /**
   * Send a message to a Google Chat space
   */
  async sendMessage(
    message: string | OutgoingMessage,
    options: GoogleChatSendOptions
  ): Promise<chat_v1.Schema$Message | null> {
    try {
      const spaceId = this.getSpaceId(options.space);

      let chatMessage: GoogleChatMessage;

      if (typeof message === 'string') {
        chatMessage = { text: message };
      } else {
        chatMessage = this.formatMessageForGoogleChat(message);
      }

      // Add threading if specified
      if (options.threadKey) {
        chatMessage.thread = {
          name: `spaces/${spaceId}/threads/${options.threadKey}`,
        };
      }

      const requestParams: chat_v1.Params$Resource$Spaces$Messages$Create = {
        parent: `spaces/${spaceId}`,
        requestBody: chatMessage,
      };

      // Add request ID for idempotency if specified
      if (options.requestId) {
        requestParams.requestId = options.requestId;
      }

      logger.info('Sending message to Google Chat space:', {
        space: options.space,
        spaceId,
        hasThread: !!options.threadKey,
        hasRequestId: !!options.requestId,
        messageType: typeof message === 'string' ? 'text' : 'formatted',
        contentLength: chatMessage.text?.length || 0,
      });

      const response = await this.chatApi.spaces.messages.create(requestParams);

      logger.info('Message sent successfully to Google Chat:', {
        space: options.space,
        messageId: response.data.name,
        threadId: response.data.thread?.name,
      });

      return response.data;
    } catch (error) {
      logger.error('Failed to send message to Google Chat:', {
        space: options.space,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  /**
   * Send a message to the technical team space
   */
  async sendToTechnical(
    message: string | OutgoingMessage,
    threadKey?: string,
    requestId?: string
  ): Promise<chat_v1.Schema$Message | null> {
    return this.sendMessage(message, {
      space: 'technical',
      threadKey,
      requestId,
    });
  }

  /**
   * Send a message to the design team space
   */
  async sendToDesign(
    message: string | OutgoingMessage,
    threadKey?: string,
    requestId?: string
  ): Promise<chat_v1.Schema$Message | null> {
    return this.sendMessage(message, {
      space: 'design',
      threadKey,
      requestId,
    });
  }

  /**
   * Send a message to the sales team space
   */
  async sendToSales(
    message: string | OutgoingMessage,
    threadKey?: string,
    requestId?: string
  ): Promise<chat_v1.Schema$Message | null> {
    return this.sendMessage(message, {
      space: 'sales',
      threadKey,
      requestId,
    });
  }

  /**
   * Send a card message with interactive elements
   */
  async sendCardMessage(
    space: 'technical' | 'design' | 'sales',
    title: string,
    subtitle: string,
    sections: Array<{
      header?: string;
      widgets: Array<{
        textParagraph?: { text: string };
        buttonList?: {
          buttons: Array<{
            text: string;
            onClick: {
              action: {
                function: string;
                parameters?: Array<{ key: string; value: string }>;
              };
            };
          }>;
        };
      }>;
    }>,
    threadKey?: string,
    requestId?: string
  ): Promise<chat_v1.Schema$Message | null> {
    try {
      const spaceId = this.getSpaceId(space);

      const cardMessage: GoogleChatMessage = {
        text: `${title}\n${subtitle}`, // Fallback text
        cardsV2: [
          {
            card: {
              header: {
                title,
                subtitle,
              },
              sections,
            },
          },
        ],
      };

      // Add threading if specified
      if (threadKey) {
        cardMessage.thread = {
          name: `spaces/${spaceId}/threads/${threadKey}`,
        };
      }

      const requestParams: chat_v1.Params$Resource$Spaces$Messages$Create = {
        parent: `spaces/${spaceId}`,
        requestBody: cardMessage,
      };

      if (requestId) {
        requestParams.requestId = requestId;
      }

      logger.info('Sending card message to Google Chat space:', {
        space,
        spaceId,
        title,
        sectionsCount: sections.length,
        hasThread: !!threadKey,
        hasRequestId: !!requestId,
      });

      const response = await this.chatApi.spaces.messages.create(requestParams);

      logger.info('Card message sent successfully to Google Chat:', {
        space,
        messageId: response.data.name,
        threadId: response.data.thread?.name,
      });

      return response.data;
    } catch (error) {
      logger.error('Failed to send card message to Google Chat:', {
        space,
        title,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  /**
   * Create a new thread in a space
   */
  async createThread(
    space: 'technical' | 'design' | 'sales',
    initialMessage: string | OutgoingMessage,
    threadKey?: string,
    requestId?: string
  ): Promise<string | null> {
    try {
      const response = await this.sendMessage(initialMessage, {
        space,
        threadKey,
        requestId,
      });

      const threadName = response?.thread?.name;
      if (threadName) {
        // Extract thread key from the full thread name
        const threadId = threadName.split('/').pop();
        logger.info('New thread created:', {
          space,
          threadName,
          threadId,
        });
        return threadId || null;
      }

      return null;
    } catch (error) {
      logger.error('Failed to create thread:', {
        space,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Health check - verify connection to Google Chat API
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Try to list spaces to verify authentication
      await this.chatApi.spaces.list({ pageSize: 1 });
      logger.debug('Google Chat health check passed');
      return true;
    } catch (error) {
      logger.error('Google Chat health check failed:', error);
      return false;
    }
  }

  /**
   * Get space information
   */
  async getSpaceInfo(space: 'technical' | 'design' | 'sales'): Promise<chat_v1.Schema$Space | null> {
    try {
      const spaceId = this.getSpaceId(space);
      const response = await this.chatApi.spaces.get({
        name: `spaces/${spaceId}`,
      });

      logger.info('Retrieved space information:', {
        space,
        spaceId,
        displayName: response.data.displayName,
        type: response.data.type,
        spaceType: response.data.spaceType,
      });

      return response.data;
    } catch (error) {
      logger.error('Failed to get space information:', {
        space,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}

// Export singleton instance
export const googleChatService = new GoogleChatService();