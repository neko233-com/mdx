import type { Node as ProseMirrorNode } from 'prosemirror-model'
import type { BundledLanguage, BundledTheme } from 'shiki'

import { findChildren } from '@tiptap/core'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

import { getShiki } from '@features/editor/extensions/codeblock-shiki/shiki/shiki-highlighter'

interface DecorationsOptions {
  doc: ProseMirrorNode
  name: string
  defaultTheme: BundledTheme
  defaultLanguage: BundledLanguage | 'plaintext' | null | undefined
}

// Shiki exposes VS Code TextMate's FontStyle as a bit mask:
// italic = 1, bold = 2, underline = 4, strikethrough = 8.
// Keep the conversion local so the editor only needs the token data and does
// not have to render Shiki's HTML output inside ProseMirror's contentDOM.
const FONT_STYLE_ITALIC = 1
const FONT_STYLE_BOLD = 2
const FONT_STYLE_UNDERLINE = 4
const FONT_STYLE_STRIKETHROUGH = 8

export function getTokenStyle(token: {
  color?: string
  bgColor?: string
  fontStyle?: number
}): string {
  const styles: string[] = []
  if (token.color) styles.push(`color: ${token.color}`)
  if (token.bgColor) styles.push(`background-color: ${token.bgColor}`)

  const fontStyle = token.fontStyle ?? 0
  if (fontStyle & FONT_STYLE_ITALIC) styles.push('font-style: italic')
  if (fontStyle & FONT_STYLE_BOLD) styles.push('font-weight: bold')

  const decorations: string[] = []
  if (fontStyle & FONT_STYLE_UNDERLINE) decorations.push('underline')
  if (fontStyle & FONT_STYLE_STRIKETHROUGH) decorations.push('line-through')
  if (decorations.length > 0) styles.push(`text-decoration: ${decorations.join(' ')}`)

  return styles.join('; ')
}

interface MermaidTokenColors {
  keyword: string
  string: string
  variable: string
  comment: string
  operator: string
  number: string
}

// The Shiki Mermaid grammar is designed for Mermaid embedded in Markdown and
// returns standalone Mermaid source as one default-colored token. Keep the
// lightweight code-mode fallback aligned with the two bundled GitHub themes.
const MERMAID_LIGHT_COLORS: MermaidTokenColors = {
  keyword: '#D73A49',
  string: '#032F62',
  variable: '#E36209',
  comment: '#6A737D',
  operator: '#6F42C1',
  number: '#005CC5',
}

const MERMAID_DARK_COLORS: MermaidTokenColors = {
  keyword: '#F97583',
  string: '#9ECBFF',
  variable: '#FFAB70',
  comment: '#6A737D',
  operator: '#B392F0',
  number: '#79B8FF',
}

const MERMAID_KEYWORDS = new Set([
  'architecture-beta',
  'block-beta',
  'class',
  'classDef',
  'click',
  'C4Context',
  'direction',
  'erDiagram',
  'else',
  'end',
  'flowchart',
  'gantt',
  'gitGraph',
  'graph',
  'journey',
  'linkStyle',
  'mindmap',
  'note',
  'participant',
  'pie',
  'quadrantChart',
  'rect',
  'requirementDiagram',
  'section',
  'sequenceDiagram',
  'stateDiagram',
  'stateDiagram-v2',
  'style',
  'subgraph',
  'sankey-beta',
  'timeline',
  'title',
  'xychart-beta',
])

const MERMAID_DIRECTIONS = new Set(['TB', 'TD', 'BT', 'RL', 'LR'])

const MERMAID_EDGE_PATTERN = /^(?:[-.=~]{2,}[>x]?|[<][-=.]{2,})/

function getMermaidTokenColors(theme: string): MermaidTokenColors {
  return theme.toLowerCase().includes('dark')
    ? MERMAID_DARK_COLORS
    : MERMAID_LIGHT_COLORS
}

function getMermaidDecorations(
  block: { node: ProseMirrorNode; pos: number },
  theme: string,
): Decoration[] {
  const colors = getMermaidTokenColors(theme)
  const decorations: Decoration[] = []
  const source = block.node.textContent
  let lineStart = 0

  const add = (from: number, to: number, color: string) => {
    if (from >= to) return
    decorations.push(Decoration.inline(block.pos + 1 + from, block.pos + 1 + to, {
      style: `color: ${color}`,
    }))
  }

  for (const line of source.split('\n')) {
    let index = 0
    while (index < line.length) {
      const absoluteIndex = lineStart + index

      if (line.startsWith('%%', index)) {
        add(absoluteIndex, lineStart + line.length, colors.comment)
        break
      }

      const character = line[index]
      if (/\s/.test(character)) {
        index += 1
        continue
      }

      if (character === '"' || character === "'") {
        const quote = character
        let end = index + 1
        while (end < line.length && line[end] !== quote) end += 1
        if (end < line.length) end += 1
        add(absoluteIndex, lineStart + end, colors.string)
        index = end
        continue
      }

      if (character === '|') {
        const end = line.indexOf('|', index + 1)
        if (end !== -1) {
          add(absoluteIndex, lineStart + end + 1, colors.string)
          index = end + 1
          continue
        }
      }

      const edge = line.slice(index).match(MERMAID_EDGE_PATTERN)?.[0]
      if (edge) {
        add(absoluteIndex, absoluteIndex + edge.length, colors.operator)
        index += edge.length
        continue
      }

      if (/[[\](){}<>]/.test(character)) {
        add(absoluteIndex, absoluteIndex + 1, colors.operator)
        index += 1
        continue
      }

      const number = line.slice(index).match(/^\d+(?:\.\d+)?/)
      if (number) {
        add(absoluteIndex, absoluteIndex + number[0].length, colors.number)
        index += number[0].length
        continue
      }

      const word = line.slice(index).match(/^[\w-]+/u)?.[0]
      if (word) {
        const color = MERMAID_KEYWORDS.has(word) || MERMAID_DIRECTIONS.has(word)
          ? colors.keyword
          : colors.variable
        add(absoluteIndex, absoluteIndex + word.length, color)
        index += word.length
        continue
      }

      index += 1
    }
    lineStart += line.length + 1
  }

  return decorations
}

