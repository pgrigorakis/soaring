import { AUDIO_BIOME_KEYS, BIOME_KEYS, BIOME_PROFILES, emptyBiomeWeights, type BiomeKey, type BiomeWeights } from './biome';
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
const BEATS_PER_BAR = 6;
const DEFAULT_WEIGHTS = emptyBiomeWeights();
DEFAULT_WEIGHTS[BIOME_KEYS[0]!] = 1;

function frequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function normalizeWeights(weights?: BiomeWeights): BiomeWeights {
  if (!weights) return DEFAULT_WEIGHTS;
  const safe = Object.fromEntries(AUDIO_BIOME_KEYS.map((key) => [
    key, Number.isFinite(weights[key]) ? Math.max(0, weights[key]) : 0,
  ])) as BiomeWeights;
  const total = AUDIO_BIOME_KEYS.reduce((sum, key) => sum + safe[key], 0);
  if (total <= 0) return DEFAULT_WEIGHTS;
  for (const key of AUDIO_BIOME_KEYS) safe[key] /= total;
  return safe;
}

type MusicFeel = {
  beat: number;
  register: number;
  openMajor: number;
  warmth: number;
  spaciousness: number;
  modal: number;
  sparse: number;
};

function musicFeel(weights: BiomeWeights): MusicFeel {
  const feel: MusicFeel = { beat: 0, register: 0, openMajor: 0, warmth: 0, spaciousness: 0, modal: 0, sparse: 0 };
  for (const key of AUDIO_BIOME_KEYS) {
    const audio = BIOME_PROFILES[key].audio;
    feel.beat += audio.beat * weights[key];
    if (audio.register !== 0) feel.register += audio.register * weights[key];
    feel[audio.mood] += weights[key];
  }
  return feel;
}

export class Soundscape {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambience: GainNode | null = null;
  private music: GainNode | null = null;
  private wind: AudioBufferSourceNode | null = null;
  private ambienceLayers: Record<keyof BiomeWeights, GainNode> | null = null;
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

  update(behavior: EagleBehavior, flapping: boolean, biome?: BiomeWeights): void {
    if (!this.context || !this.music || this.muted) return;
    const now = this.context.currentTime;
    const weights = normalizeWeights(biome);
    this.updateAmbience(weights, now);
    const feel = musicFeel(weights);
    if (now >= this.nextBar - 0.08) {
      const start = Math.max(now + 0.04, this.nextBar);
      this.playBar(start, behavior, feel);
      this.nextBar = start + feel.beat * BEATS_PER_BAR;
      this.bar += 1;
    }
    if (!flapping) {
      this.nextFlap = now;
    } else if (now >= this.nextFlap && this.wind?.buffer && this.ambience) {
      this.playFlap(now + 0.04);
      this.nextFlap = now + 0.8;
    }
  }

  private updateAmbience(weights: BiomeWeights, now: number): void {
    if (!this.ambienceLayers) return;
    const gust = Math.max(0, Math.sin(now * 0.22 + 0.7)) ** 2;
    const lap = 0.5 + 0.5 * Math.sin(now * 0.42);
    // Each target follows the world's existing visual weights. The short gain ramp
    // only removes clicks; it does not add a second biome boundary.
    for (const key of AUDIO_BIOME_KEYS) {
      const level = BIOME_PROFILES[key].audio.level({ weights, weight: weights[key], gust, lap });
      this.ambienceLayers[key].gain.setTargetAtTime(level, now, 0.28);
    }
  }

