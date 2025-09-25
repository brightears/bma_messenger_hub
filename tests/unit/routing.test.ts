import { KeywordRouter, Department } from '../../src/services/routing/keyword-router';
import { MessageRouter } from '../../src/services/routing';
import { ProcessedMessage } from '../../src/types/webhooks';

describe('KeywordRouter', () => {
  let router: KeywordRouter;

  beforeEach(() => {
    router = new KeywordRouter();
  });

  describe('analyzeKeywords', () => {
    it('should detect technical support keywords', () => {
      const testCases = [
        'I need help with my system',
        'There is an error in the application',
        'The system is not working',
        'I have a technical issue',
        'Can you fix this bug?'
      ];

      testCases.forEach(message => {
        const result = router.analyzeKeywords(message);
        expect(result.department).toBe(Department.TECHNICAL);
        expect(result.confidence).toBeGreaterThan(0.5);
        expect(result.keywords.length).toBeGreaterThan(0);
      });
    });

    it('should detect sales keywords', () => {
      const testCases = [
        'I need a quote for your services',
        'What are your prices?',
        'I want to purchase a subscription',
        'Can you send me a quotation?',
        'How much does it cost?'
      ];

      testCases.forEach(message => {
        const result = router.analyzeKeywords(message);
        expect(result.department).toBe(Department.SALES);
        expect(result.confidence).toBeGreaterThan(0.5);
      });
    });

    it('should detect design keywords', () => {
      const testCases = [
        'I need help with music selection',
        'Can you design a playlist?',
        'We need soundtrack for our restaurant',
        'Help with audio branding',
        'Custom music design needed'
      ];

      testCases.forEach(message => {
        const result = router.analyzeKeywords(message);
        expect(result.department).toBe(Department.DESIGN);
        expect(result.confidence).toBeGreaterThan(0.5);
      });
    });

    it('should return unknown for ambiguous messages', () => {
      const result = router.analyzeKeywords('Hello there');
      expect(result.department).toBe(Department.UNKNOWN);
      expect(result.confidence).toBe(0);
    });

    it('should handle hotel patterns as potential sales', () => {
      const result = router.analyzeKeywords('Hello, I am from Hilton Hotel');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should reduce confidence for mixed signals', () => {
      const result = router.analyzeKeywords('I need help with pricing and technical support');
      expect(result.confidence).toBeLessThan(0.7);
    });
  });

  describe('isGreeting', () => {
    it('should detect various greetings', () => {
      const greetings = [
        'Hello',
        'Hi there',
        'Good morning',
        'Hey',
        'สวัสดี',
        '你好'
      ];

      greetings.forEach(greeting => {
        expect(router.isGreeting(greeting)).toBe(true);
      });
    });

    it('should not detect non-greetings as greetings', () => {
      expect(router.isGreeting('I need help')).toBe(false);
      expect(router.isGreeting('Quote please')).toBe(false);
    });
  });

  describe('getSuggestedClarification', () => {
    it('should suggest clarification for greetings', () => {
      const clarification = router.getSuggestedClarification('Hello');
      expect(clarification).toContain('How can I help you today?');
    });

    it('should return null for clear messages', () => {
      const clarification = router.getSuggestedClarification('I need technical support');
      expect(clarification).toBeNull();
    });

    it('should suggest clarification for unknown messages', () => {
      const clarification = router.getSuggestedClarification('XYZ ABC 123');
      expect(clarification).toContain("I'd be happy to help");
    });
  });
});

describe('MessageRouter Integration', () => {
  let messageRouter: MessageRouter;

  beforeEach(() => {
    // Mock dependencies
    jest.mock('../../src/integrations/google-chat');
    jest.mock('../../src/services/routing/ai-router');

    messageRouter = new MessageRouter();
  });

  afterEach(() => {
    messageRouter.destroy();
  });

  describe('routeMessage', () => {
    it('should route clear technical messages without AI', async () => {
      const message: ProcessedMessage = {
        platform: 'whatsapp',
        senderId: 'user123',
        senderName: 'Test User',
        content: 'I have a technical problem with the system',
        timestamp: new Date(),
        messageId: 'msg123',
        isReply: false
      };

      const response = await messageRouter.routeMessage(message);

      expect(response.routed).toBe(true);
      expect(response.department).toBe(Department.TECHNICAL);
      expect(response.needsClarification).toBe(false);
    });

    it('should request clarification for greetings', async () => {
      const message: ProcessedMessage = {
        platform: 'line',
        senderId: 'user456',
        content: 'Hello',
        timestamp: new Date(),
        messageId: 'msg456',
        isReply: false
      };

      const response = await messageRouter.routeMessage(message);

      expect(response.routed).toBe(false);
      expect(response.needsClarification).toBe(true);
      expect(response.responseMessage).toContain('How can I assist you');
    });
  });
});