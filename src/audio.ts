import type { EagleBehavior } from './eagle';

export class Soundscape {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private drone: OscillatorNode[] = [];
  private wind: AudioBufferSourceNode | null = null;
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
    if (!this.context || !this.music) return;
    const target = behavior === 'circling thermal' ? 0.06 : behavior === 'panoramic cruise' ? 0.035 : 0.022;
    this.music.gain.setTargetAtTime(target, this.context.currentTime, 3.5);
    const base = behavior === 'circling thermal' ? 123.47 : 110;
    this.drone.forEach((oscillator, index) => oscillator.frequency.setTargetAtTime(base * [1, 1.5, 2.25][index]!, this.context!.currentTime, 4));
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
    this.music.gain.value = 0.02;
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

    [110, 165, 247.5].forEach((frequency, index) => {
      const oscillator = this.context!.createOscillator();
      const gain = this.context!.createGain();
      oscillator.type = index === 0 ? 'sine' : 'triangle';
      oscillator.frequency.value = frequency;
      gain.gain.value = index === 0 ? 0.55 : 0.18;
      oscillator.connect(gain).connect(this.music!);
      oscillator.start();
      this.drone.push(oscillator);
    });
    this.applyVolume();
  }

  private applyVolume(): void {
    if (!this.context || !this.master) return;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.context.currentTime, 0.16);
  }
}
