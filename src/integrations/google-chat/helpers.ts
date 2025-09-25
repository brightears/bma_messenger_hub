import { chat_v1 } from 'googleapis';
import { ProcessedMessage } from '../../types/webhooks';
import { logger } from '../../utils/logger';
import { ProcessedGoogleChatMessage } from './webhook';

/**
 * Format a processed message from WhatsApp/LINE for Google Chat
 */
export function formatMessageForGoogleChat(
  message: ProcessedMessage,
  senderName?: string
): {
  text: string;
  cards?: chat_v1.Schema$GoogleAppsCardV1Card[];
} {
  const platformEmoji = message.platform === 'whatsapp' ? '📱' : '💬';
  const platformName = message.platform === 'whatsapp' ? 'WhatsApp' : 'LINE';

  let formattedText = `${platformEmoji} *${platformName} Message*\n`;
  formattedText += `*From:* ${senderName || message.senderId}\n`;
  formattedText += `*Time:* ${message.timestamp.toLocaleString()}\n`;

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

  formattedText += '\n';

  // Add content based on type
  switch (message.content.type) {
    case 'text':
      formattedText += `💬 ${message.content.text}`;
      break;

    case 'image':
      formattedText += `🖼️ *Image*`;
      if (message.content.mediaUrl) {
        formattedText += `\n📎 <${message.content.mediaUrl}>`;
      }
      break;

    case 'video':
      formattedText += `🎥 *Video*`;
      if (message.content.mediaUrl) {
        formattedText += `\n📎 <${message.content.mediaUrl}>`;
      }
      break;

    case 'audio':
      formattedText += `🎵 *Audio*`;
      if (message.content.mediaUrl) {
        formattedText += `\n📎 <${message.content.mediaUrl}>`;
      }
      break;

    case 'document':
      formattedText += `📄 *Document*`;
      if (message.content.mediaUrl) {
        formattedText += `\n📎 <${message.content.mediaUrl}>`;
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
 * Format a Google Chat message for forwarding to other platforms
 */
export function formatGoogleChatMessageForPlatforms(
  message: ProcessedGoogleChatMessage
): {
  text: string;
  isCommand: boolean;
  commandName?: string;
} {
  let formattedText = `💼 *Google Chat Message*\n`;
  formattedText += `*From:* ${message.senderName}`;

  if (message.senderEmail) {
    formattedText += ` (${message.senderEmail})`;
  }

  formattedText += `\n*Space:* ${message.spaceDisplayName || message.spaceName}`;
  formattedText += `\n*Time:* ${message.timestamp.toLocaleString()}\n\n`;

  let isCommand = false;
  let commandName: string | undefined;

  // Handle different content types
  switch (message.content.type) {
    case 'text':
      if (message.content.text) {
        formattedText += `💬 ${message.content.text}`;
      }
      break;

    case 'slash_command':
      isCommand = true;
      commandName = message.content.commandName;
      formattedText += `⚡ *Command:* /${message.content.commandName}`;
      if (message.content.text) {
        formattedText += `\n📝 ${message.content.text}`;
      }
      break;

    case 'attachment':
      formattedText += `📎 *Attachments:*`;
      if (message.content.attachments) {
        message.content.attachments.forEach((attachment, index) => {
          formattedText += `\n${index + 1}. ${attachment.contentName} (${attachment.contentType})`;
        });
      }
      if (message.content.text) {
        formattedText += `\n📝 ${message.content.text}`;
      }
      break;

    default:
      if (message.content.text) {
        formattedText += `❓ ${message.content.text}`;
      }
      break;
  }

  // Add mentions information
  if (message.mentions && message.mentions.length > 0) {
    formattedText += `\n\n👥 *Mentions:*`;
    message.mentions.forEach((mention, index) => {
      formattedText += `\n${index + 1}. ${mention.displayName}`;
    });
  }

  return {
    text: formattedText,
    isCommand,
    commandName,
  };
}

/**
 * Create a card message for Google Chat with structured content
 */
export function createGoogleChatCard(
  title: string,
  subtitle: string,
  content: {
    sections?: Array<{
      header?: string;
      widgets: Array<{
        textParagraph?: { text: string };
        image?: { imageUrl: string; altText?: string };
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
    }>;
    buttons?: Array<{
      text: string;
      actionFunction: string;
      parameters?: Record<string, string>;
    }>;
  }
): chat_v1.Schema$GoogleAppsCardV1Card {
  const card: chat_v1.Schema$GoogleAppsCardV1Card = {
    header: {
      title,
      subtitle,
    },
    sections: content.sections || [],
  };

  // Add global buttons if provided
  if (content.buttons && content.buttons.length > 0) {
    const buttonSection = {
      widgets: [
        {
          buttonList: {
            buttons: content.buttons.map(button => ({
              text: button.text,
              onClick: {
                action: {
                  function: button.actionFunction,
                  parameters: button.parameters
                    ? Object.entries(button.parameters).map(([key, value]) => ({ key, value }))
                    : [],
                },
              },
            })),
          },
        },
      ],
    };

    card.sections!.push(buttonSection);
  }

  return card;
}

/**
 * Create a notification card for platform integrations
 */
export function createPlatformNotificationCard(
  platform: 'whatsapp' | 'line',
  eventType: 'new_message' | 'status_update' | 'error',
  details: {
    from?: string;
    messagePreview?: string;
    status?: string;
    errorMessage?: string;
    timestamp: Date;
  }
): chat_v1.Schema$GoogleAppsCardV1Card {
  const platformName = platform === 'whatsapp' ? 'WhatsApp' : 'LINE';
  const platformEmoji = platform === 'whatsapp' ? '📱' : '💬';

  let title: string;
  let subtitle: string;
  let color = '#4285f4'; // Default blue

  switch (eventType) {
    case 'new_message':
      title = `${platformEmoji} New ${platformName} Message`;
      subtitle = `From: ${details.from || 'Unknown'}`;
      color = '#34a853'; // Green
      break;

    case 'status_update':
      title = `${platformEmoji} ${platformName} Status Update`;
      subtitle = `Status: ${details.status || 'Unknown'}`;
      color = '#fbbc04'; // Yellow
      break;

    case 'error':
      title = `${platformEmoji} ${platformName} Error`;
      subtitle = 'Integration Error Occurred';
      color = '#ea4335'; // Red
      break;

    default:
      title = `${platformEmoji} ${platformName} Notification`;
      subtitle = 'Platform Event';
      break;
  }

  const sections: Array<{
    widgets: Array<{
      textParagraph?: { text: string };
      buttonList?: any;
    }>;
  }> = [];

  // Add message preview or error details
  if (details.messagePreview) {
    sections.push({
      widgets: [
        {
          textParagraph: {
            text: `<b>Message:</b><br>${details.messagePreview}`,
          },
        },
      ],
    });
  } else if (details.errorMessage) {
    sections.push({
      widgets: [
        {
          textParagraph: {
            text: `<b>Error:</b><br>${details.errorMessage}`,
          },
        },
      ],
    });
  }

  // Add timestamp
  sections.push({
    widgets: [
      {
        textParagraph: {
          text: `<b>Time:</b> ${details.timestamp.toLocaleString()}`,
        },
      },
    ],
  });

  // Add action buttons based on event type
  if (eventType === 'new_message') {
    sections.push({
      widgets: [
        {
          buttonList: {
            buttons: [
              {
                text: 'View Conversation',
                onClick: {
                  action: {
                    function: 'viewConversation',
                    parameters: [
                      { key: 'platform', value: platform },
                      { key: 'sender', value: details.from || 'unknown' },
                    ],
                  },
                },
              },
              {
                text: 'Reply',
                onClick: {
                  action: {
                    function: 'replyToMessage',
                    parameters: [
                      { key: 'platform', value: platform },
                      { key: 'sender', value: details.from || 'unknown' },
                    ],
                  },
                },
              },
            ],
          },
        },
      ],
    });
  } else if (eventType === 'error') {
    sections.push({
      widgets: [
        {
          buttonList: {
            buttons: [
              {
                text: 'View Logs',
                onClick: {
                  action: {
                    function: 'viewLogs',
                    parameters: [
                      { key: 'platform', value: platform },
                      { key: 'timestamp', value: details.timestamp.toISOString() },
                    ],
                  },
                },
              },
              {
                text: 'Retry',
                onClick: {
                  action: {
                    function: 'retryOperation',
                    parameters: [
                      { key: 'platform', value: platform },
                    ],
                  },
                },
              },
            ],
          },
        },
      ],
    });
  }

  return {
    header: {
      title,
      subtitle,
    },
    sections,
  };
}

/**
 * Extract thread key from a message for conversation threading
 */
export function generateThreadKey(
  platform: 'whatsapp' | 'line',
  senderId: string,
  contextId?: string
): string {
  // Generate a consistent thread key for grouping related messages
  const baseKey = `${platform}-${senderId}`;

  if (contextId) {
    return `${baseKey}-${contextId}`;
  }

  return baseKey;
}

/**
 * Sanitize text for Google Chat markdown
 */
export function sanitizeTextForGoogleChat(text: string): string {
  // Escape special markdown characters
  return text
    .replace(/\*/g, '\\*')
    .replace(/`/g, '\\`')
    .replace(/~/g, '\\~')
    .replace(/_/g, '\\_')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/>/g, '\\>')
    .replace(/</g, '\\<')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Truncate text to fit Google Chat message limits
 */
export function truncateText(text: string, maxLength = 4000): string {
  if (text.length <= maxLength) {
    return text;
  }

  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Create a summary card for multiple messages
 */
export function createMessageSummaryCard(
  platform: 'whatsapp' | 'line',
  messages: ProcessedMessage[],
  title?: string
): chat_v1.Schema$GoogleAppsCardV1Card {
  const platformName = platform === 'whatsapp' ? 'WhatsApp' : 'LINE';
  const platformEmoji = platform === 'whatsapp' ? '📱' : '💬';

  const cardTitle = title || `${platformEmoji} ${platformName} Messages Summary`;
  const subtitle = `${messages.length} message${messages.length === 1 ? '' : 's'}`;

  const sections = [];

  // Group messages by sender
  const messagesBySender = messages.reduce((acc, message) => {
    const senderId = message.senderId;
    if (!acc[senderId]) {
      acc[senderId] = [];
    }
    acc[senderId].push(message);
    return acc;
  }, {} as Record<string, ProcessedMessage[]>);

  // Create a section for each sender
  Object.entries(messagesBySender).forEach(([senderId, senderMessages]) => {
    const sectionWidgets = [];

    // Add sender header
    sectionWidgets.push({
      textParagraph: {
        text: `<b>From:</b> ${senderId} (${senderMessages.length} message${senderMessages.length === 1 ? '' : 's'})`,
      },
    });

    // Add message previews
    senderMessages.slice(0, 3).forEach((message, index) => {
      let preview = '';
      switch (message.content.type) {
        case 'text':
          preview = truncateText(message.content.text || 'Empty message', 100);
          break;
        case 'image':
          preview = '🖼️ Image';
          break;
        case 'video':
          preview = '🎥 Video';
          break;
        case 'audio':
          preview = '🎵 Audio';
          break;
        case 'document':
          preview = '📄 Document';
          break;
        case 'location':
          preview = `📍 Location: ${message.content.location?.name || 'Coordinates'}`;
          break;
        default:
          preview = `${message.content.type}`;
          break;
      }

      sectionWidgets.push({
        textParagraph: {
          text: `${index + 1}. ${preview}`,
        },
      });
    });

    if (senderMessages.length > 3) {
      sectionWidgets.push({
        textParagraph: {
          text: `... and ${senderMessages.length - 3} more message${senderMessages.length - 3 === 1 ? '' : 's'}`,
        },
      });
    }

    sections.push({
      header: `Messages from ${senderId}`,
      widgets: sectionWidgets,
    });
  });

  return {
    header: {
      title: cardTitle,
      subtitle,
    },
    sections,
  };
}

/**
 * Log message formatting operations for debugging
 */
export function logMessageFormatting(
  operation: string,
  originalMessage: any,
  formattedMessage: any,
  additionalContext?: Record<string, any>
): void {
  logger.debug('Message formatting operation:', {
    operation,
    originalType: typeof originalMessage,
    originalPlatform: originalMessage?.platform,
    originalMessageId: originalMessage?.messageId,
    formattedLength: typeof formattedMessage?.text === 'string' ? formattedMessage.text.length : 0,
    hasCards: !!formattedMessage?.cards,
    ...additionalContext,
  });
}