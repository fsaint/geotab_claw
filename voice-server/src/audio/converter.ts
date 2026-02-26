/**
 * Audio conversion utilities for Twilio <-> OpenAI Realtime
 *
 * Twilio Media Streams: mulaw 8kHz mono
 * OpenAI Realtime: PCM 16-bit 24kHz mono
 */

// Mulaw to linear PCM lookup table
const MULAW_TO_LINEAR: Int16Array = new Int16Array(256);
const LINEAR_TO_MULAW: Uint8Array = new Uint8Array(65536);

// Initialize lookup tables
(function initTables() {
  // Mulaw to linear
  for (let i = 0; i < 256; i++) {
    const mu = ~i;
    const sign = mu & 0x80 ? -1 : 1;
    const exponent = (mu >> 4) & 0x07;
    const mantissa = mu & 0x0f;
    const magnitude = ((mantissa << 3) + 0x84) << exponent;
    MULAW_TO_LINEAR[i] = sign * (magnitude - 0x84);
  }

  // Linear to mulaw
  for (let i = 0; i < 65536; i++) {
    const sample = i < 32768 ? i : i - 65536;
    LINEAR_TO_MULAW[i] = linearToMulaw(sample);
  }
})();

function linearToMulaw(sample: number): number {
  const BIAS = 0x84;
  const CLIP = 32635;

  const sign = sample < 0 ? 0x80 : 0;
  if (sample < 0) sample = -sample;
  if (sample > CLIP) sample = CLIP;

  sample += BIAS;

  let exponent = 7;
  for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1);

  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  const mulawByte = ~(sign | (exponent << 4) | mantissa) & 0xff;

  return mulawByte;
}

/**
 * Convert mulaw 8kHz to PCM 24kHz
 * Upsamples 3x using linear interpolation
 */
export function mulawToPcm24k(mulawData: Buffer): Buffer {
  const pcm8k = new Int16Array(mulawData.length);

  // Convert mulaw to linear PCM at 8kHz
  for (let i = 0; i < mulawData.length; i++) {
    pcm8k[i] = MULAW_TO_LINEAR[mulawData[i]];
  }

  // Upsample 3x to 24kHz using linear interpolation
  const pcm24k = new Int16Array(pcm8k.length * 3);
  for (let i = 0; i < pcm8k.length - 1; i++) {
    const curr = pcm8k[i];
    const next = pcm8k[i + 1];
    const idx = i * 3;
    pcm24k[idx] = curr;
    pcm24k[idx + 1] = Math.round(curr + (next - curr) / 3);
    pcm24k[idx + 2] = Math.round(curr + (2 * (next - curr)) / 3);
  }
  // Last sample
  const lastIdx = (pcm8k.length - 1) * 3;
  pcm24k[lastIdx] = pcm8k[pcm8k.length - 1];
  pcm24k[lastIdx + 1] = pcm8k[pcm8k.length - 1];
  pcm24k[lastIdx + 2] = pcm8k[pcm8k.length - 1];

  return Buffer.from(pcm24k.buffer);
}

/**
 * Convert PCM 24kHz to mulaw 8kHz
 * Downsamples 3x by taking every 3rd sample
 */
export function pcm24kToMulaw(pcmData: Buffer): Buffer {
  const pcm24k = new Int16Array(pcmData.buffer, pcmData.byteOffset, pcmData.length / 2);

  // Downsample 3x to 8kHz
  const outputLength = Math.floor(pcm24k.length / 3);
  const mulaw = Buffer.alloc(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const sample = pcm24k[i * 3];
    // Convert to unsigned for lookup
    const unsigned = sample < 0 ? sample + 65536 : sample;
    mulaw[i] = LINEAR_TO_MULAW[unsigned];
  }

  return mulaw;
}

/**
 * Convert base64 mulaw to base64 PCM 24kHz
 */
export function convertTwilioToOpenAI(base64Mulaw: string): string {
  const mulawBuffer = Buffer.from(base64Mulaw, 'base64');
  const pcmBuffer = mulawToPcm24k(mulawBuffer);
  return pcmBuffer.toString('base64');
}

/**
 * Convert base64 PCM 24kHz to base64 mulaw
 */
export function convertOpenAIToTwilio(base64Pcm: string): string {
  const pcmBuffer = Buffer.from(base64Pcm, 'base64');
  const mulawBuffer = pcm24kToMulaw(pcmBuffer);
  return mulawBuffer.toString('base64');
}

/**
 * Convert PCM audio to WAV format for Whisper API
 * @param pcmData - Raw PCM samples (Int16)
 * @param sampleRate - Sample rate (default 8000 for Twilio)
 * @param channels - Number of channels (default 1 for mono)
 * @returns WAV file as Buffer
 */
export function pcmToWav(pcmData: Buffer, sampleRate = 8000, channels = 1): Buffer {
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcmData.length;
  const headerSize = 44;

  const wav = Buffer.alloc(headerSize + dataSize);

  // RIFF header
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataSize, 4); // File size - 8
  wav.write('WAVE', 8);

  // fmt chunk
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16); // Chunk size
  wav.writeUInt16LE(1, 20); // Audio format (PCM)
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(byteRate, 28);
  wav.writeUInt16LE(blockAlign, 32);
  wav.writeUInt16LE(bitsPerSample, 34);

  // data chunk
  wav.write('data', 36);
  wav.writeUInt32LE(dataSize, 40);
  pcmData.copy(wav, 44);

  return wav;
}

/**
 * Convert mulaw to PCM without upsampling (stays at 8kHz)
 * Used for Whisper transcription
 */
export function mulawToPcm8k(mulawData: Buffer): Buffer {
  const pcm = new Int16Array(mulawData.length);

  for (let i = 0; i < mulawData.length; i++) {
    pcm[i] = MULAW_TO_LINEAR[mulawData[i]];
  }

  return Buffer.from(pcm.buffer);
}

/**
 * Convert PCM 24kHz to 8kHz for Whisper
 * Downsamples 3x by taking every 3rd sample
 */
export function pcm24kTo8k(pcmData: Buffer): Buffer {
  const pcm24k = new Int16Array(pcmData.buffer, pcmData.byteOffset, pcmData.length / 2);
  const outputLength = Math.floor(pcm24k.length / 3);
  const pcm8k = new Int16Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    pcm8k[i] = pcm24k[i * 3];
  }

  return Buffer.from(pcm8k.buffer);
}
