import { logger } from '../../utils/logger';
import { GoogleChatService } from '../../integrations/google-chat';
import { ConversationManager, ConversationState } from '../conversation/manager';
import { KeywordRouter, Department, RoutingResult } from './keyword-router';
import { AIRouter } from './ai-router';
import { ProcessedMessage } from '../../types/webhooks';

export interface RoutingResponse {
  routed: boolean;
  department?: Department;
  responseMessage?: string;
  threadId?: string;
  needsClarification: boolean;
}

export class MessageRouter {
  private keywordRouter: KeywordRouter;
  private aiRouter: AIRouter;
  private conversationManager: ConversationManager;
  private googleChat: GoogleChatService;
  private readonly CONFIDENCE_THRESHOLD = 0.6;

  constructor() {
    this.keywordRouter = new KeywordRouter();
    this.aiRouter = new AIRouter();
    this.conversationManager = new ConversationManager();
    this.googleChat = new GoogleChatService();
  }

  /**
   * Main routing entry point
   */
  public async routeMessage(message: ProcessedMessage): Promise<RoutingResponse> {
    try {
      // Get or create conversation context
      const conversation = this.conversationManager.getOrCreateConversation(
        message.platform,
        message.senderId,
        message.senderName
      );

      // Add message to conversation history
      this.conversationManager.addMessage(
        conversation.id,
        message.content,
        true
      );

      // Check if we're awaiting clarification
      if (conversation.state === ConversationState.AWAITING_CLARIFICATION) {
        return await this.handleClarificationResponse(message, conversation.id);
      }

      // Check if already routed (follow-up message)
      if (conversation.state === ConversationState.ROUTED && conversation.threadId) {
        return await this.handleFollowUpMessage(message, conversation.id);
      }

      // New conversation - attempt routing
      return await this.performInitialRouting(message, conversation.id);
    } catch (error) {
      logger.error('Message routing failed', { error, message });
      return {
        routed: false,
        needsClarification: false,
        responseMessage: "I'm experiencing technical difficulties. Please try again later."
      };
    }
  }

  /**
   * Perform initial routing for new conversation
   */
  private async performInitialRouting(
    message: ProcessedMessage,
    conversationId: string
  ): Promise<RoutingResponse> {
    // First, try keyword-based routing
    const keywordResult = this.keywordRouter.analyzeKeywords(message.content);

    if (keywordResult.confidence >= this.CONFIDENCE_THRESHOLD) {
      // Confident keyword match - route directly
      return await this.routeToGoogleSpace(
        message,
        conversationId,
        keywordResult.department,
        keywordResult.confidence,
        keywordResult.reason || 'Keyword match'
      );
    }

    // Check if it's a greeting
    if (this.keywordRouter.isGreeting(message.content)) {
      return this.requestClarification(
        conversationId,
        "Hello! Welcome to BMA. How can I assist you today? Are you looking for technical support, a price quote, or help with music and design?"
      );
    }

    // Low confidence or unknown - use AI
    const aiResult = await this.aiRouter.classifyMessage(message.content);

    if (aiResult.confidence >= this.CONFIDENCE_THRESHOLD && !aiResult.needsClarification) {
      // AI confident - route
      return await this.routeToGoogleSpace(
        message,
        conversationId,
        aiResult.department,
        aiResult.confidence,
        aiResult.reasoning
      );
    }

    // Need clarification
    const clarificationMessage =
      aiResult.clarificationMessage ||
      this.keywordRouter.getSuggestedClarification(message.content) ||
      await this.aiRouter.generateClarification(message.content);

    return this.requestClarification(conversationId, clarificationMessage);
  }

  /**
   * Handle clarification response
   */
  private async handleClarificationResponse(
    message: ProcessedMessage,
    conversationId: string
  ): Promise<RoutingResponse> {
    // Check if max attempts reached
    if (this.conversationManager.hasReachedMaxClarificationAttempts(conversationId)) {
      // Route to default (sales) after max attempts
      logger.warn('Max clarification attempts reached, routing to sales', { conversationId });
      return await this.routeToGoogleSpace(
        message,
        conversationId,
        Department.SALES,
        0.3,
        'Default routing after max clarification attempts'
      );
    }

    // Try to route with the clarification response
    const keywordResult = this.keywordRouter.analyzeKeywords(message.content);

    if (keywordResult.confidence >= 0.5) {
      // Even moderate confidence is enough after clarification
      return await this.routeToGoogleSpace(
        message,
        conversationId,
        keywordResult.department,
        keywordResult.confidence,
        'Clarification response - ' + keywordResult.reason
      );
    }

    // Try AI classification with conversation context
    const conversation = this.conversationManager.getConversation(conversationId);
    const context = conversation?.messages
      .map(m => m.content)
      .join(' | ');

    const aiResult = await this.aiRouter.classifyMessage(message.content, context);

    if (aiResult.confidence >= 0.4) {
      // Lower threshold after clarification
      return await this.routeToGoogleSpace(
        message,
        conversationId,
        aiResult.department,
        aiResult.confidence,
        'AI classification after clarification'
      );
    }

    // Still unclear - try one more time
    const attempts = this.conversationManager.incrementClarificationAttempts(conversationId);
    const clarificationMessage = await this.aiRouter.generateClarification(
      message.content,
      attempts
    );

    return this.requestClarification(conversationId, clarificationMessage);
  }