// ── --shiki-theme CSS var 缓存 ────────────────────────────────────
//
// 该 var 由 useApplyTheme 在 app 主题切换时改写, 编辑过程中静态。
// 旧实现每次 getDecorations() 都直接 getComputedStyle(documentElement),
// 而该调用在存在 pending layout 的场景会强制同步 reflow ──
//
//   keystroke → transaction → apply() → getDecorations() → getComputedStyle
//   ────────────────── 同一调用栈, reflow 阻断后续代码 ──────────────────
//
// 1000 行代码块连续输入时, reflow 跟 tokenize 串联叠加, 主线程被
// 长时间占用。缓存读取结果, 把读路径退化成一个普通变量访问, 消
// 除 reflow。
//
// 失效时机 ── 由 shiki-plugin.ts 在 view() 挂载时挂 per-editor
// 'app-theme-changed' 监听器, 切主题时同步 invalidate + dispatch
// forceDecoration 触发 apply 重算。本模块自身不挂监听器 ── 缓存
// 与失效职责分离: 本文件管「读 + 缓存 + 暴露失效接口」, plugin
// 决定「何时失效」(只有 plugin 持有 editorView 引用, 才能在失
// 效后强制刷新装饰)。
let cachedCssTheme: string | null | undefined = undefined

function readCssTheme(): string {
  if (cachedCssTheme !== undefined) return cachedCssTheme ?? ''
  if (typeof document === 'undefined') {
    cachedCssTheme = null
    return ''
  }
  cachedCssTheme = getComputedStyle(document.documentElement)
    .getPropertyValue('--shiki-theme')
    .trim()
  return cachedCssTheme ?? ''
}

/** 失效缓存 ── 由 shiki-plugin 在收到 app-theme-changed 时调用,
 *  并伴随一次 shikiPluginForceDecoration dispatch 强制刷新装饰。
 *  Export 是因为 plugin 是同模块的兄弟文件, 需要 import 这个
 *  失效函数。 */
export function invalidateShikiThemeCache() {
  cachedCssTheme = undefined
}

export function getDecorations({
  doc,
  name,
  defaultTheme,
  defaultLanguage
}: DecorationsOptions) {
  const decorations: Decoration[] = []
  const highlighter = getShiki()

  // During the synchronous editor mount Shiki has not loaded yet. Avoid
  // traversing every code block just to return no decorations.
  if (!highlighter) return DecorationSet.empty

  const codeBlocks = findChildren(doc, node => node.type.name === name)

  codeBlocks.forEach((block) => {
    let language = block.node.attrs.language || defaultLanguage

    if (!highlighter.getLoadedLanguages().includes(language)) {
      language = 'plaintext'
    }

    let theme = block.node.attrs.theme || defaultTheme
    // Theme resolution: the --shiki-theme CSS var (app theme) is authoritative
    // whenever set — which is always, so node.attrs.theme / defaultTheme only act
    // as a fallback if the var is empty. node.attrs.theme remains in the schema for
    // forward-compat (future per-block picker).
    // 读路径走 readCssTheme() 缓存, 避免每个 keystroke 触发 getComputedStyle 强制 reflow。
    const cssTheme = readCssTheme()
    if (cssTheme) theme = cssTheme as BundledTheme
    const themeToApply = highlighter.getLoadedThemes().includes(theme)
      ? theme
      : highlighter.getLoadedThemes()[0]

    if ((block.node.attrs.language || '').toLowerCase() === 'mermaid') {
      decorations.push(...getMermaidDecorations(block, themeToApply))
      return
    }

    const lines = highlighter.codeToTokensBase(block.node.textContent, {
      lang: language,
      theme: themeToApply
    })

    let from = block.pos + 1

    lines.forEach((lineTokens, lineIndex) => {
      for (const token of lineTokens) {
        if (token.content.length === 0) continue

        const to = from + token.content.length

        const decoration = Decoration.inline(from, to, {
          style: `color: ${token.color}`
        })

        decorations.push(decoration)
        from = to
      }

      // ProseMirror text positions include the newline between Shiki lines.
      // Do not advance past the end of the final line.
      if (lineIndex < lines.length - 1) from += 1
    })
  })

  return DecorationSet.create(doc, decorations)
}
