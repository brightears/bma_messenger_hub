import { logger } from '../../utils/logger';
import { Department } from '../routing/keyword-router';

export enum ConversationState {
  NEW = 'new',
  AWAITING_CLARIFICATION = 'awaiting_clarification',
  CLARIFIED = 'clarified',
  ROUTED = 'routed',
  EXPIRED = 'expired'
}

export interface ConversationContext {
  id: string;
  platform: 'whatsapp' | 'line';
  senderId: string;
  senderName?: string;
  state: ConversationState;
  messages: ConversationMessage[];
  routingDecision?: RoutingDecision;
  clarificationAttempts: number;
  language?: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  threadId?: string; // Google Chat thread ID if routed
}

export interface ConversationMessage {
  content: string;
  timestamp: Date;
  isFromCustomer: boolean;
  translatedContent?: string;
  originalLanguage?: string;
}

export interface RoutingDecision {
  department: Department;
  confidence: number;
  reason: string;
  timestamp: Date;
}

export class ConversationManager {
  private conversations: Map<string, ConversationContext> = new Map();
  private readonly SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
  private readonly MAX_CLARIFICATION_ATTEMPTS = 3;
  private cleanupInterval: NodeJS.Timer;

  constructor() {
    // Run cleanup every minute
    this.cleanupInterval = setInterval(() => this.cleanupExpiredConversations(), 60000);
  }

  /**
   * Get or create conversation context
   */
  public getOrCreateConversation(
    platform: 'whatsapp' | 'line',
    senderId: string,
    senderName?: string
  ): ConversationContext {
    const conversationId = this.generateConversationId(platform, senderId);

    let conversation = this.conversations.get(conversationId);

    if (!conversation || conversation.state === ConversationState.EXPIRED) {
      conversation = this.createNewConversation(
        conversationId,
        platform,
        senderId,
        senderName
      );
      this.conversations.set(conversationId, conversation);
      logger.info('Created new conversation', { conversationId, platform, senderId });
    } else {
      // Update expiration time on activity
      conversation.expiresAt = new Date(Date.now() + this.SESSION_TIMEOUT_MS);
      conversation.updatedAt = new Date();
    }

    return conversation;
  }

  /**
   * Add message to conversation
   */
  public addMessage(
    conversationId: string,
    content: string,
    isFromCustomer: boolean,
    translatedContent?: string,
    originalLanguage?: string
  ): void {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      logger.warn('Attempted to add message to non-existent conversation', { conversationId });
      return;
    }

    conversation.messages.push({
      content,
      timestamp: new Date(),
      isFromCustomer,
      translatedContent,
      originalLanguage
    });

    // Update conversation
    conversation.updatedAt = new Date();
    conversation.expiresAt = new Date(Date.now() + this.SESSION_TIMEOUT_MS);

    // Detect language from first customer message
    if (isFromCustomer && !conversation.language && originalLanguage) {
      conversation.language = originalLanguage;
    }

    logger.debug('Added message to conversation', {
      conversationId,
      messageCount: conversation.messages.length,
      isFromCustomer
    });
  }

  /**
   * Update conversation state
   */
  public updateState(conversationId: string, state: ConversationState): void {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      logger.warn('Attempted to update state of non-existent conversation', { conversationId });
      return;
    }

    const oldState = conversation.state;
    conversation.state = state;
    conversation.updatedAt = new Date();

    logger.info('Updated conversation state', {
      conversationId,
      oldState,
      newState: state
    });
  }

  /**
   * Set routing decision
   */
  public setRoutingDecision(
    conversationId: string,
    department: Department,
    confidence: number,
    reason: string
  ): void {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      logger.warn('Attempted to set routing for non-existent conversation', { conversationId });
      return;
    }

    conversation.routingDecision = {
      department,
      confidence,
      reason,
      timestamp: new Date()
    };

    conversation.state = ConversationState.ROUTED;
    conversation.updatedAt = new Date();

    logger.info('Set routing decision', {
      conversationId,
      department,
      confidence
    });
  }

  /**
   * Increment clarification attempts
   */
  public incrementClarificationAttempts(conversationId: string): number {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      logger.warn('Attempted to increment clarification for non-existent conversation', { conversationId });
      return 0;
    }

    conversation.clarificationAttempts++;
    conversation.state = ConversationState.AWAITING_CLARIFICATION;
    conversation.updatedAt = new Date();

    logger.debug('Incremented clarification attempts', {
      conversationId,
      attempts: conversation.clarificationAttempts
    });

    return conversation.clarificationAttempts;
  }

  /**
   * Check if max clarification attempts reached
   */
  public hasReachedMaxClarificationAttempts(conversationId: string): boolean {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      return false;
    }

    return conversation.clarificationAttempts >= this.MAX_CLARIFICATION_ATTEMPTS;
  }

  /**
   * Get conversation context
   */
  public getConversation(conversationId: string): ConversationContext | undefined {
    return this.conversations.get(conversationId);
  }

  /**
   * Get conversation by platform and sender
   */
  public getConversationByPlatformAndSender(
    platform: 'whatsapp' | 'line',
    senderId: string
  ): ConversationContext | undefined {
    const conversationId = this.generateConversationId(platform, senderId);
    return this.conversations.get(conversationId);
  }

  /**
   * Set Google Chat thread ID for conversation
   */
  public setThreadId(conversationId: string, threadId: string): void {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      logger.warn('Attempted to set thread ID for non-existent conversation', { conversationId });
      return;
    }

    conversation.threadId = threadId;
    conversation.updatedAt = new Date();

    logger.debug('Set thread ID for conversation', { conversationId, threadId });
  }

  /**
   * Get recent messages for context
   */
  public getRecentMessages(
    conversationId: string,
    limit: number = 5
  ): ConversationMessage[] {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      return [];
    }

    return conversation.messages.slice(-limit);
  }

  /**
   * Get conversation summary for logging/debugging
   */
  public getConversationSummary(conversationId: string): string {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      return 'Conversation not found';
    }

    const messageCount = conversation.messages.length;
    const lastMessage = conversation.messages[messageCount - 1];

    return `Platform: ${conversation.platform}, ` +
           `State: ${conversation.state}, ` +
           `Messages: ${messageCount}, ` +
           `Department: ${conversation.routingDecision?.department || 'none'}, ` +
           `Last: "${lastMessage?.content.substring(0, 50) || 'none'}..."`;
  }

  /**
   * Generate conversation ID
   */
  private generateConversationId(platform: 'whatsapp' | 'line', senderId: string): string {
    return `${platform}:${senderId}`;
  }

  /**
   * Create new conversation context
   */
  private createNewConversation(
    id: string,
    platform: 'whatsapp' | 'line',
    senderId: string,
    senderName?: string
  ): ConversationContext {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.SESSION_TIMEOUT_MS);

    return {
      id,
      platform,
      senderId,
      senderName,
      state: ConversationState.NEW,
      messages: [],
      clarificationAttempts: 0,
      createdAt: now,
      updatedAt: now,
      expiresAt
    };
  }

  /**
   * Clean up expired conversations
   */
  private cleanupExpiredConversations(): void {
    const now = new Date();
    let expiredCount = 0;

    for (const [id, conversation] of this.conversations.entries()) {
      if (conversation.expiresAt < now) {
        conversation.state = ConversationState.EXPIRED;
        this.conversations.delete(id);
        expiredCount++;
      }
    }

    if (expiredCount > 0) {
      logger.debug('Cleaned up expired conversations', { count: expiredCount });
    }
  }

  /**
   * Cleanup resources on shutdown
   */
  public destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.conversations.clear();
  }
}