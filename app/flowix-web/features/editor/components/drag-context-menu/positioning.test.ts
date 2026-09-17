import { describe, expect, it } from 'vitest'

import { headingContentY, nodeContentX, nodeContentY } from './positioning'

describe('drag handle scroll-content coordinates', () => {
  it('keeps a non-ProseMirror header in the block Y coordinate', () => {
    // Scroller begins at viewport y=100. A title/header occupies 60px, so the
    // selected block begins at viewport y=180. The handle must retain that
    // 80px content offset instead of subtracting ProseMirror's shifted top.
    expect(nodeContentY(180, 100, 0, 3)).toBe(83)
  })

  it('produces a stable content coordinate while the container scrolls', () => {
    expect(nodeContentY(180, 100, 0, 3)).toBe(83)
    expect(nodeContentY(140, 100, 40, 3)).toBe(83)
  })

  it('uses the same scroll-content coordinate system on X', () => {
    expect(nodeContentX(240, 100, 0)).toBe(158)
    expect(nodeContentX(220, 100, 20)).toBe(158)
  })
})

describe('heading text-line coordinates', () => {
  const headingInfo = {
    typeName: 'heading',
    pos: 7,
  } as Parameters<typeof headingContentY>[1]

  it('anchors to the first text line, including heading padding', () => {
    const view = {
      coordsAtPos: (pos: number) => {
        expect(pos).toBe(8)
        return { top: 236, bottom: 273, left: 0, right: 0 }
      },
    } as unknown as Parameters<typeof headingContentY>[0]

    expect(headingContentY(view, headingInfo, 100, 0)).toBe(136)
    expect(headingContentY(view, headingInfo, 136, 36)).toBe(136)
  })

  it('returns null for non-heading blocks', () => {
    const view = {} as Parameters<typeof headingContentY>[0]
    expect(headingContentY(view, { ...headingInfo, typeName: 'paragraph' }, 100, 0)).toBeNull()
  })

  it('falls back when the PM view cannot resolve the position', () => {
    const view = {
      coordsAtPos: () => { throw new Error('destroyed') },
    } as unknown as Parameters<typeof headingContentY>[0]

    expect(headingContentY(view, headingInfo, 100, 0)).toBeNull()
  })
})
