import { Color } from 'three';
import type { CrownTints } from './types';

export const colors = (palette: readonly number[]) => palette.map((hex) => new Color(hex));
export const DEFAULT_CROWNS: CrownTints = {
  species: [[0x2c6b49], [0x518628], [0x9bc558]],
  autumnOdds: 0,
  autumn: [0xd1a249, 0xc88a3a],
};
