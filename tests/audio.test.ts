import { afterEach, expect, test, vi } from 'vitest';
import { Soundscape } from '../src/audio';

class Parameter {
  value = 1;
  target: number | null = null;
  setTargetAtTime(value: number): void { this.target = value; }
  setValueAtTime(value: number): void { this.value = value; }
  linearRampToValueAtTime(value: number): void { this.value = value; }
  exponentialRampToValueAtTime(value: number): void { this.value = value; }
}

class Node {
  output: Node | null = null;
  connect(target: Node): Node { this.output = target; return target; }
}

class Gain extends Node { gain = new Parameter(); }
class Filter extends Node { type = ''; frequency = new Parameter(); }
class Source extends Node {
  buffer: { getChannelData: () => Float32Array } | null = null;
  loop = false;
  frequency = new Parameter();
  type = '';
  start(): void {}
  stop(): void {}
}

class BrowserAudio {
  static instances: BrowserAudio[] = [];
  destination = new Node();
  state = 'suspended';
  currentTime = 0;
  sampleRate = 100;
  sources: Source[] = [];
  rejectResume = false;
  failBuffer = false;
  constructor() { BrowserAudio.instances.push(this); }
  createGain(): Gain { return new Gain(); }
  createBiquadFilter(): Filter { return new Filter(); }
  createBufferSource(): Source { const source = new Source(); this.sources.push(source); return source; }
  createOscillator(): Source { const source = new Source(); this.sources.push(source); return source; }
  createBuffer(_channels: number, length: number): { getChannelData: () => Float32Array } {
    if (this.failBuffer) throw new Error('Buffer unavailable');
    return { getChannelData: () => new Float32Array(length) };
  }
  async close(): Promise<void> { this.state = 'closed'; }
  async resume(): Promise<void> {
    if (this.rejectResume) throw new Error('Audio blocked');
    this.state = 'running';
  }
}

// Only inspect the levels on the routed signal path, not the instruments or notes.
function outputLevel(source: Source): number {
  let level = 1;
  let node: Node | null = source;
  while (node) {
    if (node instanceof Gain) level *= node.gain.target ?? node.gain.value;
    node = node.output;
  }
  return level;
}

afterEach(() => { vi.unstubAllGlobals(); BrowserAudio.instances = []; });

test('ambience (wind and flaps) and music each have an independent output level and shared mute', async () => {
  vi.stubGlobal('AudioContext', BrowserAudio);
  const sound = new Soundscape();
  expect(await sound.setMuted(false)).toBe(true);
  const context = BrowserAudio.instances[0]!;
  context.currentTime = 4;
  sound.update('seeking thermal');
  const wind = context.sources.find((source) => source.loop)!;
  const flap = context.sources.find((source) => source.buffer && !source.loop)!;
  const music = context.sources.find((source) => !source.buffer)!;
  expect(wind).toBeDefined();
  expect(flap).toBeDefined();
  expect(music).toBeDefined();
  const original = [outputLevel(wind), outputLevel(flap), outputLevel(music)];
  expect(original.every((value) => value > 0)).toBe(true);

  sound.setAmbienceVolume(0.26);
  expect(outputLevel(wind) / original[0]!).toBeCloseTo(0.5);
  expect(outputLevel(flap) / original[1]!).toBeCloseTo(0.5);
  expect(outputLevel(music) / original[2]!).toBeCloseTo(1);

  sound.setMusicVolume(0.13);
  expect(outputLevel(wind) / original[0]!).toBeCloseTo(0.5);
  expect(outputLevel(flap) / original[1]!).toBeCloseTo(0.5);
  expect(outputLevel(music) / original[2]!).toBeCloseTo(0.25);

  await sound.setMuted(true);
  expect([wind, flap, music].map(outputLevel)).toEqual([0, 0, 0]);
  await sound.setMuted(false);
  expect(outputLevel(wind)).toBeGreaterThan(0);
});

test('flaps sound only while seeking a thermal, including after a glide', async () => {
  vi.stubGlobal('AudioContext', BrowserAudio);
  const sound = new Soundscape();
  await sound.setMuted(false);
  const context = BrowserAudio.instances[0]!;
  const flapCount = () => context.sources.filter((source) => source.buffer && !source.loop).length;

  context.currentTime = 4;
  sound.update('circling thermal');
  context.currentTime = 7;
  sound.update('circling thermal');
  expect(flapCount()).toBe(0);

  context.currentTime = 7.1;
  sound.update('seeking thermal');
  expect(flapCount()).toBe(1);
  context.currentTime = 7.5;
  sound.update('seeking thermal');
  expect(flapCount()).toBe(1);
  context.currentTime = 8;
  sound.update('seeking thermal');
  expect(flapCount()).toBe(2);

  context.currentTime = 11;
  sound.update('circling thermal');
  context.currentTime = 14;
  sound.update('circling thermal');
  context.currentTime = 17;
  sound.update('scenic glide');
  expect(flapCount()).toBe(2);

  context.currentTime = 17.1;
  sound.update('seeking thermal');
  expect(flapCount()).toBe(3);
});

test('audio startup errors leave the sound muted and a later gesture can retry', async () => {
  const sound = new Soundscape();
  // The first failure can happen before a context exists.
  vi.stubGlobal('AudioContext', class { constructor() { throw new Error('Unavailable'); } });
  expect(await sound.setMuted(false)).toBe(false);
  expect(sound.isMuted).toBe(true);
  vi.stubGlobal('AudioContext', class extends BrowserAudio {
    constructor() { super(); this.failBuffer = true; }
  });
  expect(await sound.setMuted(false)).toBe(false);
  expect(BrowserAudio.instances[0]!.state).toBe('closed');
  vi.stubGlobal('AudioContext', BrowserAudio);
  expect(await sound.setMuted(false)).toBe(true);
  const context = BrowserAudio.instances[1]!;
  await sound.setMuted(true);
  context.rejectResume = true;
  expect(await sound.setMuted(false)).toBe(false);
  expect(sound.isMuted).toBe(true);
  context.rejectResume = false;
  expect(await sound.setMuted(false)).toBe(true);
});

test('the musical bed stays in D major but does not settle into a fixed loop', async () => {
  vi.stubGlobal('AudioContext', BrowserAudio);
  const sound = new Soundscape();
  await sound.setMuted(false);
  const context = BrowserAudio.instances[0]!;
  const bars: string[] = [];
  for (let bar = 0; bar < 96; bar += 1) {
    const before = context.sources.length;
    context.currentTime = 1 + bar * 2.52;
    sound.update(bar % 3 ? 'scenic glide' : 'circling thermal');
    const notes = context.sources.slice(before).filter((source) => !source.buffer)
      .map((source) => Math.round(69 + 12 * Math.log2(source.frequency.value / 440)));
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) expect([1, 2, 4, 6, 7, 9, 11]).toContain(note % 12);
    bars.push(notes.join());
  }
  // The earlier fixed bed repeated every 16 bars.
  const cycle = (period: number) => bars.every((notes, index) => index < period || notes === bars[index - period]);
  expect([8, 16, 32, 48].some(cycle)).toBe(false);
  expect(new Set(bars).size).toBeGreaterThan(32);
});
