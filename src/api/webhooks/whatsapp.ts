import { Request, Response } from 'express';
import crypto from 'crypto';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import {
  WhatsAppWebhookPayload,
  WhatsAppMessage,
  WhatsAppStatus,
  ProcessedMessage
} from '../../types/webhooks';
import { webhookTranslationIntegration } from '../../services/translation/webhook-integration';

/**
 * Verify WhatsApp webhook signature
 */
function verifyWhatsAppSignature(payload: string, signature: string): boolean {
  try {
    const expectedSignature = crypto
      .createHmac('sha256', config.whatsApp.webhookSecret)
      .update(payload, 'utf8')
      .digest('hex');

    const receivedSignature = signature.replace('sha256=', '');

    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'hex'),
      Buffer.from(receivedSignature, 'hex')
    );
  } catch (error) {
    logger.error('Error verifying WhatsApp signature:', error);
    return false;
  }
}

/**
 * Handle WhatsApp webhook verification challenge
 */
export function verifyWhatsAppWebhook(req: Request, res: Response): void {
  try {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    logger.info('WhatsApp webhook verification request received', {
      mode,
      token: token ? '***' : undefined,
      challenge: challenge ? '***' : undefined,
    });

    // Check if a token and mode were sent
    if (mode && token) {
      // Check the mode and token sent are correct
      if (mode === 'subscribe' && token === config.whatsApp.verifyToken) {
        logger.info('WhatsApp webhook verified successfully');
        res.status(200).send(challenge);
        return;
      } else {
        logger.warn('WhatsApp webhook verification failed: invalid token or mode', {
          expectedMode: 'subscribe',
          receivedMode: mode,
          tokenMatch: token === config.whatsApp.verifyToken,
        });
        res.sendStatus(403);
        return;
      }
    }

    logger.warn('WhatsApp webhook verification failed: missing parameters');
    res.sendStatus(403);
  } catch (error) {
    logger.error('Error in WhatsApp webhook verification:', error);
    res.sendStatus(500);
  }
}

/**
 * Process incoming WhatsApp message
 */
function processWhatsAppMessage(message: WhatsAppMessage, phoneNumberId: string): ProcessedMessage | null {
  try {
    const processedMessage: ProcessedMessage = {
      platform: 'whatsapp',
      messageId: message.id,
      senderId: message.from,
      content: {
        type: message.type,
      },
      timestamp: new Date(parseInt(message.timestamp) * 1000),
      context: {},
    };

    // Handle different message types
    switch (message.type) {
      case 'text':
        if (message.text) {
          processedMessage.content.text = message.text.body;
        }
        break;

      case 'image':
      case 'document':
      case 'audio':
      case 'video':
        if (message[message.type]) {
          processedMessage.content.mediaUrl = `${config.whatsApp.apiUrl}/${message[message.type]!.id}`;
        }
        break;

      case 'location':
        if (message.location) {
          processedMessage.content.location = {
            latitude: message.location.latitude,
            longitude: message.location.longitude,
            name: message.location.name,
            address: message.location.address,
          };
        }
        break;

      case 'interactive':
      case 'button':
        // Handle interactive messages and button responses
        processedMessage.content.text = message.interactive?.type || message.button?.text || 'Interactive message';
        break;

      default:
        logger.warn(`Unsupported WhatsApp message type: ${message.type}`);
        return null;
    }

    // Handle context (replies)
    if (message.context) {
      processedMessage.context = {
        isReply: true,
        replyToMessageId: message.context.id,
      };
    }

    return processedMessage;
  } catch (error) {
    logger.error('Error processing WhatsApp message:', error);
    return null;
  }
}

/**
 * Process WhatsApp status update
 */
function processWhatsAppStatus(status: WhatsAppStatus): void {
  logger.info('WhatsApp message status update:', {
    messageId: status.id,
    status: status.status,
    recipientId: status.recipient_id,
    timestamp: new Date(parseInt(status.timestamp) * 1000).toISOString(),
    errors: status.errors,
  });

  // Handle different statuses
  switch (status.status) {
    case 'sent':
      logger.debug(`Message ${status.id} sent successfully`);
      break;
    case 'delivered':
      logger.debug(`Message ${status.id} delivered to ${status.recipient_id}`);
      break;
    case 'read':
      logger.debug(`Message ${status.id} read by ${status.recipient_id}`);
      break;
    case 'failed':
      logger.error(`Message ${status.id} failed to deliver:`, status.errors);
      break;
  }
}

/**
 * Handle WhatsApp webhook events
 */
export function handleWhatsAppWebhook(req: Request, res: Response): void {
  try {
    const signature = req.get('X-Hub-Signature-256');
    const payload = JSON.stringify(req.body);

    // Verify signature if provided
    if (signature && !verifyWhatsAppSignature(payload, signature)) {
      logger.warn('WhatsApp webhook signature verification failed', {
        signature: signature ? '***' : undefined,
        payloadLength: payload.length,
      });
      res.sendStatus(403);
      return;
    }

    const webhookData: WhatsAppWebhookPayload = req.body;

    logger.info('WhatsApp webhook received:', {
      object: webhookData.object,
      entriesCount: webhookData.entry?.length || 0,
    });

    // Validate webhook object type
    if (webhookData.object !== 'whatsapp_business_account') {
      logger.warn(`Unexpected WhatsApp webhook object type: ${webhookData.object}`);
      res.sendStatus(400);
      return;
    }

    // Process each entry
    webhookData.entry?.forEach((entry) => {
      entry.changes?.forEach((change) => {
        if (change.field === 'messages') {
          const { value } = change;

          // Process incoming messages
          value.messages?.forEach((message) => {
            logger.info('Processing WhatsApp message:', {
              messageId: message.id,
              from: message.from,
              type: message.type,
              timestamp: new Date(parseInt(message.timestamp) * 1000).toISOString(),
            });

            const processedMessage = processWhatsAppMessage(message, value.metadata.phone_number_id);
            if (processedMessage) {
              logger.info('WhatsApp message processed successfully:', {
                messageId: processedMessage.messageId,
                contentType: processedMessage.content.type,
                hasText: !!processedMessage.content.text,
                isReply: processedMessage.context?.isReply,
              });

              // Process message with translation service
              try {
                const translatedMessage = await webhookTranslationIntegration.processWhatsAppMessage(processedMessage);

                if (translatedMessage) {
                  logger.info('WhatsApp message translation integrated:', {
                    messageId: processedMessage.messageId,
                    originalLanguage: translatedMessage.originalLanguage,
                    targetLanguage: translatedMessage.targetLanguage,
                    confidence: translatedMessage.confidence,
                    formattedMessage: translatedMessage.formattedForDisplay.substring(0, 100) + '...',
                  });

                  // TODO: Forward translated message to other platforms (Google Chat, LINE)
                  // Example: await forwardToGoogleChat(translatedMessage);
                  // Example: await forwardToLine(translatedMessage);
                }
              } catch (translationError) {
                logger.error('WhatsApp message translation failed:', {
                  messageId: processedMessage.messageId,
                  error: translationError instanceof Error ? translationError.message : String(translationError),
                });
              }

              // TODO: Send to message queue or AI processing pipeline
              // Example: await messageQueue.add('process-message', processedMessage);
            }
          });

          // Process message statuses
          value.statuses?.forEach((status) => {
            processWhatsAppStatus(status);
          });
        }
      });
    });

    // Always respond with 200 to acknowledge receipt
    res.sendStatus(200);
  } catch (error) {
    logger.error('Error handling WhatsApp webhook:', error);
    res.sendStatus(500);
  }
}