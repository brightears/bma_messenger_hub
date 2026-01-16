// Load environment variables first
require('dotenv').config();

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const axios = require('axios');
const { sendMessage } = require('./services/google-chat-simple');
const { parseWhatsAppMessage, parseLineMessage, isValidMessage } = require('./services/message-processor');
// Removed message router - using single space now
const { translateMessage, healthCheck: translatorHealthCheck } = require('./services/translator');

// Single Google Chat space for all messages
const SINGLE_SPACE_ID = process.env.GCHAT_SPACE_ID || 'spaces/AAQAfKFrdxQ'; // BMA Chat Support
const { processGoogleChatWebhook } = require('./webhooks/google-chat');
const { healthCheck: whatsappHealthCheck, sendWhatsAppMessage, sendInfoRequest: sendWhatsAppInfoRequest, sendMediaMessage: sendWhatsAppMedia } = require('./services/whatsapp-sender');
const { healthCheck: lineHealthCheck, sendLineMessage, sendInfoRequest: sendLineInfoRequest, sendMediaMessage: sendLineMedia } = require('./services/line-sender');
const { saveFile, getFileUrl, readFile } = require('./services/file-handler');
const { getStats, getConversation, getConversationByUser, storeConversation, getMostRecentConversation } = require('./services/conversation-store');
const { startPolling, stopPolling, getStatus: getPollingStatus, getStats: getPollingStats } = require('./services/google-chat-poller');
const { storeMessage, getHistory, formatForDisplay, normalizePhoneNumber, clearOutgoingMessages } = require('./services/message-history');
const { getProfile, saveProfile, getStats: getProfileStats } = require('./services/customer-profiles');
const { markEscalated, isEscalated, getEscalationInfo, clearEscalation, getAllEscalated, extendEscalation, getRemainingTime, ESCALATION_TIMEOUT_MS } = require('./services/escalation-store');

// Customer info and AI gathering services
const {
  isNewCustomer,
  needsInfo,
  initializeCustomer,
  updateState,
  storeCustomerInfo,
  getCustomerInfo,
  incrementMessageCount,
  markInfoRequestSent,
  wasInfoRequestSent,
  shouldBypass,
  getCustomerStats
} = require('./services/customer-info');

const {
  initializeAIGatherer,
  generateInfoRequest,
  parseCustomerInfo,
  detectLanguage,
  generateFollowUp,
  isAIGatheringEnabled
} = require('./services/ai-gatherer');

const app = express();
const PORT = process.env.PORT || 10000;

// Note: Space IDs are now managed by the message-router service

// Parse JSON bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
    files: 5 // Max 5 files per upload
  },
  fileFilter: (req, file, cb) => {
    // Allowed file types
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif',
      'video/mp4', 'video/mpeg',
      'audio/mpeg', 'audio/wav',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images, videos, audio, PDFs and Office documents are allowed.'));
    }
  }
});

