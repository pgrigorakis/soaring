import { Color } from 'three';
import type { CrownTints } from './types';

export const colors = (palette: readonly number[]) => palette.map((hex) => new Color(hex));
export const DEFAULT_CROWNS: CrownTints = {
  species: [[0x1f5a34], [0x2e7a3e], [0x9dbf4e]],
  autumnOdds: 0,
  autumn: [0xd9a441, 0xc9772e],
};