  private playBar(start: number, behavior: EagleBehavior, feel: MusicFeel): void {
    const barLength = feel.beat * BEATS_PER_BAR;
    const step = this.bar % 8;
    if (step === 0 && this.bar > 0) this.phrase = (this.phrase + 1 + Math.floor(Math.random() * (PHRASES.length - 1))) % PHRASES.length;
    const [bass, chord] = PHRASES[this.phrase]![step]!;
    const notes = [...chord, 12].map((interval, index) => {
      const openVoicing = index > 0 && index < 3 ? 12 * feel.openMajor : 0;
      return this.stylePitch(bass + 12 + interval + openVoicing, feel);
    });
    const root = this.stylePitch(bass, feel);
    const spacious = 1 + 0.7 * feel.spaciousness;
    const warmBass = 0.28 + 0.12 * feel.warmth;
    if (Math.random() >= feel.sparse * 0.78) {
      this.playTone(frequency(root), start, barLength * 0.93 * spacious, warmBass, 'sine', 0.18);
    }
    for (const note of notes.slice(0, 3)) {
      if (Math.random() < feel.sparse * 0.78) continue;
      this.playTone(frequency(note), start, barLength * 0.97 * spacious, 0.095, 'triangle', 0.65);
    }
    // Thermal-riding lifts the arpeggio an octave higher; ridge-soaring a fifth higher.
    const lift = behavior === 'thermal-riding' ? 24 : behavior === 'ridge-soaring' ? 19 : 12;
    const order = ARPEGGIOS[Math.floor(Math.random() * ARPEGGIOS.length)]!;
    order.forEach((noteIndex, position) => {
      if (Math.random() < feel.sparse * 0.78) return;
      this.playTone(frequency(notes[noteIndex]! + lift), start + position * feel.beat,
        feel.beat * 1.65 * spacious, 0.13 * (1 - 0.25 * feel.sparse), 'sine', 0.045);
    });
    if (this.bar % 2 === 1 && Math.random() >= feel.sparse * 0.8) {
      const answer = notes[1 + Math.floor(Math.random() * 3)]!;
      this.playTone(frequency(answer + 12), start + feel.beat * 3, feel.beat * 2.3 * spacious, 0.11, 'triangle', 0.12);
    }
  }

  private stylePitch(midi: number, feel: MusicFeel): number {
    // Flatten the leading tone into a Mixolydian colour as Highlands gains weight.
    const modalShift = ((Math.round(midi) % 12 + 12) % 12 === 1) ? feel.modal : 0;
    return midi + feel.register - modalShift;
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

      const length = context.sampleRate * 4;
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const samples = buffer.getChannelData(0);
      let previous = 0;
      for (let index = 0; index < length; index += 1) {
        previous = previous * 0.985 + (Math.random() * 2 - 1) * 0.015;
        samples[index] = previous * 1.8;
      }

      const makeLayer = (type: BiquadFilterType, cutoff: number, reverb = false) => {
        const source = context.createBufferSource();
        const filter = context.createBiquadFilter();
        const gain = context.createGain();
        source.buffer = buffer;
        source.loop = true;
        filter.type = type;
        filter.frequency.value = cutoff;
        gain.gain.value = 0;
        if (reverb) {
          const convolver = context.createConvolver();
          const impulseLength = Math.floor(context.sampleRate * 2.8);
          const impulse = context.createBuffer(1, impulseLength, context.sampleRate);
          const impulseSamples = impulse.getChannelData(0);
          for (let index = 0; index < impulseLength; index += 1) {
            const decay = (1 - index / impulseLength) ** 3;
            impulseSamples[index] = (Math.random() * 2 - 1) * decay * 0.07;
          }
          convolver.buffer = impulse;
          convolver.normalize = false;
          filter.connect(convolver).connect(gain);
        } else {
          filter.connect(gain);
        }
        gain.connect(ambience);
        source.connect(filter);
        source.start();
        return { source, gain };
      };

      const layers = Object.fromEntries(AUDIO_BIOME_KEYS.map((key) => {
        const audio = BIOME_PROFILES[key].audio;
        return [key, makeLayer(audio.filter, audio.cutoff, audio.reverb)];
      })) as Record<BiomeKey, ReturnType<typeof makeLayer>>;
      for (const key of AUDIO_BIOME_KEYS) {
        const config = BIOME_PROFILES[key].audio.drone;
        if (!config) continue;
        const drone = context.createOscillator();
        const droneLevel = context.createGain();
        drone.type = 'sine';
        drone.frequency.value = config.frequency;
        droneLevel.gain.value = config.level;
        drone.connect(droneLevel).connect(layers[key].gain);
        drone.start();
      }

      this.context = context;
      this.master = master;
      this.ambience = ambience;
      this.music = music;
      this.wind = layers[AUDIO_BIOME_KEYS.find((key) => BIOME_PROFILES[key].audio.wind)!].source;
      this.ambienceLayers = Object.fromEntries(AUDIO_BIOME_KEYS.map((key) => [key, layers[key].gain])) as Record<BiomeKey, GainNode>;
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
