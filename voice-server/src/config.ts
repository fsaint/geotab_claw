import dotenv from 'dotenv';
import path from 'path';

// Load .env from voice-server directory, fallback to parent
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  publicUrl: process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`,

  // Demo mode uses mock Geotab data instead of real API
  demoMode: process.env.DEMO_MODE === 'true' || !process.env.GEOTAB_DATABASE,

  // Feature flag: use OpenClaw instead of OpenAI Realtime
  useOpenClaw: process.env.USE_OPENCLAW === 'true',

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    phoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    realtimeUrl: 'wss://api.openai.com/v1/realtime',
    model: 'gpt-4o-realtime-preview-2024-12-17',
    voice: 'alloy' as const,
  },

  // OpenClaw Gateway configuration
  openclaw: {
    gatewayUrl: process.env.OPENCLAW_GATEWAY_URL || 'ws://localhost:18789',
    gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN || '',
  },

  // TTS configuration
  tts: {
    provider: (process.env.TTS_PROVIDER || 'openai') as 'openai' | 'elevenlabs',
    voice: process.env.TTS_VOICE || 'alloy',
    // ElevenLabs settings
    elevenlabs: {
      apiKey: process.env.ELEVENLABS_API_KEY || '',
      voiceId: process.env.ELEVENLABS_VOICE_ID || '',
      modelId: process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5',
    },
  },

  geotab: {
    server: process.env.GEOTAB_SERVER || 'my.geotab.com',
    database: process.env.GEOTAB_DATABASE || '',
    username: process.env.GEOTAB_USERNAME || '',
    password: process.env.GEOTAB_PASSWORD || '',
  },

  contacts: {
    bossPhone: process.env.BOSS_PHONE || '',
    mikePhone: process.env.MIKE_PHONE || '',
  },
};

export function validateConfig(): void {
  const required = [
    ['TWILIO_ACCOUNT_SID', config.twilio.accountSid],
    ['TWILIO_AUTH_TOKEN', config.twilio.authToken],
    ['TWILIO_PHONE_NUMBER', config.twilio.phoneNumber],
    ['OPENAI_API_KEY', config.openai.apiKey],
  ];

  const missing = required.filter(([_, value]) => !value);
  if (missing.length > 0) {
    console.warn(`Warning: Missing environment variables: ${missing.map(([k]) => k).join(', ')}`);
  }
}