  /**
   * Handle follow-up message in existing conversation
   */
  private async handleFollowUpMessage(
    message: ProcessedMessage,
    conversationId: string
  ): Promise<RoutingResponse> {
    const conversation = this.conversationManager.getConversation(conversationId);
    if (!conversation || !conversation.routingDecision || !conversation.threadId) {
      // Shouldn't happen, but handle gracefully
      return await this.performInitialRouting(message, conversationId);
    }

    // Send follow-up to same thread
    try {
      const spaceId = this.getSpaceIdForDepartment(conversation.routingDecision.department);
      await this.googleChat.sendMessage(
        spaceId,
        this.formatFollowUpMessage(message),
        conversation.threadId
      );

      logger.info('Routed follow-up message', {
        conversationId,
        department: conversation.routingDecision.department,
        threadId: conversation.threadId
      });

      return {
        routed: true,
        department: conversation.routingDecision.department,
        threadId: conversation.threadId,
        needsClarification: false
      };
    } catch (error) {
      logger.error('Failed to route follow-up message', { error, conversationId });
      return {
        routed: false,
        needsClarification: false,
        responseMessage: "I couldn't send your message. Please try again."
      };
    }
  }

  /**
   * Route message to Google Space
   */
  private async routeToGoogleSpace(
    message: ProcessedMessage,
    conversationId: string,
    department: Department,
    confidence: number,
    reason: string
  ): Promise<RoutingResponse> {
    try {
      // Set routing decision
      this.conversationManager.setRoutingDecision(
        conversationId,
        department,
        confidence,
        reason
      );

      // Get space ID
      const spaceId = this.getSpaceIdForDepartment(department);

      // Format and send message
      const formattedMessage = this.formatInitialMessage(message, confidence, reason);
      const result = await this.googleChat.sendMessage(spaceId, formattedMessage);

      // Store thread ID if created
      if (result.threadName) {
        const threadId = result.threadName.split('/').pop();
        if (threadId) {
          this.conversationManager.setThreadId(conversationId, threadId);
        }
      }

      logger.info('Successfully routed message', {
        conversationId,
        department,
        confidence,
        spaceId
      });

      return {
        routed: true,
        department,
        threadId: result.threadName,
        needsClarification: false
      };
    } catch (error) {
      logger.error('Failed to route message to Google Space', {
        error,
        conversationId,
        department
      });

      return {
        routed: false,
        needsClarification: false,
        responseMessage: "I'm having trouble forwarding your message. Our team will get back to you soon."
      };
    }
  }

  /**
   * Request clarification from customer
   */
  private requestClarification(
    conversationId: string,
    clarificationMessage: string
  ): RoutingResponse {
    this.conversationManager.incrementClarificationAttempts(conversationId);
    this.conversationManager.addMessage(
      conversationId,
      clarificationMessage,
      false
    );

    return {
      routed: false,
      needsClarification: true,
      responseMessage: clarificationMessage
    };
  }

  /**
   * Get Google Space ID for department
   */
  private getSpaceIdForDepartment(department: Department): string {
    switch (department) {
      case Department.TECHNICAL:
        return 'technical';
      case Department.SALES:
        return 'sales';
      case Department.DESIGN:
        return 'design';
      default:
        return 'sales'; // Default to sales for unknown
    }
  }

  /**
   * Format initial message for Google Chat
   */
  private formatInitialMessage(
    message: ProcessedMessage,
    confidence: number,
    reason: string
  ): string {
    const platform = message.platform === 'whatsapp' ? '📱 WhatsApp' : '💬 LINE';
    const confidenceEmoji = confidence >= 0.8 ? '✅' : confidence >= 0.6 ? '⚠️' : '❓';

    let formatted = `**New Message from ${platform}**\n\n`;
    formatted += `👤 **From:** ${message.senderName || message.senderId}\n`;

    if (message.phoneNumber) {
      formatted += `📞 **Phone:** ${message.phoneNumber}\n`;
    }

    formatted += `\n💬 **Message:**\n${message.content}\n`;
    formatted += `\n---\n`;
    formatted += `${confidenceEmoji} **Routing:** ${reason} (${Math.round(confidence * 100)}% confidence)`;

    return formatted;
  }

  /**
   * Format follow-up message
   */
  private formatFollowUpMessage(message: ProcessedMessage): string {
    const platform = message.platform === 'whatsapp' ? '📱' : '💬';
    return `${platform} **${message.senderName || message.senderId}:**\n${message.content}`;
  }

  /**
   * Cleanup resources
   */
  public destroy(): void {
    this.conversationManager.destroy();
  }
}