// Simple health check endpoint for Docker health checks (no external dependencies)
app.get('/health-simple', (req, res) => {
  res.json({
    status: 'ok',
    service: 'BMA Messenger Hub',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Comprehensive health check endpoint
app.get('/health', async (req, res) => {
  const healthChecks = {};
  let overallStatus = 'ok';

  // AI health check removed - no longer using AI routing
  healthChecks.ai = { status: 'disabled', message: 'AI routing not in use (single space mode)' };

  try {
    healthChecks.translator = await Promise.race([
      translatorHealthCheck(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
    ]);
  } catch (error) {
    healthChecks.translator = { status: 'error', message: error.message };
    overallStatus = 'degraded';
  }

  try {
    healthChecks.whatsapp = await Promise.race([
      whatsappHealthCheck(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
    ]);
  } catch (error) {
    healthChecks.whatsapp = { status: 'error', message: error.message };
    overallStatus = 'degraded';
  }

  try {
    healthChecks.line = await Promise.race([
      lineHealthCheck(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
    ]);
  } catch (error) {
    healthChecks.line = { status: 'error', message: error.message };
    overallStatus = 'degraded';
  }

  try {
    healthChecks.conversations = getStats();
  } catch (error) {
    healthChecks.conversations = { error: error.message };
    overallStatus = 'degraded';
  }

  try {
    healthChecks.polling = getPollingStatus();
  } catch (error) {
    healthChecks.polling = { error: error.message };
    overallStatus = 'degraded';
  }

  res.json({
    status: overallStatus,
    service: 'BMA Messenger Hub',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    ...healthChecks
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'BMA Messenger Hub is running',
    version: '1.1.0',
    endpoints: {
      whatsapp: '/webhooks/whatsapp',
      line: '/webhooks/line',
      googleChat: '/webhooks/google-chat',
      elevenlabs: '/webhooks/elevenlabs',
      elevenlabsLogResponse: '/webhooks/elevenlabs/log-response',
      elevenlabsEscalate: '/webhooks/elevenlabs/escalate',
      soundtrackZoneStatus: '/api/soundtrack/zone-status',
      health: '/health',
      polling: {
        status: '/polling/status',
        start: '/polling/start',
        stop: '/polling/stop'
      }
    }
  });
});

// Soundtrack API proxy - handles encoded IDs and returns formatted results
app.post('/api/soundtrack/zone-status', async (req, res) => {
  try {
    const { zone_id, account_id } = req.body;
    const inputId = zone_id || account_id;

    if (!inputId) {
      return res.json({
        success: false,
        error: 'Please provide a zone_id or account_id'
      });
    }

    // Determine ID type and format
    // IMPORTANT: Soundtrack API requires FULL encoded IDs (e.g., QWNjb3VudCwsMWg3amd6bnd0Zmsv)
    // NOT the decoded short IDs (e.g., 1h7jgznwtfk)
    let queryId = inputId;  // Use input directly by default
    let idType = 'unknown';
    let useAccountLookup = false;

    // Check if it's a base64 encoded string
    if (/^[A-Za-z0-9+/=]+$/.test(inputId) && inputId.length > 20) {
      try {
        const decoded = Buffer.from(inputId, 'base64').toString('utf8');
        console.log('Decoded ID:', decoded);

        // Determine type from decoded string
        if (decoded.includes('SoundZone,,')) {
          idType = 'zone';
          // For zones, we need the zone-specific encoded ID, not the full path
          // Extract just the zone portion and re-encode if needed
        } else if (decoded.includes('Account,,')) {
          idType = 'account';
          useAccountLookup = true;
        }

        // Use the ORIGINAL encoded ID for the query (not the decoded short ID)
        queryId = inputId;
        console.log('ID type:', idType, '- using encoded ID for query');
      } catch (e) {
        console.log('Not a valid base64 string, using as-is');
      }
    }

    console.log('Query ID:', queryId);
    console.log('Use account lookup:', useAccountLookup);

    // Query Soundtrack API
    const SOUNDTRACK_TOKEN = process.env.SOUNDTRACK_API_TOKEN || 'YVhId2UyTWJVWEhMRWlycUFPaUl3Y2NtOXNGeUoxR0Q6SVRHazZSWDVYV2FTenhiS1ZwNE1sSmhHUUJEVVRDdDZGU0FwVjZqMXNEQU1EMjRBT2pub2hmZ3NQODRRNndQWg==';

    // If it's an account ID, do account lookup
    // Include device { pairingCode } for device pairing codes
    if (useAccountLookup) {
      const accountQuery = JSON.stringify({
        query: `query { account(id: "${queryId}") { id businessName locations(first: 5) { edges { node { name soundZones(first: 20) { edges { node { id name isPaired device { pairingCode } playback { state } } } } } } } } }`
      });

      console.log('Account query with encoded ID:', queryId);
      console.log('Using token prefix:', SOUNDTRACK_TOKEN.substring(0, 10) + '...');
      const accountResponse = await axios.post('https://api.soundtrackyourbrand.com/v2', accountQuery, {
        headers: {
          'Authorization': `Basic ${SOUNDTRACK_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });

      console.log('Soundtrack API response:', JSON.stringify(accountResponse.data));

      if (accountResponse.data.data?.account) {
        const account = accountResponse.data.data.account;
        const allZones = [];
        for (const locEdge of (account.locations?.edges || [])) {
          const location = locEdge.node;
          for (const zoneEdge of (location.soundZones?.edges || [])) {
            const zone = zoneEdge.node;
            const zoneData = {
              id: zone.id,
              name: zone.name,
              location: location.name,
              is_paired: zone.isPaired,
              is_playing: zone.playback?.state === 'playing'
            };
            // Include device pairing code if zone is not paired and has device
            if (!zone.isPaired && zone.device?.pairingCode) {
              zoneData.pairing_code = zone.device.pairingCode;
            }
            allZones.push(zoneData);
          }
        }
        // Build message with pairing codes for unpaired zones
        const zoneMessages = allZones.map(z => {
          let msg = `${z.name}: ${z.is_paired ? 'paired' : 'not paired'}, ${z.is_playing ? 'playing' : 'not playing'}`;
          if (z.pairing_code) msg += ` (pairing code: ${z.pairing_code})`;
          return msg;
        });
        return res.json({
          success: true,
          account: {
            id: account.id,
            business_name: account.businessName,
            zones: allZones
          },
          message: `Found account "${account.businessName}" with ${allZones.length} zone(s). ${zoneMessages.join('. ')}`
        });
      } else {
        console.log('Account not found. API response:', JSON.stringify(accountResponse.data));
        return res.json({
          success: false,
          error: 'Account not found or not accessible. This account may not be managed by BMAsia.',
          query_id: queryId
        });
      }
    }

    // Try zone lookup first (for zone IDs or unknown types)
    // Include device { pairingCode } for device pairing code when zone is not paired
    const zoneQuery = JSON.stringify({
      query: `query { soundZone(id: "${queryId}") { id name isPaired device { pairingCode } playback { state } } }`
    });

    console.log('Zone query with ID:', queryId);
    const response = await axios.post('https://api.soundtrackyourbrand.com/v2', zoneQuery, {
      headers: {
        'Authorization': `Basic ${SOUNDTRACK_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.data.data?.soundZone) {
      const zone = response.data.data.soundZone;
      const responseData = {
        success: true,
        zone: {
          id: zone.id,
          name: zone.name,
          is_paired: zone.isPaired,
          is_playing: zone.playback?.state === 'playing'
        },
        message: `Zone "${zone.name}" is ${zone.isPaired ? 'paired' : 'not paired'} and ${zone.playback?.state === 'playing' ? 'currently playing' : 'not playing'}.`
      };
      // Include device pairing code if zone is not paired and has device
      if (!zone.isPaired && zone.device?.pairingCode) {
        responseData.zone.pairing_code = zone.device.pairingCode;
        responseData.message += ` Pairing code: ${zone.device.pairingCode}`;
      }
      return res.json(responseData);
    }

    // Zone not found - try account lookup as fallback
    // Include device { pairingCode } for pairing codes
    const accountQuery = JSON.stringify({
      query: `query { account(id: "${queryId}") { id businessName locations(first: 5) { edges { node { name soundZones(first: 20) { edges { node { id name isPaired device { pairingCode } playback { state } } } } } } } } }`
    });

    console.log('Fallback account query with ID:', queryId);
    const accountResponse = await axios.post('https://api.soundtrackyourbrand.com/v2', accountQuery, {
      headers: {
        'Authorization': `Basic ${SOUNDTRACK_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    if (accountResponse.data.data?.account) {
      const account = accountResponse.data.data.account;
      const allZones = [];
      for (const locEdge of (account.locations?.edges || [])) {
        const location = locEdge.node;
        for (const zoneEdge of (location.soundZones?.edges || [])) {
          const zone = zoneEdge.node;
          const zoneData = {
            id: zone.id,
            name: zone.name,
            location: location.name,
            is_paired: zone.isPaired,
            is_playing: zone.playback?.state === 'playing'
          };
          // Include device pairing code if zone is not paired and has device
          if (!zone.isPaired && zone.device?.pairingCode) {
            zoneData.pairing_code = zone.device.pairingCode;
          }
          allZones.push(zoneData);
        }
      }
      // Build message with pairing codes for unpaired zones
      const zoneMessages = allZones.map(z => {
        let msg = `${z.name}: ${z.is_paired ? 'paired' : 'not paired'}, ${z.is_playing ? 'playing' : 'not playing'}`;
        if (z.pairing_code) msg += ` (pairing code: ${z.pairing_code})`;
        return msg;
      });
      return res.json({
        success: true,
        account: {
          id: account.id,
          business_name: account.businessName,
          zones: allZones
        },
        message: `Found account "${account.businessName}" with ${allZones.length} zone(s). ${zoneMessages.join('. ')}`
      });
    }

    // Neither zone nor account accessible
    return res.json({
      success: false,
      error: 'Zone or account not found. This might be because it is not managed by BMAsia. Please check if your zone is under BMAsia management or contact support.',
      query_id: queryId
    });

  } catch (error) {
    console.error('Soundtrack API error:', error.message);
    return res.json({
      success: false,
      error: `Failed to query Soundtrack API: ${error.message}`
    });
  }
});

// Customer Profile API - Get customer info by phone (for ElevenLabs agent)
app.get('/api/customer/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    console.log(`📋 Customer profile lookup request for: ${phone}`);

    const profile = await getProfile(phone);

    if (profile && (profile.name || profile.company || profile.email)) {
      console.log(`✅ Found customer profile for ${phone}`);
      return res.json({
        success: true,
        found: true,
        customer: {
          name: profile.name || null,
          company: profile.company || null,
          email: profile.email || null,
          lastSeen: profile.lastSeen ? new Date(profile.lastSeen).toISOString() : null
        }
      });
    }

    console.log(`📋 No profile found for ${phone}`);
    return res.json({
      success: true,
      found: false,
      customer: null
    });

  } catch (error) {
    console.error('Customer profile lookup error:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Customer Profile API - Save/update customer info
app.post('/api/customer/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    const { name, company, email } = req.body;

    console.log(`💾 Save customer profile request for: ${phone}`);
    console.log(`   Data: name=${name}, company=${company}, email=${email}`);

    const profile = await saveProfile(phone, { name, company, email });

    if (profile) {
      console.log(`✅ Customer profile saved for ${phone}`);
      return res.json({
        success: true,
        message: 'Customer profile saved',
        customer: {
          name: profile.name || null,
          company: profile.company || null,
          email: profile.email || null
        }
      });
    }

    return res.status(400).json({
      success: false,
      error: 'Invalid phone number'
    });

  } catch (error) {
    console.error('Customer profile save error:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Customer Profile API - Get stats (admin)
app.get('/api/customer-stats', async (req, res) => {
  const stats = await getProfileStats();
  res.json({
    success: true,
    stats
  });
});

// Customer Profile Lookup API - POST version for ElevenLabs tool
app.post('/api/customer-lookup', async (req, res) => {
  try {
    let { phone, conversation_id } = req.body;
    console.log(`📋 Customer profile lookup - phone: ${phone}, conversation_id: ${conversation_id}`);

    // If conversation_id provided (from ElevenLabs dynamic variable), fetch phone from ElevenLabs API
    if (!phone && conversation_id) {
      console.log(`📋 Fetching phone from ElevenLabs conversation: ${conversation_id}`);
      try {
        const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || 'sk_42e0e37fe9ef457906b11dce0ac6ea5262a005ec2ce0ca6e';
        const convResponse = await axios.get(
          `https://api.elevenlabs.io/v1/convai/conversations/${conversation_id}`,
          { headers: { 'xi-api-key': ELEVENLABS_API_KEY } }
        );
        phone = convResponse.data?.metadata?.whatsapp?.whatsapp_user_id;
        if (phone) {
          console.log(`📋 Found phone from conversation: ${phone}`);
        } else {
          console.log(`📋 No WhatsApp phone in conversation metadata`);
        }
      } catch (err) {
        console.log(`📋 Could not fetch phone from conversation: ${err.message}`);
      }
    }

    if (!phone) {
      return res.json({
        success: false,
        found: false,
        message: 'Could not determine phone number'
      });
    }

    let profile = await getProfile(phone);

    // If not found, try adding Thailand country code (66)
    if (!profile) {
      const normalized = phone.replace(/[\s\-()]/g, '').replace(/^\+/, '');

      // Thai mobile numbers: 8xxxxxxxx or 9xxxxxxxx (9 digits without country code)
      if (normalized.length === 9 && (normalized.startsWith('8') || normalized.startsWith('9'))) {
        console.log(`📋 Trying with Thailand country code: 66${normalized}`);
        profile = await getProfile(`66${normalized}`);
      }

      // Also try if phone is 10 digits starting with 0 (local format: 08xxxxxxxx)
      if (!profile && normalized.length === 10 && normalized.startsWith('0')) {
        const withCountryCode = `66${normalized.substring(1)}`;
        console.log(`📋 Trying with Thailand country code: ${withCountryCode}`);
        profile = await getProfile(withCountryCode);
      }
    }

    // Check if this phone number has an open escalation
    const escalated = isEscalated(phone);
    if (escalated) {
      console.log(`⚠️ Customer ${phone} has an OPEN ESCALATION - agent should defer to team`);
    }

    if (profile && (profile.name || profile.company || profile.email)) {
      console.log(`✅ Found returning customer: ${profile.name || phone}`);
      return res.json({
        success: true,
        found: true,
        customer: {
          name: profile.name || null,
          company: profile.company || null,
          email: profile.email || null
        },
        is_escalated: escalated,
        escalation_message: escalated
          ? 'This customer has an open escalation. A team member is handling their request. Do NOT try to help - just tell them a colleague will respond shortly.'
          : null,
        message: profile.name
          ? `This is a returning customer: ${profile.name}${profile.company ? ` from ${profile.company}` : ''}`
          : 'Customer info found on file'
      });
    }

    console.log(`📋 New customer (no profile): ${phone}`);
    return res.json({
      success: true,
      found: false,
      customer: null,
      is_escalated: escalated,
      escalation_message: escalated
        ? 'This customer has an open escalation. A team member is handling their request. Do NOT try to help - just tell them a colleague will respond shortly.'
        : null,
      message: 'This is a new customer, no previous info on file'
    });

  } catch (error) {
    console.error('Customer lookup error:', error.message);
    return res.json({
      success: false,
      found: false,
      error: error.message
    });
  }
});

// Close Escalation API - allows team to close escalation and let agent respond again
app.post('/api/close-escalation', async (req, res) => {
  const { phone, redirect } = req.body;
  console.log(`[close-escalation] Request to close escalation for phone: ${phone}`);

  if (!phone) {
    return res.status(400).send('Phone number required');
  }

  const cleared = clearEscalation(phone);
  if (cleared) {
    console.log(`[close-escalation] ✅ Escalation cleared for ${phone}`);
  } else {
    console.log(`[close-escalation] No escalation found for ${phone}`);
  }

  // Check if there are any remaining escalations
  const remainingEscalations = getAllEscalated().length;
  let agentUnarchived = false;

  if (remainingEscalations === 0) {
    // No more escalations - unarchive the agent
    try {
      const unarchiveRes = await fetch(
        `https://api.elevenlabs.io/v1/convai/agents/${process.env.ELEVENLABS_AGENT_ID}`,
        {
          method: 'PATCH',
          headers: {
            'xi-api-key': process.env.ELEVENLABS_API_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            platform_settings: {
              archived: false
            }
          })
        }
      );

      if (unarchiveRes.ok) {
        console.log('✅ Agent UNARCHIVED - resuming normal responses');
        agentUnarchived = true;
      } else {
        console.error('⚠️ Failed to unarchive agent:', await unarchiveRes.text());
      }
    } catch (unarchiveErr) {
      console.error('⚠️ Error unarchiving agent:', unarchiveErr.message);
    }
  } else {
    console.log(`⚠️ ${remainingEscalations} escalations still active - agent stays archived`);
  }

  // If redirect URL provided, redirect back to reply portal
  if (redirect) {
    return res.redirect(redirect + '?escalation_closed=true');
  }

  return res.json({
    success: true,
    message: cleared ? 'Escalation closed successfully' : 'No escalation was active',
    phone: phone,
    agentUnarchived: agentUnarchived,
    remainingEscalations: remainingEscalations
  });
});

// GET endpoint for closing escalation from Google Chat button
app.get('/api/close-escalation-web', async (req, res) => {
  const { phone } = req.query;
  console.log(`[close-escalation-web] Request to close escalation for phone: ${phone}`);

  if (!phone) {
    return res.status(400).send('Phone number required');
  }

  const cleared = clearEscalation(phone);
  const remainingEscalations = getAllEscalated().length;
  let agentUnarchived = false;

  if (remainingEscalations === 0) {
    // No more escalations - unarchive the agent
    try {
      const unarchiveRes = await fetch(
        `https://api.elevenlabs.io/v1/convai/agents/${process.env.ELEVENLABS_AGENT_ID}`,
        {
          method: 'PATCH',
          headers: {
            'xi-api-key': process.env.ELEVENLABS_API_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            platform_settings: {
              archived: false
            }
          })
        }
      );

      if (unarchiveRes.ok) {
        console.log('✅ Agent UNARCHIVED - resuming normal responses');
        agentUnarchived = true;
      } else {
        console.error('⚠️ Failed to unarchive agent:', await unarchiveRes.text());
      }
    } catch (unarchiveErr) {
      console.error('⚠️ Error unarchiving agent:', unarchiveErr.message);
    }
  }

  // Return a simple HTML confirmation page
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Escalation Closed</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; text-align: center; background: #f5f5f5;">
      <div style="max-width: 400px; margin: 0 auto; background: white; padding: 30px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
        <h1 style="color: #4CAF50; margin-bottom: 20px;">✅ Escalation Closed</h1>
        <p style="color: #666; margin-bottom: 10px;">Phone: ${phone}</p>
        <p style="color: ${agentUnarchived ? '#4CAF50' : '#FF9800'}; font-weight: 500;">
          ${agentUnarchived
            ? 'Agent is now back online and will respond to new messages.'
            : `${remainingEscalations} escalation(s) still active - agent remains offline.`}
        </p>
        <p style="color: #999; margin-top: 20px; font-size: 14px;">You can close this tab.</p>
      </div>
    </body>
    </html>
  `);
});

// Reply portal by phone number (for forwarded WhatsApp messages during escalation)
app.get('/reply-wa/:phone', async (req, res) => {
  const { phone } = req.params;
  console.log(`[reply-wa] Loading reply portal for phone: ${phone}`);

  try {
    // Get message history for this phone
    const history = getHistory(phone) || [];

    // Get escalation info if available
    const escalationInfo = getEscalationInfo(phone);
    const customerProfile = await getProfile(phone);

    const customerName = customerProfile?.name || escalationInfo?.customerName || phone;
    const customerCompany = customerProfile?.company || null;

    // Format history for display
    const formattedHistory = history.map(msg => ({
      text: msg.text || '',
      direction: msg.direction,
      timestamp: new Date(msg.timestamp).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Bangkok'
      }),
      senderName: msg.direction === 'incoming' ? customerName : 'BMAsia Support'
    })).filter(m => m.text.trim());

    console.log(`[reply-wa] Found ${formattedHistory.length} messages in history for ${phone}`);

    // Render reply portal
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Reply to ${customerName}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            margin: 0;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            overflow: hidden;
          }
          .header {
            background: #25D366;
            color: white;
            padding: 20px;
            font-size: 20px;
            font-weight: bold;
          }
          .content { padding: 20px; }
          .info-box {
            background: #f8f9fa;
            border-left: 4px solid #25D366;
            padding: 15px;
            margin-bottom: 20px;
            border-radius: 4px;
          }
          .info-row { margin: 8px 0; color: #495057; }
          .info-label { font-weight: 600; color: #212529; }
          .message-history {
            max-height: 400px;
            overflow-y: auto;
            margin-bottom: 20px;
            padding: 10px;
            background: #f8f9fa;
            border-radius: 8px;
            border: 1px solid #e0e0e0;
          }
          .message {
            margin: 10px 0;
            padding: 10px 15px;
            border-radius: 12px;
            max-width: 70%;
            word-wrap: break-word;
          }
          .message-incoming {
            background: #e3f2fd;
            margin-right: auto;
            border-bottom-left-radius: 4px;
          }
          .message-outgoing {
            background: #dcf8c6;
            margin-left: auto;
            text-align: right;
            border-bottom-right-radius: 4px;
          }
          .message-time { font-size: 11px; color: #666; margin-top: 4px; }
          .message-sender { font-weight: 600; font-size: 12px; color: #555; margin-bottom: 4px; }
          textarea {
            width: 100%;
            min-height: 150px;
            padding: 12px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            font-size: 16px;
            font-family: inherit;
            resize: vertical;
            box-sizing: border-box;
          }
          textarea:focus { outline: none; border-color: #25D366; }
          .button-group { display: flex; gap: 10px; margin-top: 20px; }
          button {
            flex: 1;
            padding: 12px 24px;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
          }
          .send-btn { background: #25D366; color: white; }
          .send-btn:hover:not(:disabled) {
            background: #128C7E;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(37, 211, 102, 0.3);
          }
          .send-btn:disabled { background: #9ca3af; cursor: not-allowed; }
          .cancel-btn { background: #f3f4f6; color: #374151; }
          .cancel-btn:hover { background: #e5e7eb; }
          .success-message {
            display: none;
            background: #10b981;
            color: white;
            padding: 15px;
            border-radius: 8px;
            margin-top: 20px;
            text-align: center;
            font-weight: 600;
          }
          .error-message {
            display: none;
            background: #ef4444;
            color: white;
            padding: 15px;
            border-radius: 8px;
            margin-top: 20px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">📱 Reply to WhatsApp</div>
          <div class="content">
            <div class="info-box">
              <div class="info-row"><span class="info-label">Customer:</span> ${customerName}</div>
              ${customerCompany ? `<div class="info-row"><span class="info-label">Company:</span> ${customerCompany}</div>` : ''}
              <div class="info-row"><span class="info-label">Phone:</span> ${phone}</div>
            </div>

            ${formattedHistory.length > 0 ? `
            <h3>📜 Recent Messages</h3>
            <div class="message-history" id="messageHistory">
              ${formattedHistory.map(msg => `
                <div class="message message-${msg.direction}">
                  <div class="message-sender">${msg.senderName}</div>
                  <div class="message-text">${msg.text}</div>
                  <div class="message-time">${msg.timestamp}</div>
                </div>
              `).join('')}
            </div>
            ` : '<p style="color: #666;">No recent messages available</p>'}

            <form id="replyForm" action="/reply-wa/${phone}" method="POST">
              <label for="replyText"><strong>Your Reply:</strong></label>
              <textarea id="replyText" name="replyText" placeholder="Type your message to the customer..." required></textarea>

              <div class="button-group">
                <button type="button" class="cancel-btn" onclick="window.close()">Cancel</button>
                <button type="submit" class="send-btn" id="sendBtn">📤 Send Reply</button>
              </div>
            </form>

            <div class="success-message" id="successMessage">
              ✅ Reply sent successfully! You can close this window.
            </div>
            <div class="error-message" id="errorMessage"></div>

            <!-- Close Escalation button -->
            <form action="/api/close-escalation" method="POST" style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee;">
              <input type="hidden" name="phone" value="${phone}">
              <input type="hidden" name="redirect" value="/reply-wa/${phone}">
              <button type="submit" style="
                width: 100%;
                padding: 12px;
                background: #4CAF50;
                color: white;
                border: none;
                border-radius: 8px;
                font-size: 14px;
                cursor: pointer;
              ">
                ✅ Close Escalation (Allow AI to respond again)
              </button>
              <p style="font-size: 12px; color: #666; margin-top: 8px; text-align: center;">
                Click this when you're done helping the customer.
              </p>
            </form>

            ${req.query.sent === 'true' ? '<div style="background: #e8f5e9; color: #2e7d32; padding: 10px; border-radius: 8px; margin-top: 10px; text-align: center;">✅ Message sent!</div>' : ''}
            ${req.query.escalation_closed === 'true' ? '<div style="background: #e8f5e9; color: #2e7d32; padding: 10px; border-radius: 8px; margin-top: 10px; text-align: center;">✅ Escalation closed! AI will respond to new messages.</div>' : ''}
          </div>
        </div>

        <script>
          const form = document.getElementById('replyForm');
          const textarea = document.getElementById('replyText');
          const sendBtn = document.getElementById('sendBtn');
          const successMessage = document.getElementById('successMessage');
          const errorMessage = document.getElementById('errorMessage');

          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            sendBtn.disabled = true;
            sendBtn.textContent = '🔄 Sending...';
            errorMessage.style.display = 'none';

            try {
              const response = await fetch(form.action, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ replyText: textarea.value })
              });

              const result = await response.json();

              if (result.success) {
                successMessage.style.display = 'block';
                form.style.display = 'none';
              } else {
                throw new Error(result.error || 'Failed to send reply');
              }
            } catch (error) {
              errorMessage.textContent = '❌ Error: ' + error.message;
              errorMessage.style.display = 'block';
              sendBtn.disabled = false;
              sendBtn.textContent = '📤 Send Reply';
            }
          });

          textarea.focus();
          const messageHistory = document.getElementById('messageHistory');
          if (messageHistory) {
            messageHistory.scrollTop = messageHistory.scrollHeight;
          }
        </script>
      </body>
      </html>
    `);

  } catch (error) {
    console.error('[reply-wa] Error:', error.message);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Error</title></head>
      <body style="font-family: sans-serif; padding: 40px; text-align: center;">
        <h1>❌ Error</h1>
        <p>${error.message}</p>
      </body>
      </html>
    `);
  }
});

// POST handler for reply-wa
app.post('/reply-wa/:phone', express.json(), async (req, res) => {
  const { phone } = req.params;
  const { replyText } = req.body;

  console.log(`[reply-wa POST] Sending reply to phone: ${phone}`);

  if (!replyText || replyText.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Reply text is required'
    });
  }

  try {
    // Send via WhatsApp
    const result = await sendWhatsAppMessage(phone, replyText);

    if (result.success) {
      // Store in message history
      const cleanPhone = normalizePhoneNumber(phone);
      storeMessage(cleanPhone, replyText, 'outgoing', 'whatsapp', {
        senderName: 'BMAsia Support (Team)',
        source: 'reply_portal_wa'
      });

      console.log(`[reply-wa POST] ✅ Reply sent successfully to ${phone}`);

      res.json({
        success: true,
        message: 'Reply sent successfully'
      });
    } else {
      throw new Error(result.error || 'Failed to send WhatsApp message');
    }
  } catch (error) {
    console.error('[reply-wa POST] Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to send reply'
    });
  }
});

// =====================================================
// LIVE REPLY CHAT - Real-time conversation interface
// =====================================================

// API endpoint for fetching messages (used by live chat polling)
app.get('/api/messages/:phone', async (req, res) => {
  const { phone } = req.params;

  try {
    const history = getHistory(phone) || [];
    const escalationInfo = getEscalationInfo(phone);
    const customerProfile = await getProfile(phone);
    const remainingTime = getRemainingTime(phone);
    const isCurrentlyEscalated = isEscalated(phone);

    const customerName = customerProfile?.name || escalationInfo?.customerName || phone;
    const customerCompany = customerProfile?.company || null;

    const messages = history.map(msg => ({
      text: msg.text || '',
      direction: msg.direction,
      timestamp: msg.timestamp,
      formattedTime: new Date(msg.timestamp).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Bangkok'
      }),
      senderName: msg.direction === 'incoming' ? customerName : 'BMAsia Support'
    })).filter(m => m.text.trim());

    res.json({
      success: true,
      messages,
      customerName,
      customerCompany,
      isEscalated: isCurrentlyEscalated,
      remainingTimeMs: remainingTime,
      escalationTimeoutMs: ESCALATION_TIMEOUT_MS
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Live chat interface - auto-refreshes messages
app.get('/reply-live/:phone', async (req, res) => {
  const { phone } = req.params;
  console.log(`[reply-live] Loading live chat for phone: ${phone}`);

  try {
    const escalationInfo = getEscalationInfo(phone);
    const customerProfile = await getProfile(phone);
    const customerName = customerProfile?.name || escalationInfo?.customerName || phone;
    const customerCompany = customerProfile?.company || null;

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Chat with ${customerName}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f0f2f5;
            height: 100vh;
            display: flex;
            flex-direction: column;
          }
          .header {
            background: #075E54;
            color: white;
            padding: 15px 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
          }
          .header-left h1 {
            font-size: 18px;
            font-weight: 600;
          }
          .header-left .subtitle {
            font-size: 12px;
            opacity: 0.8;
            margin-top: 2px;
          }
          .status-badge {
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
          }
          .status-escalated {
            background: #fef3c7;
            color: #92400e;
          }
          .status-normal {
            background: #d1fae5;
            color: #065f46;
          }
          .timer {
            font-size: 11px;
            margin-top: 4px;
          }
          .messages-container {
            flex: 1;
            overflow-y: auto;
            padding: 20px;
            background: #e5ddd5;
            background-image: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='0.02'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
          }
          .message {
            margin: 8px 0;
            padding: 8px 12px;
            border-radius: 8px;
            max-width: 75%;
            word-wrap: break-word;
            position: relative;
            box-shadow: 0 1px 0.5px rgba(0,0,0,0.13);
          }
          .message-incoming {
            background: white;
            margin-right: auto;
            border-top-left-radius: 0;
          }
          .message-outgoing {
            background: #dcf8c6;
            margin-left: auto;
            border-top-right-radius: 0;
          }
          .message-text { font-size: 14px; line-height: 1.4; }
          .message-meta {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-top: 4px;
          }
          .message-sender { font-weight: 600; font-size: 11px; color: #075E54; }
          .message-time { font-size: 11px; color: #667781; }
          .input-container {
            background: #f0f2f5;
            padding: 10px 20px;
            display: flex;
            gap: 10px;
            align-items: flex-end;
          }
          .input-box {
            flex: 1;
            background: white;
            border-radius: 25px;
            padding: 10px 15px;
            display: flex;
            align-items: center;
          }
          textarea {
            flex: 1;
            border: none;
            outline: none;
            font-size: 15px;
            resize: none;
            max-height: 100px;
            font-family: inherit;
          }
          .send-btn {
            width: 50px;
            height: 50px;
            border-radius: 50%;
            background: #075E54;
            border: none;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.2s;
          }
          .send-btn:hover { background: #128C7E; }
          .send-btn:disabled { background: #9ca3af; cursor: not-allowed; }
          .send-btn svg { width: 24px; height: 24px; fill: white; }
          .notification {
            position: fixed;
            top: 70px;
            right: 20px;
            padding: 12px 20px;
            border-radius: 8px;
            font-size: 14px;
            animation: slideIn 0.3s ease;
            z-index: 100;
          }
          .notification-success { background: #10b981; color: white; }
          .notification-error { background: #ef4444; color: white; }
          @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }
          .new-message-indicator {
            display: none;
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: #075E54;
            color: white;
            padding: 8px 16px;
            border-radius: 20px;
            font-size: 13px;
            cursor: pointer;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
          }
          .empty-state {
            text-align: center;
            padding: 40px;
            color: #667781;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="header-left">
            <h1>📱 ${customerName}</h1>
            <div class="subtitle">${customerCompany ? customerCompany + ' • ' : ''}${phone}</div>
          </div>
          <div>
            <div class="status-badge" id="statusBadge">Loading...</div>
            <div class="timer" id="timerDisplay"></div>
          </div>
        </div>

        <div class="messages-container" id="messagesContainer">
          <div class="empty-state" id="emptyState">Loading messages...</div>
        </div>

        <div class="new-message-indicator" id="newMessageIndicator" onclick="scrollToBottom()">
          ↓ New messages
        </div>

        <div class="input-container">
          <div class="input-box">
            <textarea id="messageInput" placeholder="Type a message..." rows="1" onkeydown="handleKeyDown(event)"></textarea>
          </div>
          <button class="send-btn" id="sendBtn" onclick="sendMessage()">
            <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          </button>
        </div>

        <script>
          const phone = '${phone}';
          let lastMessageCount = 0;
          let isAtBottom = true;
          let remainingTimeMs = 0;
          let timerInterval = null;

          // Track scroll position
          const container = document.getElementById('messagesContainer');
          container.addEventListener('scroll', () => {
            const threshold = 100;
            isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
            if (isAtBottom) {
              document.getElementById('newMessageIndicator').style.display = 'none';
            }
          });

          function scrollToBottom() {
            container.scrollTop = container.scrollHeight;
            document.getElementById('newMessageIndicator').style.display = 'none';
          }

          function formatTime(ms) {
            if (ms <= 0) return '0:00';
            const minutes = Math.floor(ms / 60000);
            const seconds = Math.floor((ms % 60000) / 1000);
            return minutes + ':' + seconds.toString().padStart(2, '0');
          }

          function updateTimer() {
            if (remainingTimeMs > 0) {
              remainingTimeMs -= 1000;
              document.getElementById('timerDisplay').textContent = 'Agent resumes in ' + formatTime(remainingTimeMs);
              if (remainingTimeMs <= 0) {
                fetchMessages(); // Refresh status
              }
            }
          }

          async function fetchMessages() {
            try {
              const res = await fetch('/api/messages/' + phone);
              const data = await res.json();

              if (!data.success) throw new Error(data.error);

              // Update status badge
              const badge = document.getElementById('statusBadge');
              if (data.isEscalated) {
                badge.className = 'status-badge status-escalated';
                badge.textContent = '⏸️ Escalated';
                remainingTimeMs = data.remainingTimeMs;
                document.getElementById('timerDisplay').textContent = 'Agent resumes in ' + formatTime(remainingTimeMs);
              } else {
                badge.className = 'status-badge status-normal';
                badge.textContent = '🤖 AI Active';
                document.getElementById('timerDisplay').textContent = '';
                remainingTimeMs = 0;
              }

              // Update messages
              const messagesHtml = data.messages.length > 0 ? data.messages.map(msg =>
                '<div class="message message-' + msg.direction + '">' +
                  '<div class="message-text">' + escapeHtml(msg.text) + '</div>' +
                  '<div class="message-meta">' +
                    '<span class="message-sender">' + escapeHtml(msg.senderName) + '</span>' +
                    '<span class="message-time">' + msg.formattedTime + '</span>' +
                  '</div>' +
                '</div>'
              ).join('') : '<div class="empty-state">No messages yet</div>';

              container.innerHTML = messagesHtml;

              // Handle new messages
              if (data.messages.length > lastMessageCount && lastMessageCount > 0) {
                if (isAtBottom) {
                  scrollToBottom();
                } else {
                  document.getElementById('newMessageIndicator').style.display = 'block';
                }
              }
              lastMessageCount = data.messages.length;

              // Auto-scroll on first load
              if (lastMessageCount === data.messages.length && isAtBottom) {
                scrollToBottom();
              }

            } catch (error) {
              console.error('Error fetching messages:', error);
            }
          }

          function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
          }

          function showNotification(message, type) {
            const existing = document.querySelector('.notification');
            if (existing) existing.remove();

            const notif = document.createElement('div');
            notif.className = 'notification notification-' + type;
            notif.textContent = message;
            document.body.appendChild(notif);

            setTimeout(() => notif.remove(), 3000);
          }

          function handleKeyDown(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }

          async function sendMessage() {
            const input = document.getElementById('messageInput');
            const text = input.value.trim();
            if (!text) return;

            const sendBtn = document.getElementById('sendBtn');
            sendBtn.disabled = true;

            try {
              const res = await fetch('/reply-live/' + phone, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ replyText: text })
              });
              const data = await res.json();

              if (data.success) {
                input.value = '';
                showNotification('Message sent!', 'success');
                fetchMessages(); // Refresh immediately
              } else {
                throw new Error(data.error);
              }
            } catch (error) {
              showNotification('Failed to send: ' + error.message, 'error');
            } finally {
              sendBtn.disabled = false;
              input.focus();
            }
          }

          // Initial fetch and polling
          fetchMessages();
          setInterval(fetchMessages, 3000); // Poll every 3 seconds
          timerInterval = setInterval(updateTimer, 1000); // Update timer every second

          // Auto-resize textarea
          const textarea = document.getElementById('messageInput');
          textarea.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 100) + 'px';
          });
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('[reply-live] Error:', error.message);
    res.status(500).send('Error: ' + error.message);
  }
});

// POST handler for live chat - sends message AND extends escalation timer
app.post('/reply-live/:phone', express.json(), async (req, res) => {
  const { phone } = req.params;
  const { replyText } = req.body;

  console.log(`[reply-live POST] Sending reply to phone: ${phone}`);

  if (!replyText || replyText.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Reply text is required' });
  }

  try {
    // Send via WhatsApp
    const result = await sendWhatsAppMessage(phone, replyText);

    if (result.success) {
      // Store in message history
      const cleanPhone = normalizePhoneNumber(phone);
      storeMessage(cleanPhone, replyText, 'outgoing', 'whatsapp', {
        senderName: 'BMAsia Support (Team)',
        source: 'reply_live'
      });

      // Extend escalation timer - gives team 10 more minutes
      extendEscalation(phone);

      console.log(`[reply-live POST] ✅ Reply sent, escalation timer extended for ${phone}`);

      res.json({ success: true, message: 'Reply sent successfully' });
    } else {
      throw new Error(result.error || 'Failed to send WhatsApp message');
    }
  } catch (error) {
    console.error('[reply-live POST] Error:', error.message);
    res.status(500).json({ success: false, error: error.message || 'Failed to send reply' });
  }
});

// =====================================================
// WHATSAPP WEBHOOKS
// =====================================================

// WhatsApp webhook verification
app.get('/webhooks/whatsapp', (req, res) => {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'bma_whatsapp_verify_2024';
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('WhatsApp webhook verified');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// WhatsApp webhook messages
app.post('/webhooks/whatsapp', async (req, res) => {
  try {
    console.log('WhatsApp webhook received:', JSON.stringify(req.body, null, 2));

    // Parse the WhatsApp message
    const parsedMessage = parseWhatsAppMessage(req.body);

    if (parsedMessage && isValidMessage(parsedMessage)) {
      console.log('Parsed WhatsApp message:', parsedMessage);

      // Store incoming message in history (normalize phone for consistent storage)
      const rawPhone = parsedMessage.phoneNumber || parsedMessage.senderId;
      const phoneNumber = normalizePhoneNumber(rawPhone);
      if (phoneNumber) {
        storeMessage(
          phoneNumber,
          parsedMessage.messageText,
          'incoming',
          'whatsapp',
          {
            senderName: parsedMessage.senderName,
            messageId: parsedMessage.messageId
          }
        );
      }

      // Check if this is a new customer or needs info
      const customerIdentifier = phoneNumber;

      // ============================================================
      // WHATSAPP AUTO-GREETING DISABLED
      // ElevenLabs Conversational AI agent now handles greetings
      // and info gathering for WhatsApp. This prevents double
      // welcome messages being sent to customers.
      // To re-enable, set ENABLE_WHATSAPP_AUTO_GREETING=true
      // ============================================================
      const enableWhatsAppAutoGreeting = process.env.ENABLE_WHATSAPP_AUTO_GREETING === 'true';

      if (enableWhatsAppAutoGreeting) {
        // Check if message should bypass info gathering (urgent messages)
        const bypassGathering = shouldBypass(parsedMessage.messageText);

        if (isNewCustomer(customerIdentifier) && !bypassGathering) {
          // Initialize new customer
          initializeCustomer(customerIdentifier, 'whatsapp');
          incrementMessageCount(customerIdentifier);

          // Check if we already sent info request
          if (!wasInfoRequestSent(customerIdentifier)) {
            // Generate and send info request
            const language = await detectLanguage(parsedMessage.messageText);
            const infoRequestMessage = await generateInfoRequest('whatsapp', parsedMessage.messageText, language);

            // Send automated response asking for info
            await sendWhatsAppInfoRequest(phoneNumber, infoRequestMessage);
            markInfoRequestSent(customerIdentifier);

            console.log(`🤖 Sent info request to new customer: ${phoneNumber}`);

            // Store the automated response in message history
            storeMessage(
              phoneNumber,
              infoRequestMessage,
              'outgoing',
              'whatsapp',
              {
                senderName: 'BMA Bot',
                automated: true
              }
            );
          }

          // Don't forward to Google Chat yet - wait for customer info
          console.log('⏸️ Holding message - waiting for customer info');
          res.sendStatus(200);
          return;
        }

        // Check if we're currently gathering info
        if (needsInfo(customerIdentifier) && !bypassGathering) {
          incrementMessageCount(customerIdentifier);

          // Try to parse customer info from their response
          const parsedInfo = await parseCustomerInfo(parsedMessage.messageText);

          if (parsedInfo.name || parsedInfo.businessName) {
            // Store what we got
            storeCustomerInfo(customerIdentifier, {
              name: parsedInfo.name,
              businessName: parsedInfo.businessName
            });

            // Check if we need more info
            if (parsedInfo.needsMoreInfo) {
              const language = await detectLanguage(parsedMessage.messageText);
              const followUp = await generateFollowUp(parsedInfo, language);

              if (followUp) {
                await sendWhatsAppInfoRequest(phoneNumber, followUp);
                console.log(`🤖 Sent follow-up question to customer: ${phoneNumber}`);

                // Store the follow-up in message history
                storeMessage(
                  phoneNumber,
                  followUp,
                  'outgoing',
                  'whatsapp',
                  {
                    senderName: 'BMA Bot',
                    automated: true
                  }
                );

                res.sendStatus(200);
                return;
              }
            }

            // We have enough info - mark as complete
            updateState(customerIdentifier, 'complete');
            console.log(`✅ Customer info complete for: ${phoneNumber}`);
          }
        }
      } else {
        console.log('ℹ️ WhatsApp auto-greeting disabled (ElevenLabs handles greetings)');
      }

      // Get customer info if available
      const customerInfo = getCustomerInfo(customerIdentifier) || {};

      // Translate message if needed
      const translation = await translateMessage(parsedMessage.messageText);
      console.log(`Translation result: ${translation.isTranslated ? 'translated from ' + translation.originalLanguage : 'no translation needed'}`);

      // Debug log for translation
      if (translation.error) {
        console.error('Translation error:', translation.error);
      }
      if (translation.isTranslated) {
        console.log('Translated text preview:', translation.translatedText.substring(0, 100));
      }

      // ============================================================
      // ESCALATION HANDLING
      // Messages are stored in message-history and visible in /reply-live interface
      // We do NOT forward individual messages to Google Chat (too noisy)
      // Google Chat only receives the initial escalation alert
      // ============================================================

      // Check if this customer is escalated
      const escalationInfo = getEscalationInfo(phoneNumber);

      if (escalationInfo) {
        // Customer is escalated - message already stored, team sees it in live chat
        console.log(`📥 WhatsApp message from escalated customer ${phoneNumber} - visible in live chat`);
      } else {
        // Normal flow - ElevenLabs handles response
        console.log('WhatsApp message received - ElevenLabs handles response');
      }

      // Store conversation mapping for reply portal (without sending to GChat)
      const enrichedSenderInfo = {
        ...parsedMessage,
        messageText: parsedMessage.messageText,
        customerName: customerInfo.name || parsedMessage.senderName,
        customerBusiness: customerInfo.businessName
      };

      // Note: Conversation will be stored when escalation happens via ElevenLabs webhook
    } else {
      console.log('WhatsApp message could not be parsed or is invalid');
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Error processing WhatsApp webhook:', error);
    // Don't crash the service - just log and respond
    res.sendStatus(200);
  }
});

// LINE webhook
app.post('/webhooks/line', async (req, res) => {
  try {
    console.log('LINE webhook received:', JSON.stringify(req.body, null, 2));

    // Parse the LINE message
    const parsedMessage = parseLineMessage(req.body);

    if (parsedMessage && isValidMessage(parsedMessage)) {
      console.log('Parsed LINE message:', parsedMessage);

      // Store incoming message in history
      const userId = parsedMessage.senderId;
      const customerIdentifier = userId; // For LINE, use userId as identifier

      if (userId) {
        storeMessage(
          userId,
          parsedMessage.messageText,
          'incoming',
          'line',
          {
            senderName: parsedMessage.senderName,
            messageId: parsedMessage.messageId
          }
        );

        // Increment message count for customer
        incrementMessageCount(customerIdentifier);
      }

      // Check if message should bypass info gathering (urgent keywords)
      const bypassGathering = shouldBypass(parsedMessage.messageText);

      // Check if this is a new customer
      if (isNewCustomer(customerIdentifier) && !bypassGathering) {
        // Initialize new customer
        initializeCustomer(customerIdentifier, 'line');

        // Check if we already sent info request
        if (!wasInfoRequestSent(customerIdentifier)) {
          // Detect language for the info request
          const language = await detectLanguage(parsedMessage.messageText);

          // Generate AI info request
          const infoRequestMessage = await generateInfoRequest('line', parsedMessage.messageText, language);

          // Send info request to LINE user
          const infoResult = await sendLineInfoRequest(userId, infoRequestMessage);

          // Mark that we sent the info request
          markInfoRequestSent(customerIdentifier);

          // Store outgoing info request in history
          if (infoResult.success) {
            storeMessage(
              userId,
              infoRequestMessage,
              'outgoing',
              'line',
              { type: 'info_request' }
            );
          }

          console.log(`🤖 Sent info request to new LINE customer: ${userId}`);
          res.sendStatus(200);
          return; // Don't forward to Google Chat yet
        }
      }

      // Check if customer is in gathering state
      if (needsInfo(customerIdentifier)) {
        // Try to parse customer info from their response
        const parsedInfo = await parseCustomerInfo(parsedMessage.messageText);

        if (parsedInfo && (parsedInfo.name || parsedInfo.businessName)) {
          // Store the customer info
          storeCustomerInfo(customerIdentifier, {
            name: parsedInfo.name,
            businessName: parsedInfo.businessName
          });

          console.log(`✅ Customer info complete for LINE user: ${userId}`);
        }

        // Check if we need follow-up
        if (parsedInfo && parsedInfo.needsMoreInfo) {
          const language = await detectLanguage(parsedMessage.messageText);
          const followUp = await generateFollowUp(parsedInfo, language);

          if (followUp) {
            await sendLineInfoRequest(userId, followUp);
            storeMessage(userId, followUp, 'outgoing', 'line', { type: 'follow_up' });
            console.log(`📝 Sent follow-up question to LINE user: ${userId}`);
            res.sendStatus(200);
            return; // Still gathering info
          }
        }
      }

      // Get customer info for enrichment
      const customerInfo = getCustomerInfo(customerIdentifier);

      // Translate message if needed
      const translation = await translateMessage(parsedMessage.messageText);
      console.log(`Translation result: ${translation.isTranslated ? 'translated from ' + translation.originalLanguage : 'no translation needed'}`);

      // Debug log for translation
      if (translation.error) {
        console.error('Translation error:', translation.error);
      }
      if (translation.isTranslated) {
        console.log('Translated text preview:', translation.translatedText.substring(0, 100));
      }

      // No routing needed - all messages go to single BMA Chat Support space
      console.log('Forwarding LINE message to BMA Chat Support space');

      // Send the translated text (or original if no translation) to Google Chat
      const messageToSend = translation.isTranslated ? translation.translatedText : parsedMessage.messageText;
      // Include customer info and original message in senderInfo for reply portal
      const enrichedSenderInfo = {
        ...parsedMessage,
        messageText: parsedMessage.messageText,  // Keep original message for reply context
        customerName: customerInfo?.name,
        customerBusiness: customerInfo?.businessName
      };
      await sendMessage(SINGLE_SPACE_ID, messageToSend, enrichedSenderInfo);
      console.log(`LINE message forwarded to BMA Chat Support space with customer info`);
    } else {
      console.log('LINE message could not be parsed or is invalid');
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Error processing LINE webhook:', error);
    // Don't crash the service - just log and respond
    res.sendStatus(200);
  }
});

// Google Chat webhook
app.post('/webhooks/google-chat', async (req, res) => {
  try {
    await processGoogleChatWebhook(req, res);
  } catch (error) {
    console.error('Error processing Google Chat webhook:', error);
    res.status(200).json({
      text: `❌ Error processing message: ${error.message}`
    });
  }
});

// ElevenLabs post-call webhook - receives conversation transcripts
// NOTE: We don't send these to Google Chat anymore to avoid duplicate messages.
// The escalation alert already handles notifications, and the reply portal shows full transcript.
app.post('/webhooks/elevenlabs', async (req, res) => {
  try {
    console.log('📞 ElevenLabs webhook received');

    const { type, data } = req.body;

    // Handle post_call_transcription events (just log, don't send to Google Chat)
    if (type === 'post_call_transcription' && data) {
      const { agent_id, conversation_id, transcript, metadata } = data;

      console.log(`ElevenLabs conversation completed: ${conversation_id}`);
      console.log(`Agent: ${agent_id}, Messages: ${transcript?.length || 0}`);

      // Log duration for analytics
      if (metadata) {
        const durationSecs = metadata.call_duration_secs || 0;
        const minutes = Math.floor(durationSecs / 60);
        const seconds = durationSecs % 60;
        console.log(`Duration: ${minutes}m ${seconds}s`);
      }

      // Transcript is available via ElevenLabs API when needed (reply portal fetches it)
      // No need to send duplicate message to Google Chat
    } else if (type === 'call_initiation_failure' && data) {
      // Log failed calls
      console.log(`⚠️ ElevenLabs call initiation failed: ${data.failure_reason || 'Unknown reason'}`);
    }

    // Always return 200 to acknowledge receipt
    res.sendStatus(200);
  } catch (error) {
    console.error('Error processing ElevenLabs webhook:', error);
    // Still return 200 to prevent webhook retries
    res.sendStatus(200);
  }
});

// ElevenLabs agent response log - stores agent messages in history
// NOTE: Does NOT send to Google Chat to avoid duplicate messages
// Google Chat only receives: Customer message (from /webhooks/whatsapp) + Escalation alert
app.post('/webhooks/elevenlabs/log-response', async (req, res) => {
  try {
    console.log('💬 ElevenLabs agent response log received');

    const {
      agent_message,
      customer_phone,
      conversation_id
    } = req.body;

    if (!agent_message) {
      return res.json({ success: true, message: 'No message to log' });
    }

    // Store agent message in history for reply portal (with normalized phone)
    if (customer_phone) {
      const normalizedPhone = normalizePhoneNumber(customer_phone);
      if (normalizedPhone) {
        storeMessage(
          normalizedPhone,
          agent_message,
          'outgoing',
          'whatsapp',
          {
            senderName: 'BMAsia Support',
            source: 'elevenlabs_log_response',
            conversationId: conversation_id
          }
        );
        console.log(`✅ Agent message stored for ${normalizedPhone}`);
      }
    } else {
      console.log('⚠️ No customer_phone provided, cannot store agent message');
    }

    res.json({ success: true, message: 'Response stored' });
  } catch (error) {
    console.error('Error logging agent response:', error);
    res.json({ success: true, message: 'Error handled' });
  }
});

// ElevenLabs escalation webhook - immediate alert when agent needs to escalate
app.post('/webhooks/elevenlabs/escalate', async (req, res) => {
  try {
    console.log('🚨 ElevenLabs escalation webhook received');
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    const {
      customer_phone,
      customer_name,
      customer_company,
      customer_email,
      issue_summary,
      escalation_reason,
      conversation_id,
      urgency,
      conversation_history
    } = req.body;

    // Try to get phone number - either from webhook or from ElevenLabs conversation API
    let actualPhone = customer_phone;

    // If no phone provided but we have conversation_id, fetch from ElevenLabs API
    if (!actualPhone && conversation_id) {
      console.log('No customer_phone provided - fetching from ElevenLabs conversation API...');
      const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || 'sk_42e0e37fe9ef457906b11dce0ac6ea5262a005ec2ce0ca6e';

      try {
        const convResponse = await axios.get(
          `https://api.elevenlabs.io/v1/convai/conversations/${conversation_id}`,
          { headers: { 'xi-api-key': ELEVENLABS_API_KEY } }
        );

        const whatsappUserId = convResponse.data?.metadata?.whatsapp?.whatsapp_user_id;
        if (whatsappUserId) {
          actualPhone = whatsappUserId;
          console.log(`✅ Found phone from ElevenLabs: ${actualPhone}`);
        }
      } catch (err) {
        console.log('Could not fetch phone from ElevenLabs:', err.message);
      }
    }

    // If STILL no phone, look up most recent ElevenLabs WhatsApp conversation
    if (!actualPhone) {
      console.log('Still no phone - looking up most recent ElevenLabs conversation...');
      const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || 'sk_42e0e37fe9ef457906b11dce0ac6ea5262a005ec2ce0ca6e';
      const ELEVENLABS_AGENT_ID = process.env.ELEVENLABS_AGENT_ID || 'agent_8501kesasj5fe8b8rm6nnxcvn4kb';

      try {
        const listResponse = await axios.get(
          `https://api.elevenlabs.io/v1/convai/conversations?agent_id=${ELEVENLABS_AGENT_ID}&page_size=1`,
          { headers: { 'xi-api-key': ELEVENLABS_API_KEY } }
        );

        if (listResponse.data?.conversations?.length > 0) {
          const recentConvId = listResponse.data.conversations[0].conversation_id;
          console.log(`Found recent ElevenLabs conversation: ${recentConvId}`);

          // Get conversation details to extract phone
          const convResponse = await axios.get(
            `https://api.elevenlabs.io/v1/convai/conversations/${recentConvId}`,
            { headers: { 'xi-api-key': ELEVENLABS_API_KEY } }
          );

          const whatsappUserId = convResponse.data?.metadata?.whatsapp?.whatsapp_user_id;
          if (whatsappUserId) {
            actualPhone = whatsappUserId;
            console.log(`✅ Found phone from recent conversation: ${actualPhone}`);
          }
        }
      } catch (err) {
        console.log('Could not fetch recent conversation:', err.message);
      }
    }

    // Generate a message storage identifier (will be determined after conversation creation)
    // This ensures messages are stored under the same key used by the reply portal
    let messageStorageId = actualPhone ? normalizePhoneNumber(actualPhone) : null;

    // Parse conversation_history into messages (even if no phone - we'll store them later)
    let parsedMessages = [];
    if (conversation_history) {
      console.log('Parsing conversation_history from escalation...');
      const lines = conversation_history.split('\n').filter(line => line.trim());

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith('Customer:')) {
          parsedMessages.push({ type: 'customer', text: trimmedLine.replace(/^Customer:\s*/, '').trim() });
        } else if (trimmedLine.startsWith('Agent:')) {
          parsedMessages.push({ type: 'agent', text: trimmedLine.replace(/^Agent:\s*/, '').trim() });
        }
      }
      console.log(`Parsed ${parsedMessages.length} messages from conversation_history`);
    } else {
      // Fallback: try to fetch from ElevenLabs API (works for completed conversations)
      const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || 'sk_42e0e37fe9ef457906b11dce0ac6ea5262a005ec2ce0ca6e';
      const ELEVENLABS_AGENT_ID = process.env.ELEVENLABS_AGENT_ID || 'agent_8501kesasj5fe8b8rm6nnxcvn4kb';

      let elevenlabsConversationId = conversation_id;

      if (!elevenlabsConversationId && customer_phone) {
        try {
          console.log('Looking up recent ElevenLabs conversations...');
          const listResponse = await axios.get(
            `https://api.elevenlabs.io/v1/convai/conversations?agent_id=${ELEVENLABS_AGENT_ID}&page_size=5`,
            { headers: { 'xi-api-key': ELEVENLABS_API_KEY } }
          );
          if (listResponse.data?.conversations?.length > 0) {
            elevenlabsConversationId = listResponse.data.conversations[0].conversation_id;
            console.log(`Found recent ElevenLabs conversation: ${elevenlabsConversationId}`);
          }
        } catch (err) {
          console.log('Could not fetch ElevenLabs conversations list:', err.message);
        }
      }

      if (elevenlabsConversationId && customer_phone) {
        try {
          console.log(`Fetching transcript for conversation: ${elevenlabsConversationId}`);
          const convResponse = await axios.get(
            `https://api.elevenlabs.io/v1/convai/conversations/${elevenlabsConversationId}`,
            { headers: { 'xi-api-key': ELEVENLABS_API_KEY } }
          );

          const transcript = convResponse.data?.transcript || [];
          const cleanPhone = normalizePhoneNumber(customer_phone);

          let agentMessagesStored = 0;
          for (const entry of transcript) {
            if (entry.role === 'agent' && entry.message) {
              storeMessage(cleanPhone, entry.message, 'outgoing', 'whatsapp', {
                senderName: 'BMAsia Support',
                source: 'elevenlabs'
              });
              agentMessagesStored++;
            }
          }
          console.log(`Stored ${agentMessagesStored} agent messages from ElevenLabs transcript`);
        } catch (err) {
          console.log('Could not fetch ElevenLabs transcript:', err.message);
        }
      }
    }

    // Save customer profile if we have any customer info
    // This allows us to remember returning customers
    if (actualPhone && (customer_name || customer_company || customer_email)) {
      console.log('💾 Saving customer profile from escalation...');
      await saveProfile(actualPhone, {
        name: customer_name,
        company: customer_company,
        email: customer_email
      });
    }

    // Try to find or create conversation for reply link
    let replyLink = null;
    let conversation = null;

    if (actualPhone) {
      const cleanPhone = normalizePhoneNumber(actualPhone);
      console.log(`Looking up conversation for phone: ${cleanPhone}`);

      // Look up existing conversation
      conversation = getConversationByUser('whatsapp', cleanPhone);

      // If no conversation exists, create one for this escalation
      if (!conversation) {
        console.log(`No existing conversation - creating one for escalation`);
        const conversationId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Store conversation for reply portal
        storeConversation(
          'whatsapp',
          cleanPhone,
          null, // No Google Chat thread yet
          SINGLE_SPACE_ID,
          {
            platform: 'whatsapp',
            senderId: cleanPhone,
            phoneNumber: cleanPhone,
            senderName: customer_name || null,
            customerName: customer_name || null,
            customerBusiness: customer_company || null
          },
          conversationId
        );

        conversation = { id: conversationId, userId: cleanPhone };
        console.log(`Created conversation: ${conversationId}`);
      }
    } else {
      // No phone provided (and couldn't get from ElevenLabs) - try to find most recent WhatsApp conversation
      console.log('No phone available - looking up most recent WhatsApp conversation');
      conversation = getMostRecentConversation('whatsapp');

      // If still no conversation found, CREATE one anyway so reply link is always available
      if (!conversation) {
        console.log('No recent conversation found - creating one for escalation');
        const conversationId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const tempUserId = `escalation_${Date.now()}`;

        storeConversation(
          'whatsapp',
          tempUserId,
          null,
          SINGLE_SPACE_ID,
          {
            platform: 'whatsapp',
            senderId: tempUserId,
            senderName: customer_name || null,
            customerName: customer_name || null,
            customerBusiness: customer_company || null
          },
          conversationId
        );

        conversation = { id: conversationId, userId: tempUserId };
        console.log(`Created fallback conversation: ${conversationId} with userId: ${tempUserId}`);
      }
    }

    if (conversation) {
      // Use /reply-live with phone number for the best experience
      // Falls back to ElevenLabs conversation_id or local ID if no phone
      if (actualPhone) {
        const cleanPhone = actualPhone.replace(/^\+/, '');
        replyLink = `https://bma-messenger-hub-ooyy.onrender.com/reply-live/${cleanPhone}`;
        console.log(`Reply link (live chat): ${replyLink}`);
      } else if (conversation_id) {
        replyLink = `https://bma-messenger-hub-ooyy.onrender.com/reply-el/${conversation_id}`;
        console.log(`Reply link (ElevenLabs-based fallback): ${replyLink}`);
      } else {
        replyLink = `https://bma-messenger-hub-ooyy.onrender.com/reply/${conversation.id}`;
        console.log(`Reply link (local fallback): ${replyLink}`);
      }

      // Now store the parsed messages using the conversation's userId as the storage key
      // This ensures messages are stored under the same key the reply portal will use
      const storageKey = conversation.userId || (actualPhone ? normalizePhoneNumber(actualPhone) : `escalation_${Date.now()}`);

      if (parsedMessages.length > 0) {
        console.log(`Storing ${parsedMessages.length} messages under key: ${storageKey}`);

        // Clear any existing messages to avoid duplicates
        clearOutgoingMessages(storageKey);

        // Store all messages with proper timestamps for chronological order
        let baseTimestamp = Date.now() - (parsedMessages.length * 1000); // Start 1 sec per message in past
        let messagesStored = 0;

        for (const msg of parsedMessages) {
          if (msg.text) {
            storeMessage(
              storageKey,
              msg.text,
              msg.type === 'customer' ? 'incoming' : 'outgoing',
              'whatsapp',
              {
                senderName: msg.type === 'customer' ? (customer_name || 'Customer') : 'BMAsia Support',
                source: 'elevenlabs_escalation'
              },
              baseTimestamp
            );
            baseTimestamp += 1000; // 1 second between messages
            messagesStored++;
          }
        }
        console.log(`✅ Stored ${messagesStored} messages from conversation_history`);
      }
    }

    // Try to get customer name from profile database if not provided in escalation
    let actualName = customer_name;
    let actualCompany = customer_company;

    if ((!actualName || !actualCompany) && actualPhone) {
      try {
        const profile = await getProfile(actualPhone);
        if (profile) {
          if (!actualName && profile.name) {
            actualName = profile.name;
            console.log(`Found customer name from profile: ${actualName}`);
          }
          if (!actualCompany && profile.company) {
            actualCompany = profile.company;
            console.log(`Found customer company from profile: ${actualCompany}`);
          }
        }
      } catch (err) {
        console.log('Could not look up customer profile:', err.message);
      }
    }

    // Format escalation alert for Google Chat
    let alertMessage = '🚨 *Escalation Alert - Customer Needs Assistance*\n\n';

    if (actualName) {
      alertMessage += `👤 *Name:* ${actualName}\n`;
    }
    if (actualCompany) {
      alertMessage += `🏢 *Company:* ${actualCompany}\n`;
    }
    if (actualPhone) {
      alertMessage += `📱 *Phone:* ${actualPhone}\n`;
    }
    if (customer_email) {
      alertMessage += `📧 *Email:* ${customer_email}\n`;
    }
    if (issue_summary) {
      alertMessage += `\n❓ *Issue:* ${issue_summary}\n`;
    }
    if (urgency) {
      const urgencyEmoji = urgency === 'high' ? '🔴' : urgency === 'medium' ? '🟡' : '🟢';
      alertMessage += `${urgencyEmoji} *Urgency:* ${urgency}\n`;
    }
    if (conversation_id) {
      alertMessage += `\n🔗 ElevenLabs Conv: \`${conversation_id}\`\n`;
    }

    // Add reply link - use portal for team responses (not direct WhatsApp)
    alertMessage += '\n---\n';
    if (replyLink) {
      alertMessage += `↩️ *Reply to customer:* <${replyLink}|Click here to respond>\n`;
    } else {
      alertMessage += '_Reply link not available - check recent messages in this space._\n';
    }

    // Add Close Escalation link (allows team to re-enable agent)
    if (actualPhone) {
      const closeEscalationUrl = `https://bma-messenger-hub-ooyy.onrender.com/api/close-escalation-web?phone=${encodeURIComponent(actualPhone)}`;
      alertMessage += `✅ *Done helping?* <${closeEscalationUrl}|Close Escalation>`;
    }

    // Send to Google Chat
    try {
      await sendMessage(SINGLE_SPACE_ID, alertMessage, {
        platform: 'elevenlabs',
        senderName: 'ElevenLabs Escalation',
        messageType: 'escalation_alert',
        isUrgent: urgency === 'high'
      });
      console.log('✅ Escalation alert sent to Google Chat');

      // Mark this phone number as escalated so agent defers to team on future messages
      if (actualPhone) {
        markEscalated(
          actualPhone,
          conversation?.threadId || null,
          actualName,
          conversation_id,
          parsedMessages
        );
        console.log(`✅ Phone ${actualPhone} marked as escalated`);

        // Archive the ElevenLabs agent to stop ALL responses during escalation
        try {
          const archiveRes = await fetch(
            `https://api.elevenlabs.io/v1/convai/agents/${process.env.ELEVENLABS_AGENT_ID}`,
            {
              method: 'PATCH',
              headers: {
                'xi-api-key': process.env.ELEVENLABS_API_KEY,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                platform_settings: {
                  archived: true
                }
              })
            }
          );

          if (archiveRes.ok) {
            console.log('✅ Agent ARCHIVED - no responses until escalation closed');
          } else {
            console.error('⚠️ Failed to archive agent:', await archiveRes.text());
          }
        } catch (archiveErr) {
          console.error('⚠️ Error archiving agent:', archiveErr.message);
        }
      }

      // Return success response for ElevenLabs
      res.json({
        success: true,
        message: 'Escalation alert sent to support team',
        escalated_to: 'Google Chat - BMA Support'
      });
    } catch (chatError) {
      console.error('Failed to send escalation to Google Chat:', chatError.message);
      res.status(500).json({
        success: false,
        error: 'Failed to notify support team'
      });
    }
  } catch (error) {
    console.error('Error processing escalation webhook:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Polling endpoints
app.get('/polling/status', (req, res) => {
  try {
    const status = getPollingStatus();
    res.json({
      status: 'ok',
      polling: status
    });
  } catch (error) {
    res.json({
      status: 'error',
      message: error.message
    });
  }
});

// Debug endpoint for polling diagnostics
app.get('/polling/debug', async (req, res) => {
  try {
    const pollingStatus = getPollingStatus();
    const conversationStats = getStats();
    const pollingStats = getPollingStats();

    // Get recent messages from the single BMA Chat Support space
    const spaceMessages = {};
    try {
      const { listSpaceMessages } = require('./services/google-chat-simple');
      const messages = await listSpaceMessages(SINGLE_SPACE_ID, 10);
      spaceMessages['BMA_Chat_Support'] = messages.map(msg => ({
        id: msg.name,
        threadId: msg.thread?.name || 'No thread',
        text: msg.text?.substring(0, 100) || 'No text',
        sender: msg.sender?.displayName || 'Unknown',
        senderType: msg.sender?.type || 'Unknown',
        createTime: msg.createTime
      }));
    } catch (error) {
      spaceMessages['BMA_Chat_Support'] = { error: error.message };
    }

    res.json({
      status: 'ok',
      debug: {
        polling: pollingStatus,
        conversations: {
          total: conversationStats.totalConversations,
          active: conversationStats.activeConversations.map(conv => ({
            id: conv.id,
            platform: conv.platform,
            userId: conv.userId,
            threadId: conv.threadId,
            spaceId: conv.spaceId,
            lastActivity: conv.lastActivity
          }))
        },
        recentMessages: spaceMessages,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    res.json({
      status: 'error',
      message: error.message
    });
  }
});

app.post('/polling/start', async (req, res) => {
  try {
    await startPolling();
    const status = getPollingStatus();
    res.json({
      status: 'ok',
      message: 'Google Chat polling started',
      polling: status
    });
  } catch (error) {
    res.json({
      status: 'error',
      message: error.message
    });
  }
});

app.post('/polling/stop', (req, res) => {
  try {
    stopPolling();
    const status = getPollingStatus();
    res.json({
      status: 'ok',
      message: 'Google Chat polling stopped',
      polling: status
    });
  } catch (error) {
    res.json({
      status: 'error',
      message: error.message
    });
  }
});

// Reply portal endpoints
app.get('/reply/:conversationId', async (req, res) => {
  const { conversationId } = req.params;
  const conversation = getConversation(conversationId);

  if (!conversation) {
    res.status(404).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Conversation Not Found</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5; }
          .error { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          h1 { color: #d32f2f; }
        </style>
      </head>
      <body>
        <div class="error">
          <h1>❌ Conversation Not Found</h1>
          <p>This conversation has expired or does not exist.</p>
          <p>Conversations expire after 24 hours.</p>
        </div>
      </body>
      </html>
    `);
    return;
  }

  const platformIcon = conversation.platform === 'whatsapp' ? '💬' : '📱';
  const platformName = conversation.platform.toUpperCase();

  // Get identifier for message history (normalize WhatsApp phone for consistent lookup)
  const identifier = conversation.platform === 'whatsapp'
    ? normalizePhoneNumber(conversation.senderInfo.phoneNumber || conversation.userId)
    : conversation.userId;

  // Try to get ElevenLabs transcript for proper message ordering
  let formattedHistory = [];
  let usedElevenLabsTranscript = false;

  if (conversation.platform === 'whatsapp' && identifier) {
    const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || 'sk_42e0e37fe9ef457906b11dce0ac6ea5262a005ec2ce0ca6e';
    const ELEVENLABS_AGENT_ID = process.env.ELEVENLABS_AGENT_ID || 'agent_8501kesasj5fe8b8rm6nnxcvn4kb';

    try {
      console.log('Fetching ElevenLabs conversations for reply portal...');
      const listResponse = await axios.get(
        `https://api.elevenlabs.io/v1/convai/conversations?agent_id=${ELEVENLABS_AGENT_ID}&page_size=5`,
        { headers: { 'xi-api-key': ELEVENLABS_API_KEY } }
      );

      const conversations = listResponse.data?.conversations || [];

      // Only check the MOST RECENT conversation (first in list)
      // If it's "in-progress" (no transcript), fall back to stored messages
      // Don't use older conversations - they're from previous sessions
      if (conversations.length > 0) {
        const mostRecentConv = conversations[0];
        console.log(`Most recent ElevenLabs conversation: ${mostRecentConv.conversation_id}, status: ${mostRecentConv.status}`);

        try {
          const convResponse = await axios.get(
            `https://api.elevenlabs.io/v1/convai/conversations/${mostRecentConv.conversation_id}`,
            { headers: { 'xi-api-key': ELEVENLABS_API_KEY } }
          );

          const transcript = convResponse.data?.transcript || [];
          const startTime = convResponse.data?.metadata?.start_time_unix_secs || (Date.now() / 1000);
          const convStatus = convResponse.data?.status || mostRecentConv.status;

          console.log(`Conversation ${mostRecentConv.conversation_id}: status=${convStatus}, transcript_length=${transcript.length}`);

          if (transcript.length > 0) {
            console.log(`Using transcript with ${transcript.length} messages from ${mostRecentConv.conversation_id}`);

            // Use ElevenLabs transcript directly - it has proper chronological order
            formattedHistory = transcript.map((entry, index) => {
              // Estimate timestamp based on position (spread over conversation duration)
              const estimatedTimestamp = (startTime * 1000) + (index * 5000); // 5 sec between messages
              return {
                text: entry.message || '',
                direction: entry.role === 'agent' ? 'outgoing' : 'incoming',
                timestamp: new Date(estimatedTimestamp).toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                  hour12: true,
                  timeZone: 'Asia/Bangkok'
                }),
                senderName: entry.role === 'agent' ? 'BMAsia Support' : (conversation.senderInfo?.name || 'Customer'),
                files: []
              };
            }).filter(m => m.text.trim()); // Remove empty messages

            usedElevenLabsTranscript = true;
          } else {
            // No transcript yet (conversation in-progress) - will fall back to stored messages
            console.log(`No transcript available for most recent conversation (status: ${convStatus}) - using stored messages`);
          }
        } catch (err) {
          console.log(`Could not fetch transcript for ${mostRecentConv.conversation_id}:`, err.message);
        }
      }
    } catch (err) {
      console.log('Could not fetch ElevenLabs conversations:', err.message);
    }
  }

  // Fall back to stored message history if no ElevenLabs transcript
  if (!usedElevenLabsTranscript) {
    const messageHistory = getHistory(identifier);
    formattedHistory = formatForDisplay(messageHistory);
  }

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Reply to ${platformName} Message</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
          padding: 20px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          margin: 0;
        }
        .container {
          max-width: 600px;
          margin: 0 auto;
          background: white;
          border-radius: 12px;
          box-shadow: 0 20px 40px rgba(0,0,0,0.1);
          overflow: hidden;
        }
        .header {
          background: #7c3aed;
          color: white;
          padding: 20px;
          font-size: 20px;
          font-weight: bold;
        }
        .content {
          padding: 20px;
        }
        .info-box {
          background: #f8f9fa;
          border-left: 4px solid #7c3aed;
          padding: 15px;
          margin-bottom: 20px;
          border-radius: 4px;
        }
        .info-row {
          margin: 8px 0;
          color: #495057;
        }
        .info-label {
          font-weight: 600;
          color: #212529;
        }
        .message-history {
          max-height: 400px;
          overflow-y: auto;
          margin-bottom: 20px;
          padding: 10px;
          background: #f8f9fa;
          border-radius: 8px;
          border: 1px solid #e0e0e0;
        }
        .message {
          margin: 10px 0;
          padding: 10px 15px;
          border-radius: 12px;
          max-width: 70%;
          word-wrap: break-word;
        }
        .message-incoming {
          background: #e3f2fd;
          margin-right: auto;
          border-bottom-left-radius: 4px;
        }
        .message-outgoing {
          background: #f5f5f5;
          margin-left: auto;
          text-align: right;
          border-bottom-right-radius: 4px;
        }
        .message-time {
          font-size: 11px;
          color: #666;
          margin-top: 4px;
        }
        .message-sender {
          font-weight: 600;
          font-size: 12px;
          color: #555;
          margin-bottom: 4px;
        }
        textarea {
          width: 100%;
          min-height: 150px;
          padding: 12px;
          border: 2px solid #e0e0e0;
          border-radius: 8px;
          font-size: 16px;
          font-family: inherit;
          resize: vertical;
          box-sizing: border-box;
        }
        textarea:focus {
          outline: none;
          border-color: #7c3aed;
        }
        .button-group {
          display: flex;
          gap: 10px;
          margin-top: 20px;
        }
        button {
          flex: 1;
          padding: 12px 24px;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s;
        }
        .send-btn {
          background: #7c3aed;
          color: white;
        }
        .send-btn:hover:not(:disabled) {
          background: #6d28d9;
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(124, 58, 237, 0.3);
        }
        .send-btn:disabled {
          background: #9ca3af;
          cursor: not-allowed;
        }
        .cancel-btn {
          background: #f3f4f6;
          color: #374151;
        }
        .cancel-btn:hover {
          background: #e5e7eb;
        }
        .success-message {
          display: none;
          background: #10b981;
          color: white;
          padding: 15px;
          border-radius: 8px;
          margin-top: 20px;
          text-align: center;
          font-weight: 600;
        }
        .error-message {
          display: none;
          background: #ef4444;
          color: white;
          padding: 15px;
          border-radius: 8px;
          margin-top: 20px;
        }
        .char-count {
          text-align: right;
          color: #6b7280;
          font-size: 14px;
          margin-top: 5px;
        }
        .file-upload-zone {
          border: 2px dashed #cbd5e0;
          border-radius: 8px;
          padding: 20px;
          text-align: center;
          margin-top: 15px;
          cursor: pointer;
          transition: all 0.3s;
        }
        .file-upload-zone:hover {
          border-color: #7c3aed;
          background: #f9fafb;
        }
        .file-input {
          display: none;
        }
        .file-list {
          margin-top: 15px;
        }
        .file-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 12px;
          background: #f3f4f6;
          border-radius: 6px;
          margin-bottom: 8px;
        }
        .file-item button {
          background: none;
          border: none;
          cursor: pointer;
          padding: 0 5px;
          font-size: 16px;
          flex: none;
        }
        .platform-warning {
          background: #fef3c7;
          color: #92400e;
          padding: 12px;
          border-radius: 8px;
          margin-top: 10px;
          font-size: 14px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          ${platformIcon} Reply to ${platformName} Message
        </div>
        <div class="content">
          <div class="info-box">
            <div class="info-row">
              <span class="info-label">Platform:</span> ${platformName}
            </div>
            <div class="info-row">
              <span class="info-label">From:</span> ${conversation.senderInfo.senderName || 'Unknown'}
            </div>
            ${conversation.senderInfo.phoneNumber ? `
              <div class="info-row">
                <span class="info-label">Phone:</span> ${conversation.senderInfo.phoneNumber}
              </div>
            ` : ''}
            <div class="info-row">
              <span class="info-label">Time:</span> ${new Date(conversation.createdAt).toLocaleString('en-US', { timeZone: 'Asia/Bangkok' })}
            </div>
          </div>

          <div>
            <h3>📨 24-Hour Message History:</h3>
            <div class="message-history" id="messageHistory">
              ${formattedHistory.length > 0 ? formattedHistory.map(msg => `
                <div class="message message-${msg.direction}" style="${msg.direction === 'outgoing' ? 'display: flex; flex-direction: column; align-items: flex-end;' : ''}">
                  <div class="message-sender">${msg.senderName}</div>
                  <div>${msg.text}</div>
                  <div class="message-time">${msg.timestamp}</div>
                </div>
              `).join('') : `
                <div class="message message-incoming">
                  <div class="message-sender">${conversation.senderInfo.senderName || 'Customer'}</div>
                  <div>${conversation.senderInfo.messageText || 'No message text available'}</div>
                  <div class="message-time">Just now</div>
                </div>
              `}
            </div>
          </div>

          <form id="replyForm" action="/reply/${conversationId}" method="POST">
            <h3>✏️ Your Reply:</h3>
            <textarea
              name="replyText"
              id="replyText"
              placeholder="Type your reply here..."
              required
              maxlength="4096"
            ></textarea>
            <div class="char-count"><span id="charCount">0</span> / 4096</div>

            <div class="file-upload-zone" id="fileUploadZone">
              <input type="file" id="fileInput" class="file-input" multiple />
              <div>
                📁 Drag files here or <span style="color: #7c3aed; text-decoration: underline;">click to browse</span>
              </div>
              <div style="font-size: 14px; color: #718096; margin-top: 8px;">
                ${conversation.platform === 'whatsapp'
                  ? 'Supported: PDF, Word, Excel, Images, Videos (max 100MB)'
                  : 'LINE only supports: Images (JPG, PNG) and Videos (MP4)'}
              </div>
            </div>

            <div id="fileList" class="file-list"></div>

            ${conversation.platform === 'line' ? `
              <div class="platform-warning" id="lineWarning" style="display: none;">
                ⚠️ LINE doesn't support document files. Only images and videos will be sent.
              </div>
            ` : ''}

            <div class="button-group">
              <button type="button" class="cancel-btn" onclick="window.close()">❌ Cancel</button>
              <button type="submit" class="send-btn" id="sendBtn">📤 Send Reply</button>
            </div>
          </form>

          <div class="success-message" id="successMessage">
            ✅ Reply sent successfully!<br>
            <span style="font-weight: normal; font-size: 14px;">You can now close this window.</span>
          </div>
          <div class="error-message" id="errorMessage"></div>
        </div>
      </div>

      <script>
        const textarea = document.getElementById('replyText');
        const charCount = document.getElementById('charCount');
        const form = document.getElementById('replyForm');
        const sendBtn = document.getElementById('sendBtn');
        const successMessage = document.getElementById('successMessage');
        const errorMessage = document.getElementById('errorMessage');
        const fileInput = document.getElementById('fileInput');
        const fileUploadZone = document.getElementById('fileUploadZone');
        const fileList = document.getElementById('fileList');

        let selectedFiles = [];

        textarea.addEventListener('input', () => {
          charCount.textContent = textarea.value.length;
        });

        // File upload handling
        if (fileUploadZone && fileInput) {
          // Click to browse
          fileUploadZone.addEventListener('click', () => {
            fileInput.click();
          });

          // Drag and drop
          fileUploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            fileUploadZone.style.background = '#f3f0ff';
          });

          fileUploadZone.addEventListener('dragleave', () => {
            fileUploadZone.style.background = '';
          });

          fileUploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            fileUploadZone.style.background = '';
            handleFiles(e.dataTransfer.files);
          });

          fileInput.addEventListener('change', (e) => {
            handleFiles(e.target.files);
          });
        }

        function handleFiles(files) {
          selectedFiles = Array.from(files);
          displayFiles();
        }

        function displayFiles() {
          if (!fileList) return;

          fileList.innerHTML = '';
          selectedFiles.forEach((file, index) => {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-item';
            fileItem.innerHTML = \`
              <span>📎 \${file.name} (\${formatFileSize(file.size)})</span>
              <button type="button" onclick="removeFile(\${index})">❌</button>
            \`;
            fileList.appendChild(fileItem);
          });
        }

        function removeFile(index) {
          selectedFiles.splice(index, 1);
          displayFiles();
        }

        function formatFileSize(bytes) {
          if (bytes === 0) return '0 Bytes';
          const k = 1024;
          const sizes = ['Bytes', 'KB', 'MB', 'GB'];
          const i = Math.floor(Math.log(bytes) / Math.log(k));
          return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
        }

        form.addEventListener('submit', async (e) => {
          e.preventDefault();

          sendBtn.disabled = true;
          sendBtn.textContent = '🔄 Sending...';
          errorMessage.style.display = 'none';

          try {
            // Create FormData
            const formData = new FormData();
            formData.append('replyText', textarea.value);

            // Add files
            selectedFiles.forEach(file => {
              formData.append('files', file);
            });

            const response = await fetch(form.action, {
              method: 'POST',
              body: formData
              // Don't set Content-Type header - browser will set it with boundary for multipart
            });

            const result = await response.json();

            if (result.success) {
              successMessage.style.display = 'block';
              form.style.display = 'none';
              // Don't try to close window - it doesn't work for user-opened tabs
              // User will close it manually
            } else {
              throw new Error(result.error || 'Failed to send reply');
            }
          } catch (error) {
            errorMessage.textContent = '❌ Error: ' + error.message;
            errorMessage.style.display = 'block';
            sendBtn.disabled = false;
            sendBtn.textContent = '📤 Send Reply';
          }
        });

        // Auto-focus textarea
        textarea.focus();

        // Scroll message history to bottom
        const messageHistory = document.getElementById('messageHistory');
        if (messageHistory) {
          messageHistory.scrollTop = messageHistory.scrollHeight;
        }
      </script>
    </body>
    </html>
  `);
});

// =============================================================================
// ElevenLabs-based reply portal - survives deploys by fetching from ElevenLabs API
// =============================================================================

app.get('/reply-el/:elevenLabsConvId', async (req, res) => {
  const { elevenLabsConvId } = req.params;
  const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || 'sk_42e0e37fe9ef457906b11dce0ac6ea5262a005ec2ce0ca6e';

  console.log(`[reply-el] Loading reply portal for ElevenLabs conversation: ${elevenLabsConvId}`);

  try {
    // Fetch conversation from ElevenLabs API
    const convResponse = await axios.get(
      `https://api.elevenlabs.io/v1/convai/conversations/${elevenLabsConvId}`,
      { headers: { 'xi-api-key': ELEVENLABS_API_KEY } }
    );

    const convData = convResponse.data;
    const transcript = convData?.transcript || [];
    const startTime = convData?.metadata?.start_time_unix_secs || (Date.now() / 1000);

    // Extract phone from WhatsApp metadata
    let phoneNumber = convData?.metadata?.whatsapp?.whatsapp_user_id;

    // Also try customer_phone if whatsapp metadata not present
    if (!phoneNumber && convData?.analysis?.data_collection_results?.customer_phone) {
      phoneNumber = convData.analysis.data_collection_results.customer_phone.value;
    }

    if (!phoneNumber) {
      console.log('[reply-el] No phone number found in conversation metadata');
      res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Phone Number Not Found</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5; }
            .error { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            h1 { color: #d32f2f; }
          </style>
        </head>
        <body>
          <div class="error">
            <h1>❌ Phone Number Not Found</h1>
            <p>Could not find the customer's phone number for this conversation.</p>
            <p>The conversation may not have WhatsApp metadata attached.</p>
          </div>
        </body>
        </html>
      `);
      return;
    }

    // Get customer info from our database
    const customerProfile = await getProfile(phoneNumber);
    const customerName = customerProfile?.name || convData?.analysis?.data_collection_results?.customer_name?.value || 'Customer';
    const customerCompany = customerProfile?.company || convData?.analysis?.data_collection_results?.customer_company?.value || null;

    console.log(`[reply-el] Found phone: ${phoneNumber}, name: ${customerName}`);

    // Format transcript for display
    let formattedHistory = transcript.map((entry, index) => {
      const estimatedTimestamp = (startTime * 1000) + (index * 5000);
      return {
        text: entry.message || '',
        direction: entry.role === 'agent' ? 'outgoing' : 'incoming',
        timestamp: new Date(estimatedTimestamp).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: 'Asia/Bangkok'
        }),
        senderName: entry.role === 'agent' ? 'BMAsia Support' : customerName,
        files: []
      };
    }).filter(m => m.text.trim());

    // FALLBACK: If ElevenLabs transcript is empty, try stored escalation history
    if (formattedHistory.length === 0) {
      console.log('[reply-el] ElevenLabs transcript empty - checking stored escalation history...');
      const escalationInfo = getEscalationInfo(phoneNumber);
      if (escalationInfo && escalationInfo.conversationHistory && escalationInfo.conversationHistory.length > 0) {
        console.log(`[reply-el] Found ${escalationInfo.conversationHistory.length} messages in stored escalation history`);
        let baseTimestamp = escalationInfo.escalatedAt || Date.now();
        formattedHistory = escalationInfo.conversationHistory.map((msg, index) => ({
          text: msg.text || '',
          direction: msg.type === 'customer' ? 'incoming' : 'outgoing',
          timestamp: new Date(baseTimestamp + (index * 5000)).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
            timeZone: 'Asia/Bangkok'
          }),
          senderName: msg.type === 'customer' ? customerName : 'BMAsia Support',
          files: []
        })).filter(m => m.text.trim());
        console.log(`[reply-el] Using ${formattedHistory.length} messages from stored escalation history`);
      } else {
        console.log('[reply-el] No stored escalation history found either');
      }
    }

    // Render the reply portal (same UI as regular reply portal)
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Reply to WhatsApp Message</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            margin: 0;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            overflow: hidden;
          }
          .header {
            background: #7c3aed;
            color: white;
            padding: 20px;
            font-size: 20px;
            font-weight: bold;
          }
          .content {
            padding: 20px;
          }
          .info-box {
            background: #f8f9fa;
            border-left: 4px solid #7c3aed;
            padding: 15px;
            margin-bottom: 20px;
            border-radius: 4px;
          }
          .info-row {
            margin: 8px 0;
            color: #495057;
          }
          .info-label {
            font-weight: 600;
            color: #212529;
          }
          .message-history {
            max-height: 400px;
            overflow-y: auto;
            margin-bottom: 20px;
            padding: 10px;
            background: #f8f9fa;
            border-radius: 8px;
            border: 1px solid #e0e0e0;
          }
          .message {
            margin: 10px 0;
            padding: 10px 15px;
            border-radius: 12px;
            max-width: 70%;
            word-wrap: break-word;
          }
          .message-incoming {
            background: #e3f2fd;
            margin-right: auto;
            border-bottom-left-radius: 4px;
          }
          .message-outgoing {
            background: #f5f5f5;
            margin-left: auto;
            text-align: right;
            border-bottom-right-radius: 4px;
          }
          .message-time {
            font-size: 11px;
            color: #666;
            margin-top: 4px;
          }
          .message-sender {
            font-weight: 600;
            font-size: 12px;
            color: #555;
            margin-bottom: 4px;
          }
          textarea {
            width: 100%;
            min-height: 150px;
            padding: 12px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            font-size: 16px;
            font-family: inherit;
            resize: vertical;
            box-sizing: border-box;
          }
          textarea:focus {
            outline: none;
            border-color: #7c3aed;
          }
          .button-group {
            display: flex;
            gap: 10px;
            margin-top: 20px;
          }
          button {
            flex: 1;
            padding: 12px 24px;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
          }
          .send-btn {
            background: #7c3aed;
            color: white;
          }
          .send-btn:hover:not(:disabled) {
            background: #6d28d9;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(124, 58, 237, 0.3);
          }
          .send-btn:disabled {
            background: #9ca3af;
            cursor: not-allowed;
          }
          .cancel-btn {
            background: #f3f4f6;
            color: #374151;
          }
          .cancel-btn:hover {
            background: #e5e7eb;
          }
          .success-message {
            display: none;
            background: #10b981;
            color: white;
            padding: 15px;
            border-radius: 8px;
            margin-top: 20px;
            text-align: center;
            font-weight: 600;
          }
          .error-message {
            display: none;
            background: #ef4444;
            color: white;
            padding: 15px;
            border-radius: 8px;
            margin-top: 20px;
          }
          .char-count {
            text-align: right;
            color: #6b7280;
            font-size: 14px;
            margin-top: 5px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            💬 Reply to WHATSAPP Message
          </div>
          <div class="content">
            <div class="info-box">
              <div class="info-row"><span class="info-label">Customer:</span> ${customerName}</div>
              ${customerCompany ? `<div class="info-row"><span class="info-label">Company:</span> ${customerCompany}</div>` : ''}
              <div class="info-row"><span class="info-label">Phone:</span> ${phoneNumber}</div>
            </div>

            ${formattedHistory.length > 0 ? `
            <h3>📜 Conversation History</h3>
            <div class="message-history" id="messageHistory">
              ${formattedHistory.map(msg => `
                <div class="message message-${msg.direction}">
                  <div class="message-sender">${msg.senderName}</div>
                  <div class="message-text">${msg.text}</div>
                  <div class="message-time">${msg.timestamp}</div>
                </div>
              `).join('')}
            </div>
            ` : '<p>No message history available</p>'}

            <form id="replyForm" action="/reply-el/${elevenLabsConvId}" method="POST">
              <label for="replyText"><strong>Your Reply:</strong></label>
              <textarea id="replyText" name="replyText" placeholder="Type your message to the customer..." required></textarea>
              <div class="char-count"><span id="charCount">0</span> characters</div>

              <div class="button-group">
                <button type="button" class="cancel-btn" onclick="window.close()">Cancel</button>
                <button type="submit" class="send-btn" id="sendBtn">📤 Send Reply</button>
              </div>
            </form>

            <div class="success-message" id="successMessage">
              ✅ Reply sent successfully! You can close this window.
            </div>
            <div class="error-message" id="errorMessage"></div>

            <!-- Close Escalation button - allows agent to respond again -->
            <form action="/api/close-escalation" method="POST" style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee;">
              <input type="hidden" name="phone" value="${phoneNumber}">
              <input type="hidden" name="redirect" value="/reply-el/${elevenLabsConvId}">
              <button type="submit" style="
                width: 100%;
                padding: 12px;
                background: #4CAF50;
                color: white;
                border: none;
                border-radius: 8px;
                font-size: 14px;
                cursor: pointer;
              ">
                ✅ Close Escalation (Allow AI to respond again)
              </button>
              <p style="font-size: 12px; color: #666; margin-top: 8px; text-align: center;">
                Click this when you're done helping the customer and want the AI to handle future messages.
              </p>
            </form>

            ${req.query.escalation_closed === 'true' ? '<div style="background: #e8f5e9; color: #2e7d32; padding: 10px; border-radius: 8px; margin-top: 10px; text-align: center;">✅ Escalation closed! AI will respond to new messages.</div>' : ''}
          </div>
        </div>

        <script>
          const form = document.getElementById('replyForm');
          const textarea = document.getElementById('replyText');
          const charCount = document.getElementById('charCount');
          const sendBtn = document.getElementById('sendBtn');
          const successMessage = document.getElementById('successMessage');
          const errorMessage = document.getElementById('errorMessage');

          textarea.addEventListener('input', () => {
            charCount.textContent = textarea.value.length;
          });

          form.addEventListener('submit', async (e) => {
            e.preventDefault();

            sendBtn.disabled = true;
            sendBtn.textContent = '🔄 Sending...';
            errorMessage.style.display = 'none';

            try {
              const response = await fetch(form.action, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ replyText: textarea.value })
              });

              const result = await response.json();

              if (result.success) {
                successMessage.style.display = 'block';
                form.style.display = 'none';
              } else {
                throw new Error(result.error || 'Failed to send reply');
              }
            } catch (error) {
              errorMessage.textContent = '❌ Error: ' + error.message;
              errorMessage.style.display = 'block';
              sendBtn.disabled = false;
              sendBtn.textContent = '📤 Send Reply';
            }
          });

          textarea.focus();

          const messageHistory = document.getElementById('messageHistory');
          if (messageHistory) {
            messageHistory.scrollTop = messageHistory.scrollHeight;
          }
        </script>
      </body>
      </html>
    `);

  } catch (error) {
    console.error('[reply-el] Error loading conversation:', error.message);

    // Handle specific error cases
    if (error.response?.status === 404) {
      res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Conversation Not Found</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5; }
            .error { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            h1 { color: #d32f2f; }
          </style>
        </head>
        <body>
          <div class="error">
            <h1>❌ Conversation Not Found</h1>
            <p>This conversation could not be found in ElevenLabs.</p>
            <p>It may have been deleted or the conversation ID is invalid.</p>
          </div>
        </body>
        </html>
      `);
    } else {
      res.status(500).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Error Loading Conversation</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5; }
            .error { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            h1 { color: #d32f2f; }
          </style>
        </head>
        <body>
          <div class="error">
            <h1>❌ Error Loading Conversation</h1>
            <p>There was a problem loading this conversation.</p>
            <p>Please try again or contact support.</p>
          </div>
        </body>
        </html>
      `);
    }
  }
});

// Handle reply submission for ElevenLabs-based portal
app.post('/reply-el/:elevenLabsConvId', express.json(), async (req, res) => {
  const { elevenLabsConvId } = req.params;
  const { replyText } = req.body;
  const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || 'sk_42e0e37fe9ef457906b11dce0ac6ea5262a005ec2ce0ca6e';

  console.log(`[reply-el POST] Processing reply for ElevenLabs conversation: ${elevenLabsConvId}`);

  if (!replyText || replyText.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Reply text is required'
    });
  }

  try {
    // Fetch conversation from ElevenLabs to get phone number
    const convResponse = await axios.get(
      `https://api.elevenlabs.io/v1/convai/conversations/${elevenLabsConvId}`,
      { headers: { 'xi-api-key': ELEVENLABS_API_KEY } }
    );

    const convData = convResponse.data;

    // Extract phone from WhatsApp metadata
    let phoneNumber = convData?.metadata?.whatsapp?.whatsapp_user_id;

    if (!phoneNumber && convData?.analysis?.data_collection_results?.customer_phone) {
      phoneNumber = convData.analysis.data_collection_results.customer_phone.value;
    }

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Could not find customer phone number'
      });
    }

    console.log(`[reply-el POST] Sending reply to phone: ${phoneNumber}`);

    // Send via WhatsApp
    const result = await sendWhatsAppMessage(phoneNumber, replyText);

    if (result.success) {
      // Store in message history
      const cleanPhone = normalizePhoneNumber(phoneNumber);
      storeMessage(cleanPhone, replyText, 'outgoing', 'whatsapp', {
        senderName: 'BMAsia Support (Team)',
        source: 'reply_portal_el'
      });

      console.log(`[reply-el POST] ✅ Reply sent successfully to ${phoneNumber}`);

      res.json({
        success: true,
        message: 'Reply sent successfully'
      });
    } else {
      throw new Error(result.error || 'Failed to send WhatsApp message');
    }

  } catch (error) {
    console.error('[reply-el POST] Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to send reply'
    });
  }
});

