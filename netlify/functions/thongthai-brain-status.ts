import type { Handler } from '@netlify/functions';
import { THONGTHAI_BRAIN_VERSION, getBrainChannel } from './_thongthai-brain-v3';

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

export const handler: Handler = async event => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const canonicalSections = ['web', 'line', 'facebook', 'backoffice'] as const;
  const channels = canonicalSections.map(section => ({
    section,
    brainChannel: getBrainChannel(section),
    gateway: '/.netlify/functions/thongthai-chat',
  }));

  return json(200, {
    name: 'Thongthai Brain',
    principle: 'one_mind_many_adapters',
    version: THONGTHAI_BRAIN_VERSION,
    canonicalGateway: '/.netlify/functions/thongthai-chat',
    canonicalProduction: 'https://tamma-chat.netlify.app',
    channels,
    requiredRequestFields: [
      'guestId',
      'message',
      'language',
      'chatHistory',
      'guestContext',
      'journeyContext',
      'pageContext.section',
    ],
    publicResponseFields: [
      'message',
      'intent',
      'contextUpdates',
      'journeyAction',
      'suggestedActions',
    ],
    capabilities: [
      'conversation',
      'journey_continuity',
      'cross_channel_identity',
      'semantic_travel_memory',
      'verified_world_facts',
      'booking_tools',
      'otop_tools',
      'human_handoff',
    ],
    environment: {
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      openaiFallbackConfigured: Boolean(process.env.OPENAI_API_KEY),
      supabaseConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    },
  });
};
