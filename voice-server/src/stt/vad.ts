/**
 * Voice Activity Detection (VAD)
 *
 * Simple energy-based speech detection for detecting when the user
 * starts and stops speaking.
 */

export interface VADConfig {
  // Energy threshold for speech detection (0-1)
  threshold: number;
  // Minimum speech duration to trigger (ms)
  minSpeechDuration: number;
  // Silence duration to end speech (ms)
  silenceDuration: number;
  // Sample rate of input audio
  sampleRate: number;
}

export type VADState = 'silence' | 'speech' | 'uncertain';

export interface VADResult {
  state: VADState;
  energy: number;
  speechStarted: boolean;
  speechEnded: boolean;
}

const DEFAULT_CONFIG: VADConfig = {
  threshold: 0.02,
  minSpeechDuration: 100,
  silenceDuration: 500,
  sampleRate: 8000, // Twilio sends 8kHz
};

export class VoiceActivityDetector {
  private config: VADConfig;
  private state: VADState = 'silence';
  private speechStartTime: number | null = null;
  private lastSpeechTime: number | null = null;
  private energyHistory: number[] = [];
  private readonly historySize = 10;

  constructor(config: Partial<VADConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Process a chunk of PCM audio and detect voice activity
   * @param pcmData - Int16 PCM audio samples
   * @returns VAD result
   */
  process(pcmData: Int16Array): VADResult {
    const energy = this.calculateEnergy(pcmData);
    this.energyHistory.push(energy);
    if (this.energyHistory.length > this.historySize) {
      this.energyHistory.shift();
    }

    const smoothedEnergy = this.getSmoothedEnergy();
    const now = Date.now();
    const prevState = this.state;

    let speechStarted = false;
    let speechEnded = false;

    if (smoothedEnergy > this.config.threshold) {
      // Speech detected
      if (this.state === 'silence') {
        this.state = 'uncertain';
        this.speechStartTime = now;
      } else if (this.state === 'uncertain') {
        // Check if we've been speaking long enough
        if (this.speechStartTime && now - this.speechStartTime >= this.config.minSpeechDuration) {
          this.state = 'speech';
          speechStarted = true;
        }
      }
      this.lastSpeechTime = now;
    } else {
      // Silence detected
      if (this.state === 'speech' || this.state === 'uncertain') {
        // Check if we've been silent long enough
        if (this.lastSpeechTime && now - this.lastSpeechTime >= this.config.silenceDuration) {
          if (prevState === 'speech') {
            speechEnded = true;
          }
          this.state = 'silence';
          this.speechStartTime = null;
        }
      }
    }

    return {
      state: this.state,
      energy: smoothedEnergy,
      speechStarted,
      speechEnded,
    };
  }

  /**
   * Calculate RMS energy of audio samples
   */
  private calculateEnergy(samples: Int16Array): number {
    if (samples.length === 0) return 0;

    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      // Normalize to -1..1 range
      const normalized = samples[i] / 32768;
      sum += normalized * normalized;
    }
    return Math.sqrt(sum / samples.length);
  }

  /**
   * Get smoothed energy using moving average
   */
  private getSmoothedEnergy(): number {
    if (this.energyHistory.length === 0) return 0;
    const sum = this.energyHistory.reduce((a, b) => a + b, 0);
    return sum / this.energyHistory.length;
  }

  /**
   * Reset VAD state
   */
  reset(): void {
    this.state = 'silence';
    this.speechStartTime = null;
    this.lastSpeechTime = null;
    this.energyHistory = [];
  }

  /**
   * Get current state
   */
  getState(): VADState {
    return this.state;
  }

  /**
   * Check if currently in speech
   */
  isSpeaking(): boolean {
    return this.state === 'speech';
  }
}
