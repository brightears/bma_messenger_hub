import { Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { config } from '../../config';
import { webhookTranslationIntegration } from '../../services/translation/webhook-integration';

/**
 * Google Chat webhook event types
 */
export interface GoogleChatWebhookEvent {
  type: 'ADDED_TO_SPACE' | 'REMOVED_FROM_SPACE' | 'MESSAGE' | 'CARD_CLICKED';
  eventTime: string;
  space: {
    name: string;
    type: 'ROOM' | 'DM';
    singleUserBotDm?: boolean;
    displayName?: string;
  };
  user: {
    name: string;
    displayName: string;
    email?: string;
    avatarUrl?: string;
    type: 'HUMAN' | 'BOT';
  };
  message?: {
    name: string;
    text: string;
    argumentText: string;
    createTime: string;
    sender: {
      name: string;
      displayName: string;
      email?: string;
      type: 'HUMAN' | 'BOT';
    };
    thread?: {
      name: string;
      retentionSettings?: {
        state: string;
      };
    };
    space: {
      name: string;
      type: 'ROOM' | 'DM';
      displayName?: string;
    };
    annotations?: Array<{
      type: 'USER_MENTION' | 'SLASH_COMMAND';
      startIndex?: number;
      length?: number;
      userMention?: {
        user: {
          name: string;
          displayName: string;
          type: 'HUMAN' | 'BOT';
        };
        type: 'MENTION' | 'ADD';
      };
      slashCommand?: {
        bot: {
          name: string;
          displayName: string;
          type: 'BOT';
        };
        type: 'ADD' | 'INVOKE';
        commandName: string;
        commandId?: string;
      };
    }>;
    attachment?: Array<{
      name: string;
      contentName: string;
      contentType: string;
      attachmentDataRef?: {
        resourceName: string;
        attachmentUploadToken: string;
      };
      driveDataRef?: {
        driveFileId: string;
      };
    }>;
  };
  action?: {
    actionMethodName: string;
    parameters?: Array<{
      key: string;
      value: string;
    }>;
  };
  configCompleteRedirectUrl?: string;
}

/**
 * Processed Google Chat message for forwarding to other platforms
 */
export interface ProcessedGoogleChatMessage {
  messageId: string;
  spaceName: string;
  spaceDisplayName?: string;
  spaceType: 'technical' | 'design' | 'sales' | 'unknown';
  senderId: string;
  senderName: string;
  senderEmail?: string;
  content: {
    type: 'text' | 'attachment' | 'slash_command';
    text?: string;
    commandName?: string;
    attachments?: Array<{
      name: string;
      contentName: string;
      contentType: string;
      resourceName?: string;
    }>;
  };
  timestamp: Date;
  threadName?: string;
  isDirectMessage: boolean;
  mentions?: Array<{
    type: 'USER_MENTION';
    displayName: string;
    userId: string;
  }>;
}

/**
 * Map space ID to space type
 */
function getSpaceType(spaceId: string): 'technical' | 'design' | 'sales' | 'unknown' {
  const spaceName = spaceId.replace('spaces/', '');

  if (spaceName === config.googleChat.technicalSpace.replace('spaces/', '')) {
    return 'technical';
  } else if (spaceName === config.googleChat.designSpace.replace('spaces/', '')) {
    return 'design';
  } else if (spaceName === config.googleChat.salesSpace.replace('spaces/', '')) {
    return 'sales';
  }

  return 'unknown';
}

/**
 * Process incoming Google Chat message
 */
function processGoogleChatMessage(event: GoogleChatWebhookEvent): ProcessedGoogleChatMessage | null {
  try {
    if (!event.message) {
      return null;
    }

    const message = event.message;
    const spaceType = getSpaceType(message.space.name);

    const processedMessage: ProcessedGoogleChatMessage = {
      messageId: message.name,
      spaceName: message.space.name,
      spaceDisplayName: message.space.displayName,
      spaceType,
      senderId: message.sender.name,
      senderName: message.sender.displayName,
      senderEmail: message.sender.email,
      content: {
        type: 'text',
      },
      timestamp: new Date(message.createTime),
      threadName: message.thread?.name,
      isDirectMessage: message.space.type === 'DM',
    };

    // Process message content
    if (message.text) {
      processedMessage.content.text = message.text.trim();
    }

    // Process attachments
    if (message.attachment && message.attachment.length > 0) {
      processedMessage.content.type = 'attachment';
      processedMessage.content.attachments = message.attachment.map(att => ({
        name: att.name,
        contentName: att.contentName,
        contentType: att.contentType,
        resourceName: att.attachmentDataRef?.resourceName,
      }));
    }

    // Process annotations (mentions, slash commands)
    if (message.annotations && message.annotations.length > 0) {
      processedMessage.mentions = [];

      for (const annotation of message.annotations) {
        if (annotation.type === 'USER_MENTION' && annotation.userMention) {
          processedMessage.mentions.push({
            type: 'USER_MENTION',
            displayName: annotation.userMention.user.displayName,
            userId: annotation.userMention.user.name,
          });
        } else if (annotation.type === 'SLASH_COMMAND' && annotation.slashCommand) {
          processedMessage.content.type = 'slash_command';
          processedMessage.content.commandName = annotation.slashCommand.commandName;
        }
      }

      if (processedMessage.mentions.length === 0) {
        delete processedMessage.mentions;
      }
    }

    return processedMessage;
  } catch (error) {
    logger.error('Error processing Google Chat message:', error);
    return null;
  }
}

/**
 * Process Google Chat space events (bot added/removed)
 */
function processSpaceEvent(event: GoogleChatWebhookEvent): void {
  const eventType = event.type;
  const spaceType = getSpaceType(event.space.name);

  logger.info(`Google Chat ${eventType} event:`, {
    eventType,
    spaceName: event.space.name,
    spaceDisplayName: event.space.displayName,
    spaceType,
    userDisplayName: event.user.displayName,
    userEmail: event.user.email,
    timestamp: new Date(event.eventTime).toISOString(),
  });

  // Handle specific space events
  switch (eventType) {
    case 'ADDED_TO_SPACE':
      logger.info('Bot was added to Google Chat space:', {
        spaceType,
        spaceName: event.space.displayName || event.space.name,
        addedBy: event.user.displayName,
      });
      // TODO: Send welcome message or perform setup
      break;

    case 'REMOVED_FROM_SPACE':
      logger.info('Bot was removed from Google Chat space:', {
        spaceType,
        spaceName: event.space.displayName || event.space.name,
        removedBy: event.user.displayName,
      });
      // TODO: Clean up any space-specific data
      break;
  }
}

/**
 * Process Google Chat card click events
 */
function processCardClickEvent(event: GoogleChatWebhookEvent): void {
  if (!event.action) {
    return;
  }

  const spaceType = getSpaceType(event.space.name);

  logger.info('Google Chat card click event:', {
    spaceName: event.space.name,
    spaceType,
    actionMethod: event.action.actionMethodName,
    parameters: event.action.parameters,
    userDisplayName: event.user.displayName,
    timestamp: new Date(event.eventTime).toISOString(),
  });

  // TODO: Handle card interactions
  // Example: Process button clicks, form submissions, etc.
}

/**
 * Verify Google Chat webhook request
 * Note: Google Chat uses bearer tokens for verification, not HMAC signatures
 */
function verifyGoogleChatWebhook(req: Request): boolean {
  try {
    const authHeader = req.get('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn('Google Chat webhook missing or invalid authorization header');
      return false;
    }

    // TODO: Implement proper token verification if needed
    // For now, we'll just check if the header exists
    // In production, you might want to verify the JWT token

    return true;
  } catch (error) {
    logger.error('Error verifying Google Chat webhook:', error);
    return false;
  }
}

/**
 * Handle Google Chat webhook events
 */
export function handleGoogleChatWebhook(req: Request, res: Response): void {
  try {
    // Verify the webhook request
    if (!verifyGoogleChatWebhook(req)) {
      logger.warn('Google Chat webhook verification failed');
      res.sendStatus(403);
      return;
    }

    const event: GoogleChatWebhookEvent = req.body;

    logger.info('Google Chat webhook received:', {
      type: event.type,
      spaceName: event.space.name,
      spaceDisplayName: event.space.displayName,
      userDisplayName: event.user.displayName,
      eventTime: event.eventTime,
    });

    // Handle different event types
    switch (event.type) {
      case 'MESSAGE':
        const processedMessage = processGoogleChatMessage(event);
        if (processedMessage) {
          logger.info('Google Chat message processed successfully:', {
            messageId: processedMessage.messageId,
            spaceType: processedMessage.spaceType,
            senderName: processedMessage.senderName,
            contentType: processedMessage.content.type,
            hasText: !!processedMessage.content.text,
            isDirectMessage: processedMessage.isDirectMessage,
            hasThread: !!processedMessage.threadName,
            hasMentions: !!processedMessage.mentions?.length,
          });

          // Process message with translation service
          (async () => {
            try {
              const translatedMessage = await webhookTranslationIntegration.processGoogleChatMessage(processedMessage);

              if (translatedMessage) {
                logger.info('Google Chat message translation integrated:', {
                  messageId: processedMessage.messageId,
                  spaceType: processedMessage.spaceType,
                  originalLanguage: translatedMessage.originalLanguage,
                  targetLanguage: translatedMessage.targetLanguage,
                  confidence: translatedMessage.confidence,
                  formattedMessage: translatedMessage.formattedForDisplay.substring(0, 100) + '...',
                });

                // TODO: Forward translated message to appropriate platforms (WhatsApp/LINE)
                // Example: await forwardToWhatsApp(translatedMessage);
                // Example: await forwardToLine(translatedMessage);
              }
            } catch (translationError) {
              logger.error('Google Chat message translation failed:', {
                messageId: processedMessage.messageId,
                spaceType: processedMessage.spaceType,
                error: translationError instanceof Error ? translationError.message : String(translationError),
              });
            }
          })();

          // TODO: Forward message to appropriate platforms (WhatsApp/LINE)
          // This would typically involve:
          // 1. Determining which platform(s) to forward to based on space type
          // 2. Formatting the message for the target platform
          // 3. Sending via the appropriate service (WhatsApp/LINE API)
          // Example: await forwardMessageToPlatforms(processedMessage);
        }
        break;

      case 'ADDED_TO_SPACE':
      case 'REMOVED_FROM_SPACE':
        processSpaceEvent(event);
        break;

      case 'CARD_CLICKED':
        processCardClickEvent(event);
        break;

      default:
        logger.warn(`Unsupported Google Chat event type: ${event.type}`);
        break;
    }

    // Respond with 200 to acknowledge receipt
    res.status(200).json({ success: true });
  } catch (error) {
    logger.error('Error handling Google Chat webhook:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: config.nodeEnv === 'development' ? (error as Error).message : 'Something went wrong',
    });
  }
}

/**
 * Example function to forward Google Chat messages to other platforms
 * This would be implemented based on your specific business logic
 */
export async function forwardMessageToPlatforms(message: ProcessedGoogleChatMessage): Promise<void> {
  try {
    logger.info('Forwarding Google Chat message to other platforms:', {
      messageId: message.messageId,
      spaceType: message.spaceType,
      contentType: message.content.type,
    });

    // Example routing logic based on space type
    switch (message.spaceType) {
      case 'technical':
        // Forward technical discussions to specific WhatsApp/LINE groups
        // await whatsappService.sendMessage(technicalGroupId, formatMessageForWhatsApp(message));
        // await lineService.sendMessage(technicalGroupId, formatMessageForLine(message));
        break;

      case 'design':
        // Forward design discussions
        // await whatsappService.sendMessage(designGroupId, formatMessageForWhatsApp(message));
        break;

      case 'sales':
        // Forward sales discussions
        // await lineService.sendMessage(salesGroupId, formatMessageForLine(message));
        break;

      default:
        logger.warn('Unknown space type, not forwarding message:', {
          spaceType: message.spaceType,
          messageId: message.messageId,
        });
        break;
    }
  } catch (error) {
    logger.error('Error forwarding message to platforms:', {
      messageId: message.messageId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}