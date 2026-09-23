import type { EagleBehavior } from './eagle';

const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16];
const MOODS: Record<EagleBehavior, { root: number; spacing: number; rest: number; rising: boolean }> = {
  'circling thermal': { root: 293.66, spacing: 0.9, rest: 9, rising: true },
  'seeking thermal': { root: 246.94, spacing: 1.3, rest: 15, rising: false },
  'scenic glide': { root: 220, spacing: 1.6, rest: 20, rising: false },
  'panoramic cruise': { root: 196, spacing: 2.2, rest: 26, rising: false },
};

export class Soundscape {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private wind: AudioBufferSourceNode | null = null;
  private nextPhrase = 0;
  private volume = 0.55;
  private muted = true;

  get isMuted(): boolean {
    return this.muted;
  }

  async setMuted(muted: boolean): Promise<void> {
    this.muted = muted;
    if (!muted) {
      this.ensureAudio();
      await this.context?.resume();
    }
    this.applyVolume();
  }

  setVolume(volume: number): void {
    this.volume = volume;
    this.applyVolume();
  }

  update(behavior: EagleBehavior): void {
    if (!this.context || !this.music || this.muted) return;
    const now = this.context.currentTime;
    if (now < this.nextPhrase) return;
    const mood = MOODS[behavior];
    const notes = 2 + Math.floor(Math.random() * 3);
    let degree = Math.floor(Math.random() * 4);
    for (let note = 0; note < notes; note += 1) {
      this.playNote(mood.root * 2 ** (PENTATONIC[degree]! / 12), now + note * mood.spacing, mood.spacing * 2.2);
      const step = mood.rising ? 1 : Math.random() < 0.5 ? -1 : 1;
      degree = Math.max(0, Math.min(PENTATONIC.length - 1, degree + step));
    }
    this.nextPhrase = now + notes * mood.spacing + mood.rest * (1 + Math.random() * 0.8);
  }

  private playNote(frequency: number, start: number, length: number): void {
    const oscillator = this.context!.createOscillator();
    const envelope = this.context!.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.value = frequency;
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(0.5, start + 0.35);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + length);
    oscillator.connect(envelope).connect(this.music!);
    oscillator.start(start);
    oscillator.stop(start + length + 0.05);
  }

  private ensureAudio(): void {
    if (this.context) return;
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.music = this.context.createGain();
    const windGain = this.context.createGain();
    const windFilter = this.context.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 680;
    windGain.gain.value = 0.075;
    this.music.gain.value = 0.09;
    this.master.connect(this.context.destination);
    windGain.connect(this.master);
    this.music.connect(this.master);

    const length = this.context.sampleRate * 4;
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const samples = buffer.getChannelData(0);
    let previous = 0;
    for (let index = 0; index < length; index += 1) {
      previous = previous * 0.985 + (Math.random() * 2 - 1) * 0.015;
      samples[index] = previous * 1.8;
    }
    this.wind = this.context.createBufferSource();
    this.wind.buffer = buffer;
    this.wind.loop = true;
    this.wind.connect(windFilter).connect(windGain);
    this.wind.start();

    this.nextPhrase = this.context.currentTime + 4;
    this.applyVolume();
  }

  private applyVolume(): void {
    if (!this.context || !this.master) return;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.context.currentTime, 0.16);
  }
}
