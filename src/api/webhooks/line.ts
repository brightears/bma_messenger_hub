import { Request, Response } from 'express';
import crypto from 'crypto';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import {
  LineWebhookPayload,
  LineWebhookEvent,
  LineMessage,
  ProcessedMessage
} from '../../types/webhooks';
import { webhookTranslationIntegration } from '../../services/translation/webhook-integration';

/**
 * Verify LINE webhook signature
 */
function verifyLineSignature(body: string, signature: string): boolean {
  try {
    const expectedSignature = crypto
      .createHmac('sha256', config.line.channelSecret)
      .update(body, 'utf8')
      .digest('base64');

    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature),
      Buffer.from(signature)
    );
  } catch (error) {
    logger.error('Error verifying LINE signature:', error);
    return false;
  }
}

/**
 * Process incoming LINE message
 */
function processLineMessage(event: LineWebhookEvent): ProcessedMessage | null {
  try {
    if (!event.message || event.type !== 'message') {
      return null;
    }

    const message = event.message;
    const processedMessage: ProcessedMessage = {
      platform: 'line',
      messageId: message.id,
      senderId: event.source.userId || event.source.groupId || event.source.roomId || 'unknown',
      content: {
        type: message.type,
      },
      timestamp: new Date(event.timestamp),
      context: {},
    };

    // Add context information
    if (event.source.groupId) {
      processedMessage.context!.groupId = event.source.groupId;
    }
    if (event.source.roomId) {
      processedMessage.context!.roomId = event.source.roomId;
    }

    // Handle different message types
    switch (message.type) {
      case 'text':
        processedMessage.content.text = message.text;
        break;

      case 'image':
      case 'video':
      case 'audio':
      case 'file':
        if (message.contentProvider) {
          processedMessage.content.mediaUrl = message.contentProvider.originalContentUrl;
        }
        break;

      case 'location':
        processedMessage.content.location = {
          latitude: message.latitude!,
          longitude: message.longitude!,
          name: message.title,
          address: message.address,
        };
        break;

      case 'sticker':
        processedMessage.content.text = `Sticker: ${message.packageId}/${message.stickerId}`;
        break;

      default:
        logger.warn(`Unsupported LINE message type: ${message.type}`);
        return null;
    }

    // Handle quoted messages (replies)
    if (message.quotedMessageId) {
      processedMessage.context!.isReply = true;
      processedMessage.context!.replyToMessageId = message.quotedMessageId;
    }

    return processedMessage;
  } catch (error) {
    logger.error('Error processing LINE message:', error);
    return null;
  }
}

/**
 * Process LINE follow event
 */
function processLineFollow(event: LineWebhookEvent): void {
  logger.info('LINE follow event:', {
    userId: event.source.userId,
    timestamp: new Date(event.timestamp).toISOString(),
  });

  // TODO: Handle new follower
  // Example: Send welcome message, add to database, etc.
}

/**
 * Process LINE unfollow event
 */
function processLineUnfollow(event: LineWebhookEvent): void {
  logger.info('LINE unfollow event:', {
    userId: event.source.userId,
    timestamp: new Date(event.timestamp).toISOString(),
  });

  // TODO: Handle unfollower
  // Example: Remove from active conversations, update database, etc.
}

/**
 * Process LINE postback event
 */
function processLinePostback(event: LineWebhookEvent): void {
  if (!event.postback) {
    return;
  }

  logger.info('LINE postback event:', {
    userId: event.source.userId,
    data: event.postback.data,
    params: event.postback.params,
    timestamp: new Date(event.timestamp).toISOString(),
  });

  // TODO: Handle postback actions
  // Example: Process button clicks, menu selections, etc.
}

/**
 * Process LINE join/leave events
 */
function processLineGroupEvent(event: LineWebhookEvent): void {
  const eventType = event.type;
  const context = event.source.groupId ? 'group' : 'room';
  const contextId = event.source.groupId || event.source.roomId;

  logger.info(`LINE ${eventType} event:`, {
    eventType,
    context,
    contextId,
    userId: event.source.userId,
    timestamp: new Date(event.timestamp).toISOString(),
  });

  // TODO: Handle group/room events
  // Example: Send welcome/goodbye messages, update member lists, etc.
}

