import type { EagleBehavior } from './eagle';

// Eight bars of an original, repeating D-major progression. The second pass
// changes the arpeggio order, so the bed stays connected without a long rest.
const HARMONY = [
  { bass: 50, chord: [0, 4, 7] },   // D
  { bass: 49, chord: [0, 3, 8] },   // A/C#
  { bass: 47, chord: [0, 3, 7] },   // Bm
  { bass: 43, chord: [0, 4, 7] },   // G
  { bass: 40, chord: [0, 3, 7] },   // Em
  { bass: 43, chord: [0, 4, 7] },   // G
  { bass: 45, chord: [0, 4, 7] },   // A
  { bass: 50, chord: [0, 4, 7] },   // D
] as const;
const BEAT = 0.42;
const BAR = BEAT * 6;

function frequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export class Soundscape {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambience: GainNode | null = null;
  private music: GainNode | null = null;
  private wind: AudioBufferSourceNode | null = null;
  private nextBar = 0;
  private bar = 0;
  private nextFlap = 0;
  private ambienceVolume = 0.52;
  private musicVolume = 0.52;
  private muted = true;

  get isMuted(): boolean {
    return this.muted;
  }

  /** Returns false if the browser cannot start audio; the sound stays muted. */
  async setMuted(muted: boolean): Promise<boolean> {
    if (!muted) {
      try {
        this.ensureAudio();
        await this.context!.resume();
        if (this.context!.state !== 'running') throw new Error('Audio did not start');
      } catch {
        this.muted = true;
        this.applyVolume();
        return false;
      }
    }
    this.muted = muted;
    this.applyVolume();
    return true;
  }

  setAmbienceVolume(volume: number): void {
    this.ambienceVolume = volume;
    this.applyVolume();
  }

  setMusicVolume(volume: number): void {
    this.musicVolume = volume;
    this.applyVolume();
  }

  update(behavior: EagleBehavior): void {
    if (!this.context || !this.music || this.muted) return;
    const now = this.context.currentTime;
    if (now >= this.nextBar - 0.08) {
      const start = Math.max(now + 0.04, this.nextBar);
      this.playBar(start, behavior);
      this.nextBar = start + BAR;
      this.bar += 1;
    }
    if (now >= this.nextFlap && this.wind?.buffer && this.ambience) {
      this.playFlap(now + 0.04);
      this.nextFlap = now + (behavior === 'circling thermal' ? 2.4 : 6.8);
    }
  }

  private playBar(start: number, behavior: EagleBehavior): void {
    const harmony = HARMONY[this.bar % HARMONY.length]!;
    const notes = harmony.chord.map((interval) => harmony.bass + 12 + interval);
    this.playTone(frequency(harmony.bass), start, BAR * 0.93, 0.28, 'sine', 0.18);
    for (const note of notes) {
      this.playTone(frequency(note), start, BAR * 0.97, 0.095, 'triangle', 0.65);
    }
    const order = Math.floor(this.bar / HARMONY.length) % 2 ? [0, 2, 1, 2, 1, 0] : [0, 1, 2, 1, 2, 1];
    for (let step = 0; step < order.length; step += 1) {
      this.playTone(frequency(notes[order[step]!]! + 12), start + step * BEAT, BEAT * 1.65, 0.13, 'sine', 0.045);
    }
    // A small answer every other bar lends shape without an exposed looping tune.
    if (this.bar % 2 === 1 && behavior !== 'panoramic cruise') {
      this.playTone(frequency(notes[2]! + 12), start + BEAT * 3, BEAT * 2.3, 0.11, 'triangle', 0.12);
    }
  }

  private playTone(frequencyHz: number, start: number, length: number, level: number, type: OscillatorType, attack: number): void {
    const oscillator = this.context!.createOscillator();
    const envelope = this.context!.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequencyHz;
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.linearRampToValueAtTime(level, start + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + length);
    oscillator.connect(envelope).connect(this.music!);
    oscillator.start(start);
    oscillator.stop(start + length + 0.05);
  }

  private playFlap(start: number): void {
    const source = this.context!.createBufferSource();
    const filter = this.context!.createBiquadFilter();
    const envelope = this.context!.createGain();
    source.buffer = this.wind!.buffer;
    filter.type = 'lowpass';
    filter.frequency.value = 410;
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.linearRampToValueAtTime(0.15, start + 0.15);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + 0.62);
    source.connect(filter).connect(envelope).connect(this.ambience!);
    source.start(start, Math.random() * 3);
    source.stop(start + 0.65);
  }

  private ensureAudio(): void {
    if (this.context) return;
    const context = new AudioContext();
    try {
      const master = context.createGain();
      const ambience = context.createGain();
      const music = context.createGain();
      master.gain.value = 0;
      master.connect(context.destination);
      ambience.connect(master);
      music.connect(master);

      const windGain = context.createGain();
      const windFilter = context.createBiquadFilter();
      windFilter.type = 'lowpass';
      windFilter.frequency.value = 680;
      windGain.gain.value = 0.075;
      windGain.connect(ambience);

      const length = context.sampleRate * 4;
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const samples = buffer.getChannelData(0);
      let previous = 0;
      for (let index = 0; index < length; index += 1) {
        previous = previous * 0.985 + (Math.random() * 2 - 1) * 0.015;
        samples[index] = previous * 1.8;
      }
      const wind = context.createBufferSource();
      wind.buffer = buffer;
      wind.loop = true;
      wind.connect(windFilter).connect(windGain);
      wind.start();

      this.context = context;
      this.master = master;
      this.ambience = ambience;
      this.music = music;
      this.wind = wind;
      this.nextBar = context.currentTime + 0.12;
      this.nextFlap = context.currentTime + 3;
      this.applyVolume();
    } catch (error) {
      void context.close().catch(() => {});
      throw error;
    }
  }

  private applyVolume(): void {
    if (!this.context || !this.master || !this.ambience || !this.music) return;
    const now = this.context.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 1, now, 0.16);
    this.ambience.gain.setTargetAtTime(this.ambienceVolume, now, 0.16);
    this.music.gain.setTargetAtTime(this.musicVolume * 0.12, now, 0.16);
  }
}
