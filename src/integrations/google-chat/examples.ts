import { googleChatService } from './index';
import { ProcessedMessage } from '../../types/webhooks';
import { generateThreadKey } from './helpers';
import { logger } from '../../utils/logger';

/**
 * Example: Route messages from WhatsApp/LINE to appropriate Google Chat spaces
 * This shows how you might integrate the Google Chat service with your message processing
 */
export async function routeMessageToGoogleChat(
  message: ProcessedMessage,
  senderName?: string
): Promise<void> {
  try {
    // Determine which space(s) to send to based on message content or business logic
    const spaces = determineTargetSpaces(message);

    if (spaces.length === 0) {
      logger.info('No Google Chat spaces determined for message, skipping', {
        platform: message.platform,
        messageId: message.messageId,
        contentType: message.content.type,
      });
      return;
    }

    // Generate a thread key for conversation threading
    const threadKey = generateThreadKey(
      message.platform,
      message.senderId,
      message.context?.groupId || message.context?.roomId
    );

    // Send to each determined space
    for (const space of spaces) {
      try {
        const result = await googleChatService.sendMessage(message, {
          space,
          threadKey,
          requestId: `${message.platform}-${message.messageId}-${space}`,
        });

        logger.info('Message sent to Google Chat space:', {
          platform: message.platform,
          messageId: message.messageId,
          space,
          googleChatMessageId: result?.name,
          threadId: result?.thread?.name,
        });
      } catch (error) {
        logger.error(`Failed to send message to Google Chat space ${space}:`, {
          platform: message.platform,
          messageId: message.messageId,
          space,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    logger.error('Error routing message to Google Chat:', {
      platform: message.platform,
      messageId: message.messageId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Determine which Google Chat spaces to send a message to
 * This is where you'd implement your business logic for routing
 */
function determineTargetSpaces(message: ProcessedMessage): Array<'technical' | 'design' | 'sales'> {
  const spaces: Array<'technical' | 'design' | 'sales'> = [];

  // Example routing logic based on message content
  const messageText = message.content.text?.toLowerCase() || '';

  // Technical keywords
  if (messageText.includes('bug') ||
      messageText.includes('error') ||
      messageText.includes('api') ||
      messageText.includes('server') ||
      messageText.includes('database') ||
      messageText.includes('technical') ||
      messageText.includes('code') ||
      messageText.includes('development')) {
    spaces.push('technical');
  }

  // Design keywords
  if (messageText.includes('design') ||
      messageText.includes('ui') ||
      messageText.includes('ux') ||
      messageText.includes('interface') ||
      messageText.includes('mockup') ||
      messageText.includes('wireframe') ||
      messageText.includes('prototype') ||
      messageText.includes('branding')) {
    spaces.push('design');
  }

  // Sales keywords
  if (messageText.includes('price') ||
      messageText.includes('quote') ||
      messageText.includes('proposal') ||
      messageText.includes('contract') ||
      messageText.includes('client') ||
      messageText.includes('customer') ||
      messageText.includes('sales') ||
      messageText.includes('revenue') ||
      messageText.includes('deal')) {
    spaces.push('sales');
  }

  // Media messages might be relevant to design team
  if (message.content.type === 'image' || message.content.type === 'video') {
    if (!spaces.includes('design')) {
      spaces.push('design');
    }
  }

  // Location messages might be relevant to sales team
  if (message.content.type === 'location') {
    if (!spaces.includes('sales')) {
      spaces.push('sales');
    }
  }

  // If no specific routing is determined, route to technical by default
  if (spaces.length === 0) {
    spaces.push('technical');
  }

  return spaces;
}

/**
 * Example: Send a notification about platform status
 */
export async function sendPlatformStatusNotification(
  platform: 'whatsapp' | 'line',
  status: 'online' | 'offline' | 'error',
  details?: {
    errorMessage?: string;
    lastSuccessfulMessage?: Date;
    affectedUsers?: number;
  }
): Promise<void> {
  try {
    const platformName = platform === 'whatsapp' ? 'WhatsApp' : 'LINE';
    const statusEmoji = status === 'online' ? '✅' : status === 'offline' ? '🔴' : '⚠️';

    let message = `${statusEmoji} **${platformName} Status Update**\n`;
    message += `Status: ${status.toUpperCase()}\n`;
    message += `Time: ${new Date().toLocaleString()}\n`;

    if (details?.errorMessage) {
      message += `Error: ${details.errorMessage}\n`;
    }

    if (details?.lastSuccessfulMessage) {
      message += `Last Success: ${details.lastSuccessfulMessage.toLocaleString()}\n`;
    }

    if (details?.affectedUsers) {
      message += `Affected Users: ${details.affectedUsers}\n`;
    }

    // Send to technical team for all status updates
    await googleChatService.sendToTechnical(message);

    // Send to sales team if it affects customer interactions
    if (status !== 'online' && details?.affectedUsers && details.affectedUsers > 0) {
      await googleChatService.sendToSales(message);
    }

    logger.info('Platform status notification sent to Google Chat:', {
      platform,
      status,
      hasError: !!details?.errorMessage,
      affectedUsers: details?.affectedUsers || 0,
    });
  } catch (error) {
    logger.error('Failed to send platform status notification:', {
      platform,
      status,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Example: Send a daily summary of messages
 */
export async function sendDailySummary(
  summaryData: {
    date: Date;
    totalMessages: number;
    whatsappMessages: number;
    lineMessages: number;
    topSenders: Array<{ senderId: string; count: number; platform: string }>;
    messageTypes: Record<string, number>;
    errors: number;
  }
): Promise<void> {
  try {
    // Create a card message with summary data
    const cardSections = [
      {
        header: 'Message Statistics',
        widgets: [
          {
            textParagraph: {
              text: `**Total Messages:** ${summaryData.totalMessages}\n` +
                    `**WhatsApp:** ${summaryData.whatsappMessages}\n` +
                    `**LINE:** ${summaryData.lineMessages}\n` +
                    `**Errors:** ${summaryData.errors}`,
            },
          },
        ],
      },
    ];

    // Add top senders section
    if (summaryData.topSenders.length > 0) {
      const topSendersText = summaryData.topSenders
        .slice(0, 5)
        .map((sender, index) => `${index + 1}. ${sender.senderId} (${sender.platform}): ${sender.count}`)
        .join('\n');

      cardSections.push({
        header: 'Top Senders',
        widgets: [
          {
            textParagraph: {
              text: topSendersText,
            },
          },
        ],
      });
    }

    // Add message types section
    if (Object.keys(summaryData.messageTypes).length > 0) {
      const messageTypesText = Object.entries(summaryData.messageTypes)
        .sort(([, a], [, b]) => b - a)
        .map(([type, count]) => `**${type}:** ${count}`)
        .join('\n');

      cardSections.push({
        header: 'Message Types',
        widgets: [
          {
            textParagraph: {
              text: messageTypesText,
            },
          },
        ],
      });
    }

    // Add action buttons
    cardSections.push({
      widgets: [
        {
          buttonList: {
            buttons: [
              {
                text: 'View Detailed Report',
                onClick: {
                  action: {
                    function: 'viewDetailedReport',
                    parameters: [
                      { key: 'date', value: summaryData.date.toISOString() },
                    ],
                  },
                },
              },
              {
                text: 'Export Data',
                onClick: {
                  action: {
                    function: 'exportData',
                    parameters: [
                      { key: 'date', value: summaryData.date.toISOString() },
                      { key: 'format', value: 'csv' },
                    ],
                  },
                },
              },
            ],
          },
        },
      ],
    });

    // Send to technical team
    await googleChatService.sendCardMessage(
      'technical',
      '📊 Daily Message Summary',
      `Summary for ${summaryData.date.toDateString()}`,
      cardSections,
      undefined,
      `daily-summary-${summaryData.date.toISOString().split('T')[0]}`
    );

    logger.info('Daily summary sent to Google Chat:', {
      date: summaryData.date.toDateString(),
      totalMessages: summaryData.totalMessages,
      errors: summaryData.errors,
    });
  } catch (error) {
    logger.error('Failed to send daily summary:', {
      date: summaryData.date.toDateString(),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Example: Handle urgent messages that need immediate attention
 */
export async function handleUrgentMessage(
  message: ProcessedMessage,
  senderName?: string,
  urgencyReason?: string
): Promise<void> {
  try {
    const platformEmoji = message.platform === 'whatsapp' ? '📱' : '💬';
    const platformName = message.platform === 'whatsapp' ? 'WhatsApp' : 'LINE';

    // Create an urgent notification card
    const cardSections = [
      {
        header: 'Urgent Message Details',
        widgets: [
          {
            textParagraph: {
              text: `**Platform:** ${platformEmoji} ${platformName}\n` +
                    `**From:** ${senderName || message.senderId}\n` +
                    `**Time:** ${message.timestamp.toLocaleString()}\n` +
                    `**Reason:** ${urgencyReason || 'High priority keywords detected'}`,
            },
          },
        ],
      },
      {
        header: 'Message Content',
        widgets: [
          {
            textParagraph: {
              text: message.content.text || `${message.content.type} message`,
            },
          },
        ],
      },
      {
        widgets: [
          {
            buttonList: {
              buttons: [
                {
                  text: 'Respond Now',
                  onClick: {
                    action: {
                      function: 'respondToUrgentMessage',
                      parameters: [
                        { key: 'platform', value: message.platform },
                        { key: 'senderId', value: message.senderId },
                        { key: 'messageId', value: message.messageId },
                      ],
                    },
                  },
                },
                {
                  text: 'Escalate',
                  onClick: {
                    action: {
                      function: 'escalateMessage',
                      parameters: [
                        { key: 'platform', value: message.platform },
                        { key: 'messageId', value: message.messageId },
                      ],
                    },
                  },
                },
                {
                  text: 'Mark as Handled',
                  onClick: {
                    action: {
                      function: 'markAsHandled',
                      parameters: [
                        { key: 'messageId', value: message.messageId },
                      ],
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    ];

    // Send to all relevant spaces
    const spaces: Array<'technical' | 'design' | 'sales'> = ['technical'];

    // Add other spaces based on content
    const targetSpaces = determineTargetSpaces(message);
    targetSpaces.forEach(space => {
      if (!spaces.includes(space)) {
        spaces.push(space);
      }
    });

    // Send urgent notification to each space
    for (const space of spaces) {
      await googleChatService.sendCardMessage(
        space,
        '🚨 URGENT MESSAGE',
        `Priority message from ${platformName}`,
        cardSections,
        undefined,
        `urgent-${message.messageId}`
      );
    }

    logger.info('Urgent message notification sent to Google Chat:', {
      platform: message.platform,
      messageId: message.messageId,
      spaces,
      urgencyReason,
    });
  } catch (error) {
    logger.error('Failed to send urgent message notification:', {
      platform: message.platform,
      messageId: message.messageId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Example: Test the Google Chat integration
 */
export async function testGoogleChatIntegration(): Promise<{
  success: boolean;
  results: Record<string, boolean>;
  errors: string[];
}> {
  const results: Record<string, boolean> = {};
  const errors: string[] = [];

  try {
    // Test health check
    logger.info('Testing Google Chat health check...');
    results.healthCheck = await googleChatService.healthCheck();

    if (!results.healthCheck) {
      errors.push('Health check failed');
    }

    // Test sending to technical space
    logger.info('Testing technical space message...');
    try {
      await googleChatService.sendToTechnical(
        '🧪 Test message from BMA Messenger Hub integration',
        'test-integration'
      );
      results.technicalSpace = true;
    } catch (error) {
      results.technicalSpace = false;
      errors.push(`Technical space: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Test sending to design space
    logger.info('Testing design space message...');
    try {
      await googleChatService.sendToDesign(
        '🎨 Test message from BMA Messenger Hub integration',
        'test-integration'
      );
      results.designSpace = true;
    } catch (error) {
      results.designSpace = false;
      errors.push(`Design space: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Test sending to sales space
    logger.info('Testing sales space message...');
    try {
      await googleChatService.sendToSales(
        '💰 Test message from BMA Messenger Hub integration',
        'test-integration'
      );
      results.salesSpace = true;
    } catch (error) {
      results.salesSpace = false;
      errors.push(`Sales space: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Test card message
    logger.info('Testing card message...');
    try {
      await googleChatService.sendCardMessage(
        'technical',
        '🧪 Integration Test',
        'Testing card functionality',
        [
          {
            header: 'Test Results',
            widgets: [
              {
                textParagraph: {
                  text: 'This is a test card message from the BMA Messenger Hub integration.',
                },
              },
            ],
          },
        ],
        'test-integration'
      );
      results.cardMessage = true;
    } catch (error) {
      results.cardMessage = false;
      errors.push(`Card message: ${error instanceof Error ? error.message : String(error)}`);
    }

    const success = Object.values(results).every(result => result === true);

    logger.info('Google Chat integration test completed:', {
      success,
      results,
      errorCount: errors.length,
    });

    return { success, results, errors };
  } catch (error) {
    logger.error('Google Chat integration test failed:', error);
    errors.push(`Test execution: ${error instanceof Error ? error.message : String(error)}`);
    return { success: false, results, errors };
  }
}