/**
 * Handle LINE webhook events
 */
export function handleLineWebhook(req: Request, res: Response): void {
  try {
    const signature = req.get('X-Line-Signature');
    const body = JSON.stringify(req.body);

    // Verify signature
    if (!signature) {
      logger.warn('LINE webhook missing signature');
      res.sendStatus(403);
      return;
    }

    if (!verifyLineSignature(body, signature)) {
      logger.warn('LINE webhook signature verification failed', {
        signature: signature ? '***' : undefined,
        bodyLength: body.length,
      });
      res.sendStatus(403);
      return;
    }

    const webhookData: LineWebhookPayload = req.body;

    logger.info('LINE webhook received:', {
      destination: webhookData.destination,
      eventsCount: webhookData.events?.length || 0,
    });

    // Process each event
    webhookData.events?.forEach((event) => {
      logger.debug('Processing LINE event:', {
        eventType: event.type,
        webhookEventId: event.webhookEventId,
        sourceType: event.source.type,
        timestamp: new Date(event.timestamp).toISOString(),
        isRedelivery: event.deliveryContext.isRedelivery,
      });

      // Handle different event types
      switch (event.type) {
        case 'message':
          const processedMessage = processLineMessage(event);
          if (processedMessage) {
            logger.info('LINE message processed successfully:', {
              messageId: processedMessage.messageId,
              contentType: processedMessage.content.type,
              hasText: !!processedMessage.content.text,
              isReply: processedMessage.context?.isReply,
              isGroup: !!processedMessage.context?.groupId,
              isRoom: !!processedMessage.context?.roomId,
            });

            // Process message with translation service
            (async () => {
              try {
                const translatedMessage = await webhookTranslationIntegration.processLineMessage(processedMessage);

                if (translatedMessage) {
                  logger.info('LINE message translation integrated:', {
                    messageId: processedMessage.messageId,
                    originalLanguage: translatedMessage.originalLanguage,
                    targetLanguage: translatedMessage.targetLanguage,
                    confidence: translatedMessage.confidence,
                    formattedMessage: translatedMessage.formattedForDisplay.substring(0, 100) + '...',
                  });

                  // TODO: Forward translated message to other platforms (Google Chat, WhatsApp)
                  // Example: await forwardToGoogleChat(translatedMessage);
                  // Example: await forwardToWhatsApp(translatedMessage);
                }
              } catch (translationError) {
                logger.error('LINE message translation failed:', {
                  messageId: processedMessage.messageId,
                  error: translationError instanceof Error ? translationError.message : String(translationError),
                });
              }
            })();

            // TODO: Send to message queue or AI processing pipeline
            // Example: await messageQueue.add('process-message', processedMessage);
          }
          break;

        case 'follow':
          processLineFollow(event);
          break;

        case 'unfollow':
          processLineUnfollow(event);
          break;

        case 'postback':
          processLinePostback(event);
          break;

        case 'join':
        case 'leave':
        case 'memberJoined':
        case 'memberLeft':
          processLineGroupEvent(event);
          break;

        case 'videoPlayComplete':
          logger.info('LINE video play complete event:', {
            userId: event.source.userId,
            timestamp: new Date(event.timestamp).toISOString(),
          });
          break;

        case 'beacon':
          logger.info('LINE beacon event:', {
            userId: event.source.userId,
            beacon: event.beacon,
            timestamp: new Date(event.timestamp).toISOString(),
          });
          break;

        case 'accountLink':
          logger.info('LINE account link event:', {
            userId: event.source.userId,
            link: event.link,
            timestamp: new Date(event.timestamp).toISOString(),
          });
          break;

        case 'things':
          logger.info('LINE Things event:', {
            userId: event.source.userId,
            things: event.things,
            timestamp: new Date(event.timestamp).toISOString(),
          });
          break;

        default:
          logger.warn(`Unsupported LINE event type: ${event.type}`);
          break;
      }
    });

    // Always respond with 200 to acknowledge receipt
    res.sendStatus(200);
  } catch (error) {
    logger.error('Error handling LINE webhook:', error);
    res.sendStatus(500);
  }
}