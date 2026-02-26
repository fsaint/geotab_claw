/**
 * OpenAI TTS Provider
 *
 * Uses OpenAI's text-to-speech API for audio synthesis.
 */

import { config } from '../config';
import { TTSProvider, TTSConfig, TTSChunk, TTSStreamCallback, DEFAULT_TTS_CONFIG } from './provider';

export interface OpenAITTSConfig extends TTSConfig {
  apiKey?: string;
  model: 'tts-1' | 'tts-1-hd';
}

type OpenAIVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

export class OpenAITTSProvider implements TTSProvider {
  readonly name = 'openai';
  private config: OpenAITTSConfig;

  constructor(cfg: Partial<OpenAITTSConfig> = {}) {
    this.config = {
      ...DEFAULT_TTS_CONFIG,
      model: 'tts-1',
      ...cfg,
    };
  }

  isAvailable(): boolean {
    const apiKey = this.config.apiKey || config.openai.apiKey;
    return !!apiKey;
  }

  async synthesize(text: string): Promise<Buffer> {
    const apiKey = this.config.apiKey || config.openai.apiKey;

    if (!apiKey) {
      throw new Error('OpenAI API key is required for TTS');
    }

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model,
        input: text,
        voice: this.config.voice as OpenAIVoice,
        response_format: this.getResponseFormat(),
        speed: this.config.speed,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI TTS error: ${response.status} ${error}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async synthesizeStream(text: string, onChunk: TTSStreamCallback): Promise<void> {
    const apiKey = this.config.apiKey || config.openai.apiKey;

    if (!apiKey) {
      throw new Error('OpenAI API key is required for TTS');
    }

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model,
        input: text,
        voice: this.config.voice as OpenAIVoice,
        response_format: this.getResponseFormat(),
        speed: this.config.speed,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI TTS error: ${response.status} ${error}`);
    }

    if (!response.body) {
      throw new Error('No response body from OpenAI TTS');
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

  private getResponseFormat(): string {
    switch (this.config.format) {
      case 'pcm':
        return 'pcm';
      case 'mp3':
        return 'mp3';
      case 'wav':
        return 'wav';
      default:
        return 'pcm';
    }
  }
}

/**
 * Create default OpenAI TTS provider
 */
export function createOpenAITTS(cfg: Partial<OpenAITTSConfig> = {}): OpenAITTSProvider {
  return new OpenAITTSProvider(cfg);
}
