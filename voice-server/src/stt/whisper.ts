/**
 * OpenAI Whisper API client for Speech-to-Text
 */

import { config } from '../config';

export interface WhisperConfig {
  apiKey: string;
  model: 'whisper-1';
  language?: string;
  prompt?: string;
}

export interface WhisperResult {
  text: string;
  language?: string;
  duration?: number;
}

const DEFAULT_CONFIG: Partial<WhisperConfig> = {
  model: 'whisper-1',
  language: 'en',
};

/**
 * Transcribe audio using OpenAI Whisper API
 * @param audioWav - WAV audio as Buffer
 * @param options - Whisper configuration options
 * @returns Transcription result
 */
export async function transcribe(
  audioWav: Buffer,
  options: Partial<WhisperConfig> = {}
): Promise<WhisperResult> {
  const apiKey = options.apiKey || config.openai.apiKey;

  if (!apiKey) {
    throw new Error('OpenAI API key is required for Whisper transcription');
  }

  // Create form data with the audio file
  const formData = new FormData();
  const audioBlob = new Blob([audioWav], { type: 'audio/wav' });
  formData.append('file', audioBlob, 'audio.wav');
  formData.append('model', options.model || DEFAULT_CONFIG.model!);

  if (options.language || DEFAULT_CONFIG.language) {
    formData.append('language', options.language || DEFAULT_CONFIG.language!);
  }

  if (options.prompt) {
    formData.append('prompt', options.prompt);
  }

  formData.append('response_format', 'verbose_json');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Whisper API error: ${response.status} ${error}`);
  }

  const result = await response.json() as {
    text?: string;
    language?: string;
    duration?: number;
  };

  return {
    text: result.text || '',
    language: result.language,
    duration: result.duration,
  };
}

/**
 * Buffer manager for accumulating audio chunks before transcription
 */
export class AudioBuffer {
  private chunks: Buffer[] = [];
  private totalBytes = 0;
  private readonly maxDurationMs: number;
  private readonly sampleRate: number;
  private readonly bytesPerSample = 2; // 16-bit

  constructor(maxDurationMs = 30000, sampleRate = 8000) {
    this.maxDurationMs = maxDurationMs;
    this.sampleRate = sampleRate;
  }

  /**
   * Add audio chunk to buffer
   */
  append(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.totalBytes += chunk.length;
  }

  /**
   * Get accumulated audio as single buffer
   */
  getBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }

  /**
   * Get duration of buffered audio in milliseconds
   */
  getDurationMs(): number {
    const samples = this.totalBytes / this.bytesPerSample;
    return (samples / this.sampleRate) * 1000;
  }

  /**
   * Check if buffer has reached maximum duration
   */
  isFull(): boolean {
    return this.getDurationMs() >= this.maxDurationMs;
  }

  /**
   * Clear the buffer
   */
  clear(): void {
    this.chunks = [];
    this.totalBytes = 0;
  }

  /**
   * Check if buffer has audio
   */
  hasData(): boolean {
    return this.totalBytes > 0;
  }

  /**
   * Get total bytes in buffer
   */
  getByteLength(): number {
    return this.totalBytes;
  }
}
