import { describe, expect, it } from 'vitest'
import { extractHeadings } from './heading-outline-navigation'

describe('extractHeadings', () => {
  it('extracts H1-H4 in document order', () => {
    const root = document.createElement('div')
    root.innerHTML = '<h1>Title</h1><p>Text</p><h3>Section</h3><h4>Detail</h4>'

    expect(extractHeadings(root).map(({ level, text }) => ({ level, text }))).toEqual([
      { level: 1, text: 'Title' },
      { level: 3, text: 'Section' },
      { level: 4, text: 'Detail' },
    ])
  })

  it('ignores headings inside embedded editor nodes', () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <div class="agent-thread-card"><h2>Agent heading</h2></div>
      <div class="frontmatter-property-node"><h3>Property heading</h3></div>
      <h2>Document heading</h2>
    `

    expect(extractHeadings(root).map(({ text }) => text)).toEqual(['Document heading'])
  })

  it('does not include H5-H6', () => {
    const root = document.createElement('div')
    root.innerHTML = '<h1>Included</h1><h5>Ignored</h5><h6>Ignored</h6>'

    expect(extractHeadings(root).map(({ text }) => text)).toEqual(['Included'])
  })
})