// Handle reply submission with file uploads
app.post('/reply/:conversationId', upload.array('files', 5), async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { replyText } = req.body;
    const files = req.files || [];

    // At least text or files must be provided
    if ((!replyText || replyText.trim().length === 0) && files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Either reply text or files must be provided'
      });
    }

    // Get conversation details
    const conversation = getConversation(conversationId);
    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found or expired'
      });
    }

    const identifier = conversation.platform === 'whatsapp'
      ? (conversation.senderInfo.phoneNumber || conversation.userId)
      : conversation.userId;

    // Process uploaded files
    const savedFiles = [];
    for (const file of files) {
      const savedFile = await saveFile(file.buffer, file.originalname, file.mimetype);
      savedFiles.push({
        ...savedFile,
        url: getFileUrl(savedFile.id, savedFile.filename)
      });
    }

    // Send messages based on platform
    let results = [];

    if (conversation.platform === 'whatsapp') {
      const phoneNumber = conversation.senderInfo.phoneNumber || conversation.userId;

      // Send text message if provided
      if (replyText && replyText.trim()) {
        const textResult = await sendWhatsAppMessage(phoneNumber, replyText);
        results.push(textResult);
      }

      // Send media messages for each file
      for (const file of savedFiles) {
        const mediaResult = await sendWhatsAppMedia(phoneNumber, file);
        results.push(mediaResult);
      }

    } else if (conversation.platform === 'line') {
      // Send text message if provided
      if (replyText && replyText.trim()) {
        const textResult = await sendLineMessage(conversation.userId, replyText);
        results.push(textResult);
      }

      // Send media messages for supported file types
      for (const file of savedFiles) {
        // LINE only supports images and videos
        if (file.mimeType.startsWith('image/') || file.mimeType.startsWith('video/')) {
          const mediaResult = await sendLineMedia(conversation.userId, file);
          results.push(mediaResult);
        } else {
          console.log(`⚠️ LINE doesn't support ${file.mimeType} files, skipping ${file.originalName}`);
        }
      }

    } else {
      return res.status(400).json({
        success: false,
        error: `Unsupported platform: ${conversation.platform}`
      });
    }

    // Check if any message was sent successfully
    const anySuccess = results.some(r => r && r.success);

    if (anySuccess) {
      // Store outgoing message in history
      const messageContent = replyText || `[Sent ${files.length} file(s)]`;
      storeMessage(
        identifier,
        messageContent,
        'outgoing',
        conversation.platform,
        {
          agentName: 'Support Agent',
          files: savedFiles.map(f => ({
            name: f.originalName,
            type: f.mimeType,
            url: f.url
          }))
        }
      );

      console.log(`✅ Reply sent via portal to ${conversation.platform} user ${conversation.userId}`);
      res.json({
        success: true,
        message: 'Reply sent successfully',
        platform: conversation.platform,
        userId: conversation.userId,
        filesCount: savedFiles.length
      });
    } else {
      const errors = results.filter(r => !r.success).map(r => r.error).join(', ');
      res.status(500).json({
        success: false,
        error: errors || 'Failed to send reply'
      });
    }

  } catch (error) {
    console.error('Error processing reply:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Serve uploaded files
app.get('/files/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const file = await readFile(filename);

    res.set('Content-Type', file.mimeType);
    res.set('Content-Length', file.size);
    res.send(file.data);
  } catch (error) {
    console.error('Error serving file:', error);
    res.status(404).json({ error: 'File not found' });
  }
});

// Start server only if not being imported (for testing)
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`BMA Messenger Hub is running on port ${PORT}`);
    console.log(`Health check: http://0.0.0.0:${PORT}/health`);
    console.log(`Simple health check: http://0.0.0.0:${PORT}/health-simple`);

    // Polling disabled - Google Chat bots cannot read thread replies via API
    // Must use webhooks for bidirectional messaging
    console.log('✅ Server started successfully');
    console.log('ℹ️  Google Chat polling is disabled - use webhooks for replies');
    console.log('ℹ️  Configure Google Chat webhook URL: https://bma-messenger-hub-ooyy.onrender.com/webhooks/google-chat');
  });
}

// Export app for testing
module.exports = app;