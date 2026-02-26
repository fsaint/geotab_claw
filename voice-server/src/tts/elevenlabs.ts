/**
 * ElevenLabs TTS Provider
 *
 * Uses ElevenLabs API for high-quality streaming text-to-speech.
 * Supports lower latency than OpenAI TTS through streaming.
 */

import { config } from '../config';
import { TTSProvider, TTSConfig, TTSChunk, TTSStreamCallback, DEFAULT_TTS_CONFIG } from './provider';

export interface ElevenLabsConfig extends TTSConfig {
  apiKey?: string;
  voiceId: string;
  modelId: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  useSpeakerBoost?: boolean;
}

const DEFAULT_ELEVENLABS_CONFIG: Partial<ElevenLabsConfig> = {
  modelId: 'eleven_turbo_v2_5', // Lowest latency model
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0.0,
  useSpeakerBoost: true,
};

export class ElevenLabsTTSProvider implements TTSProvider {
  readonly name = 'elevenlabs';
  private config: ElevenLabsConfig;

  constructor(cfg: Partial<ElevenLabsConfig> = {}) {
    this.config = {
      ...DEFAULT_TTS_CONFIG,
      ...DEFAULT_ELEVENLABS_CONFIG,
      voiceId: config.tts?.elevenlabs?.voiceId || '',
      modelId: config.tts?.elevenlabs?.modelId || 'eleven_turbo_v2_5',
      ...cfg,
    } as ElevenLabsConfig;
  }

  isAvailable(): boolean {
    const apiKey = this.config.apiKey || config.tts?.elevenlabs?.apiKey;
    const voiceId = this.config.voiceId || config.tts?.elevenlabs?.voiceId;
    return !!(apiKey && voiceId);
  }

  async synthesize(text: string): Promise<Buffer> {
    const apiKey = this.config.apiKey || config.tts?.elevenlabs?.apiKey;
    const voiceId = this.config.voiceId || config.tts?.elevenlabs?.voiceId;

    if (!apiKey || !voiceId) {
      throw new Error('ElevenLabs API key and voice ID are required');
    }

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: this.config.modelId,
          voice_settings: {
            stability: this.config.stability,
            similarity_boost: this.config.similarityBoost,
            style: this.config.style,
            use_speaker_boost: this.config.useSpeakerBoost,
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ElevenLabs API error: ${response.status} ${error}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async synthesizeStream(text: string, onChunk: TTSStreamCallback): Promise<void> {
    const apiKey = this.config.apiKey || config.tts?.elevenlabs?.apiKey;
    const voiceId = this.config.voiceId || config.tts?.elevenlabs?.voiceId;

    if (!apiKey || !voiceId) {
      throw new Error('ElevenLabs API key and voice ID are required');
    }

    // Use streaming endpoint with PCM output for lower latency
    const outputFormat = this.getOutputFormat();

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=${outputFormat}`,
      {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: this.config.modelId,
          voice_settings: {
            stability: this.config.stability,
            similarity_boost: this.config.similarityBoost,
            style: this.config.style,
            use_speaker_boost: this.config.useSpeakerBoost,
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ElevenLabs API error: ${response.status} ${error}`);
    }

    if (!response.body) {
      throw new Error('No response body from ElevenLabs');
    }

    const reader = response.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          onChunk({ audio: Buffer.alloc(0), isLast: true });
          break;
        }

        if (value && value.length > 0) {
          onChunk({ audio: Buffer.from(value), isLast: false });
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private getOutputFormat(): string {
    // ElevenLabs supports various PCM formats
    // pcm_24000 = 24kHz 16-bit mono PCM (matches OpenAI output)
    switch (this.config.sampleRate) {
      case 8000:
        return 'ulaw_8000'; // For direct Twilio output
      case 16000:
        return 'pcm_16000';
      case 22050:
        return 'pcm_22050';
      case 24000:
        return 'pcm_24000';
      case 44100:
        return 'pcm_44100';
      default:
        return 'pcm_24000';
    }
  }
}

/**
 * Create ElevenLabs TTS provider
 */
export function createElevenLabsTTS(cfg: Partial<ElevenLabsConfig> = {}): ElevenLabsTTSProvider {
  return new ElevenLabsTTSProvider(cfg);
}
