import { describe, expect, it } from 'vitest';
import { nativeMenuPositionBelowEnd } from './native-context-menu';

describe('native context menu helpers', () => {
  it('aligns a popup to the element right edge and clamps the left edge', () => {
    const element = {
      getBoundingClientRect: () => ({ right: 180, bottom: 64 }),
    } as Element;

    expect(nativeMenuPositionBelowEnd(element, 200)).toEqual({ x: 4, y: 68 });
    expect(nativeMenuPositionBelowEnd(element, 120, 8)).toEqual({ x: 60, y: 72 });
  });
});
