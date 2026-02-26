/**
 * TTS Module Index
 *
 * Factory functions for creating TTS providers based on configuration.
 */

import { config } from '../config';
import { TTSProvider } from './provider';
import { OpenAITTSProvider, createOpenAITTS } from './openai-tts';
import { ElevenLabsTTSProvider, createElevenLabsTTS } from './elevenlabs';

export { TTSProvider, TTSConfig, TTSChunk, TTSStreamCallback } from './provider';
export { OpenAITTSProvider, createOpenAITTS } from './openai-tts';
export { ElevenLabsTTSProvider, createElevenLabsTTS } from './elevenlabs';

/**
 * Create TTS provider based on configuration
 * Falls back to OpenAI if configured provider is unavailable
 */
export function createTTSProvider(): TTSProvider {
  const providerType = config.tts?.provider || 'openai';

  if (providerType === 'elevenlabs') {
    const elevenlabs = createElevenLabsTTS();
    if (elevenlabs.isAvailable()) {
      console.log('[TTS] Using ElevenLabs provider');
      return elevenlabs;
    }
    console.log('[TTS] ElevenLabs not configured, falling back to OpenAI');
  }

  console.log('[TTS] Using OpenAI provider');
  return createOpenAITTS({
    voice: config.tts?.voice || 'alloy',
  });
}

/**
 * Create TTS provider with automatic fallback
 * Returns a wrapper that tries primary provider first, then fallback
 */
export function createTTSWithFallback(): TTSProvider {
  const primary = createTTSProvider();
  const fallback = createOpenAITTS();

  // If primary is already OpenAI, no need for fallback wrapper
  if (primary.name === 'openai') {
    return primary;
  }

  return new FallbackTTSProvider(primary, fallback);
}

/**
 * TTS provider with automatic fallback
 */
class FallbackTTSProvider implements TTSProvider {
  readonly name: string;

  constructor(
    private primary: TTSProvider,
    private fallback: TTSProvider
  ) {
    this.name = `${primary.name}+${fallback.name}`;
  }

  isAvailable(): boolean {
    return this.primary.isAvailable() || this.fallback.isAvailable();
  }

  async synthesize(text: string): Promise<Buffer> {
    try {
      return await this.primary.synthesize(text);
    } catch (err) {
      console.warn(`[TTS] Primary provider failed, using fallback:`, err);
      return await this.fallback.synthesize(text);
    }
  }

  async synthesizeStream(
    text: string,
    onChunk: (chunk: { audio: Buffer; isLast: boolean }) => void
  ): Promise<void> {
    try {
      await this.primary.synthesizeStream(text, onChunk);
    } catch (err) {
      console.warn(`[TTS] Primary provider failed, using fallback:`, err);
      await this.fallback.synthesizeStream(text, onChunk);
    }
  }
}
