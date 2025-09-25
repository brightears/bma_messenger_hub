// WhatsApp Business API Types
export interface WhatsAppWebhookEntry {
  id: string;
  changes: WhatsAppChange[];
}

export interface WhatsAppChange {
  value: WhatsAppValue;
  field: string;
}

export interface WhatsAppValue {
  messaging_product: string;
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  contacts?: WhatsAppContact[];
  messages?: WhatsAppMessage[];
  statuses?: WhatsAppStatus[];
}

export interface WhatsAppContact {
  profile: {
    name: string;
  };
  wa_id: string;
}

export interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'text' | 'image' | 'document' | 'audio' | 'video' | 'location' | 'contacts' | 'interactive' | 'button' | 'order';
  text?: {
    body: string;
  };
  image?: {
    caption?: string;
    mime_type: string;
    sha256: string;
    id: string;
  };
  document?: {
    caption?: string;
    filename?: string;
    mime_type: string;
    sha256: string;
    id: string;
  };
  audio?: {
    mime_type: string;
    sha256: string;
    id: string;
    voice?: boolean;
  };
  video?: {
    caption?: string;
    mime_type: string;
    sha256: string;
    id: string;
  };
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
  contacts?: any[];
  interactive?: {
    type: string;
    [key: string]: any;
  };
  button?: {
    text: string;
    payload: string;
  };
  context?: {
    from: string;
    id: string;
    referred_product?: any;
  };
}

export interface WhatsAppStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
  conversation?: {
    id: string;
    expiration_timestamp?: string;
    origin: {
      type: string;
    };
  };
  pricing?: {
    billable: boolean;
    pricing_model: string;
    category: string;
  };
  errors?: Array<{
    code: number;
    title: string;
    message: string;
    error_data?: {
      details: string;
    };
  }>;
}

export interface WhatsAppWebhookPayload {
  object: string;
  entry: WhatsAppWebhookEntry[];
}

// LINE Business API Types
export interface LineWebhookEvent {
  type: 'message' | 'follow' | 'unfollow' | 'join' | 'leave' | 'memberJoined' | 'memberLeft' | 'postback' | 'videoPlayComplete' | 'beacon' | 'accountLink' | 'things';
  mode: 'active' | 'standby';
  timestamp: number;
  source: {
    type: 'user' | 'group' | 'room';
    userId?: string;
    groupId?: string;
    roomId?: string;
  };
  webhookEventId: string;
  deliveryContext: {
    isRedelivery: boolean;
  };
  message?: LineMessage;
  postback?: {
    data: string;
    params?: {
      date?: string;
      time?: string;
      datetime?: string;
    };
  };
  beacon?: {
    hwid: string;
    type: 'enter' | 'leave' | 'banner';
    dm?: string;
  };
  link?: {
    result: 'ok' | 'failed';
    nonce: string;
  };
  things?: {
    deviceId: string;
    type: 'link' | 'unlink' | 'scenarioResult';
    result?: {
      scenarioId: string;
      revision: number;
      startTime: number;
      endTime: number;
      resultCode: 'success' | 'giveup' | 'cancel' | 'timeout';
      actionResults: Array<{
        type: string;
        data: any;
      }>;
      bleNotificationPayload?: string;
    };
  };
}

export interface LineMessage {
  id: string;
  type: 'text' | 'image' | 'video' | 'audio' | 'file' | 'location' | 'sticker';
  quotedMessageId?: string;
  text?: string;
  emojis?: Array<{
    index: number;
    productId: string;
    emojiId: string;
  }>;
  mention?: {
    mentionees: Array<{
      index: number;
      length: number;
      userId: string;
    }>;
  };
  contentProvider?: {
    type: 'line' | 'external';
    originalContentUrl?: string;
    previewImageUrl?: string;
  };
  fileName?: string;
  fileSize?: number;
  title?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  packageId?: string;
  stickerId?: string;
  stickerResourceType?: 'STATIC' | 'ANIMATION' | 'SOUND' | 'ANIMATION_SOUND' | 'POPUP' | 'POPUP_SOUND';
  keywords?: string[];
}

export interface LineWebhookPayload {
  destination: string;
  events: LineWebhookEvent[];
}

// Google Chat Types
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
    };
    space: {
      name: string;
      type: 'ROOM' | 'DM';
      displayName?: string;
    };
  };
  action?: {
    actionMethodName: string;
    parameters?: Array<{
      key: string;
      value: string;
    }>;
  };
}

// Common types
export interface ProcessedMessage {
  platform: 'whatsapp' | 'line' | 'google-chat';
  messageId: string;
  senderId: string;
  senderName?: string;
  phoneNumber?: string;
  content: string;
  timestamp: Date;
  isReply: boolean;
  replyTo?: string;
  groupId?: string;
  additionalInfo?: Record<string, any>;
}