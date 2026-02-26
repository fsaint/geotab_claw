/**
 * TTS Provider Interface
 *
 * Abstract interface for text-to-speech providers.
 * Implementations: OpenAI TTS, ElevenLabs
 */

export interface TTSConfig {
  voice: string;
  speed?: number;
  // Output format
  format: 'pcm' | 'mp3' | 'wav';
  // Sample rate (for PCM output)
  sampleRate: number;
}

export interface TTSChunk {
  audio: Buffer;
  isLast: boolean;
}

export type TTSStreamCallback = (chunk: TTSChunk) => void;

export interface TTSProvider {
  readonly name: string;

  /**
   * Synthesize text to audio
   * @param text - Text to synthesize
   * @returns Audio buffer
   */
  synthesize(text: string): Promise<Buffer>;

  /**
   * Synthesize text with streaming output
   * @param text - Text to synthesize
   * @param onChunk - Callback for each audio chunk
   */
  synthesizeStream(text: string, onChunk: TTSStreamCallback): Promise<void>;

  /**
   * Check if provider is available
   */
  isAvailable(): boolean;
}

export const DEFAULT_TTS_CONFIG: TTSConfig = {
  voice: 'alloy',
  speed: 1.0,
  format: 'pcm',
  sampleRate: 24000,
};
