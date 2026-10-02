import type { EagleBehavior } from './eagle';

// Four original eight-bar D-major phrases. Phrases, arpeggio shapes, and
// answer notes are picked at random, so the bed stays coherent without looping.
const MAJOR = [0, 4, 7];
const MINOR = [0, 3, 7];
const FIRST_INVERSION = [0, 3, 8];
const PHRASES = [
  [[50, MAJOR], [49, FIRST_INVERSION], [47, MINOR], [43, MAJOR], [40, MINOR], [43, MAJOR], [45, MAJOR], [50, MAJOR]],
  [[43, MAJOR], [42, FIRST_INVERSION], [40, MINOR], [45, MAJOR], [47, MINOR], [43, MAJOR], [45, MAJOR], [50, MAJOR]],
  [[47, MINOR], [43, MAJOR], [50, MAJOR], [45, MAJOR], [47, MINOR], [40, MINOR], [45, MAJOR], [50, MAJOR]],
  [[43, MAJOR], [45, MAJOR], [42, MINOR], [47, MINOR], [40, MINOR], [45, MAJOR], [43, MAJOR], [50, MAJOR]],
] as const;
const ARPEGGIOS = [[0, 1, 2, 1, 2, 1], [0, 2, 1, 2, 1, 0], [2, 1, 0, 1, 2, 3], [0, 1, 2, 3, 2, 1]] as const;
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
  private phrase = 0;
  private nextFlap = 0;
  private ambienceVolume = 0.52;
  private musicVolume = 0.52;
  private muted = true;
  private muteRequest = 0;

  get isMuted(): boolean {
    return this.muted;
  }

  /** Returns false if the browser cannot start audio; the sound stays muted. */
  async setMuted(muted: boolean): Promise<boolean> {
    const request = ++this.muteRequest;
    if (!muted) {
      try {
        this.ensureAudio();
        await this.context!.resume();
        if (this.context!.state !== 'running') throw new Error('Audio did not start');
      } catch {
        if (request !== this.muteRequest) return true;
        this.muted = true;
        this.applyVolume();
        return false;
      }
    }
    if (request !== this.muteRequest) return true;
    this.muted = muted;
    this.applyVolume();
    return true;
  }

  suspendForPageHide(): void {
    if (!this.context || this.context.state === 'closed') return;
    void this.context.suspend().catch(() => {});
  }

  resumeForPageShow(): void {
    if (!this.context || this.muted || this.context.state === 'closed') return;
    void this.context.resume().catch(() => {});
  }

  setAmbienceVolume(volume: number): void {
    this.ambienceVolume = volume;
    this.applyVolume();
  }

  setMusicVolume(volume: number): void {
    this.musicVolume = volume;
    this.applyVolume();
  }

  update(behavior: EagleBehavior, flapping: boolean): void {
    if (!this.context || !this.music || this.muted) return;
    const now = this.context.currentTime;
    if (now >= this.nextBar - 0.08) {
      const start = Math.max(now + 0.04, this.nextBar);
      this.playBar(start, behavior);
      this.nextBar = start + BAR;
      this.bar += 1;
    }
    if (!flapping) {
      this.nextFlap = now;
    } else if (now >= this.nextFlap && this.wind?.buffer && this.ambience) {
      this.playFlap(now + 0.04);
      this.nextFlap = now + 0.8;
    }
  }

  private playBar(start: number, behavior: EagleBehavior): void {
    const step = this.bar % 8;
    if (step === 0 && this.bar > 0) this.phrase = (this.phrase + 1 + Math.floor(Math.random() * (PHRASES.length - 1))) % PHRASES.length;
    const [bass, chord] = PHRASES[this.phrase]![step]!;
    const notes = [...chord, 12].map((interval) => bass + 12 + interval);
    this.playTone(frequency(bass), start, BAR * 0.93, 0.28, 'sine', 0.18);
    for (const note of notes.slice(0, 3)) {
      this.playTone(frequency(note), start, BAR * 0.97, 0.095, 'triangle', 0.65);
    }
    // Thermal-riding lifts the arpeggio an octave higher; ridge-soaring a fifth higher.
    const lift = behavior === 'thermal-riding' ? 24 : behavior === 'ridge-soaring' ? 19 : 12;
    const order = ARPEGGIOS[Math.floor(Math.random() * ARPEGGIOS.length)]!;
    order.forEach((noteIndex, position) => {
      this.playTone(frequency(notes[noteIndex]! + lift), start + position * BEAT, BEAT * 1.65, 0.13, 'sine', 0.045);
    });
    if (this.bar % 2 === 1) {
      const answer = notes[1 + Math.floor(Math.random() * 3)]!;
      this.playTone(frequency(answer + 12), start + BEAT * 3, BEAT * 2.3, 0.11, 'triangle', 0.12);
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
