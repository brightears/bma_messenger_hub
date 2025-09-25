import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables
dotenv.config();

// Configuration schema for validation
const configSchema = z.object({
  // Server configuration
  port: z.number().default(3000),
  nodeEnv: z.string().default('development'),

  // WhatsApp Business API
  whatsApp: z.object({
    apiUrl: z.string().url(),
    accessToken: z.string().min(1),
    verifyToken: z.string().min(1),
    phoneNumberId: z.string().min(1),
    webhookSecret: z.string().min(1),
  }),

  // LINE Business API
  line: z.object({
    apiUrl: z.string().url(),
    channelId: z.string().min(1),
    channelAccessToken: z.string().min(1),
    channelSecret: z.string().min(1),
  }),

  // Google Chat
  googleChat: z.object({
    credentialsJson: z.string().min(1),
    technicalSpace: z.string().min(1),
    designSpace: z.string().min(1),
    salesSpace: z.string().min(1),
  }),

  // AI Services
  gemini: z.object({
    apiKey: z.string().min(1),
    model: z.string().default('gemini-2.5-flash'),
    maxTokens: z.number().default(8192),
    temperature: z.number().default(0.7),
  }),

  openAI: z.object({
    apiKey: z.string().min(1),
    model: z.string().default('gpt-5-mini'),
    maxTokens: z.number().default(4096),
    temperature: z.number().default(0.8),
  }),

  // Database
  useDatabase: z.boolean().default(false),
});

// Parse and validate configuration
function loadConfig() {
  try {
    const config = {
      port: parseInt(process.env.PORT || '3000'),
      nodeEnv: process.env.NODE_ENV || 'development',

      whatsApp: {
        apiUrl: process.env.WHATSAPP_API_URL!,
        accessToken: process.env.WHATSAPP_ACCESS_TOKEN!,
        verifyToken: process.env.WHATSAPP_VERIFY_TOKEN!,
        phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
        webhookSecret: process.env.WHATSAPP_WEBHOOK_SECRET!,
      },

      line: {
        apiUrl: process.env.LINE_API_URL!,
        channelId: process.env.LINE_CHANNEL_ID!,
        channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
        channelSecret: process.env.LINE_CHANNEL_SECRET!,
      },

      googleChat: {
        credentialsJson: process.env.GOOGLE_CREDENTIALS_JSON!,
        technicalSpace: process.env.GCHAT_TECHNICAL_SPACE!,
        designSpace: process.env.GCHAT_DESIGN_SPACE!,
        salesSpace: process.env.GCHAT_SALES_SPACE!,
      },

      gemini: {
        apiKey: process.env.GEMINI_API_KEY!,
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
        maxTokens: parseInt(process.env.GEMINI_MAX_TOKENS || '8192'),
        temperature: parseFloat(process.env.GEMINI_TEMPERATURE || '0.7'),
      },

      openAI: {
        apiKey: process.env.OPENAI_API_KEY!,
        model: process.env.OPENAI_MODEL || 'gpt-5-mini',
        maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS || '4096'),
        temperature: parseFloat(process.env.OPENAI_TEMPERATURE || '0.8'),
      },

      useDatabase: process.env.USE_DATABASE === 'true',
    };

    return configSchema.parse(config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('Configuration validation failed:');
      error.errors.forEach(err => {
        console.error(`- ${err.path.join('.')}: ${err.message}`);
      });
    } else {
      console.error('Configuration error:', error);
    }
    process.exit(1);
  }
}

export const config = loadConfig();
export type Config = z.infer<typeof configSchema>;