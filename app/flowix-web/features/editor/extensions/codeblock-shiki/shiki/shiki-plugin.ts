import type { BundledLanguage, BundledTheme } from 'shiki'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'

import { Plugin, PluginKey } from '@tiptap/pm/state'

import { getDecorations, invalidateShikiThemeCache } from '@features/editor/extensions/codeblock-shiki/shiki/shiki-decorations'
import { getShiki, initHighlighter } from '@features/editor/extensions/codeblock-shiki/shiki/shiki-highlighter'
import { transactionNeedsShikiLoad, transactionTouchesCodeBlock } from './shiki-transaction-scope'
import { markDocumentOpenTrace } from '@/lib/document-open-perf'
import { notifyCodeBlockThemeChange } from '../theme-coordinator'

export interface PluginShikiOptions {
  name: string
  defaultLanguage: BundledLanguage | 'plaintext' | null | undefined
  defaultTheme: BundledTheme
  preloadThemes?: BundledTheme[]
  traceId?: number | null
}

// ── apply() 辅助 ────────────────────────────────────────────────────
//
// 旧实现 [findChildren(doc) × 2 + oldNodes.some(node => range ⊆ step)]
// 每次 transaction 走两遍完整 doc tree, 大文档 (数千节点) 时不算
// 便宜 ── 100 keystrokes/秒 × 2000 visits = 200K visits/秒, 长期
// 跑能吃掉可观的主线程预算。
//
// 新实现换成范围受限的遍历:
// 每个 StepMap 同时给出变更前、后的局部范围。分别检查 step 前后的
// 文档即可覆盖代码块内部编辑、创建、删除和替换，不需要为每次普通
// 输入统计新旧全文中的代码块数量。
//
// 顺带修正一个潜在正确性 bug: 旧检查 node.pos >= step.from &&
// node.pos + nodeSize <= step.to 是「代码块 ⊆ step」语义 ── 只捕
// 代码块删除; 代码块**内部编辑** (step 范围 < 代码块范围) 漏判,
// 依赖 condition A (selection 在代码块内) 兜底。新检查是范围相交,
// 两种语义同时覆盖, 即使将来有非交互式 transform 修改代码块内容
// 也能正确触发 rAF。
function countCodeBlocks(doc: ProseMirrorNode, typeName: string): number {
  let count = 0
  doc.descendants((node) => {
    if (node.type.name === typeName) count++
  })
  return count
}

interface ShikiPluginState {
  decorations: ReturnType<typeof getDecorations>
  loadVersion: number
}

export function proseMirrorPluginShiki(options: PluginShikiOptions) {
  const { name, defaultLanguage, defaultTheme, preloadThemes = [], traceId = null } = options

  // ── rAF 批处理 ────────────────────────────────────────────────
  //
  // 代码块内容变化的 keystroke 路径上, apply() 把昂贵的 getDecorations()
  // (全量 tokenize + 重建 DecorationSet) 改成「延迟到下一帧」: 同
  // 一帧内多个 keystroke 共用一次 tokenize, apply() 同步路径只返
  // 回 mapped set (positions 跟着 transaction.mapping 走, colors
  // 暂时 stale), 视觉延迟 < 16ms 不可察觉, 但避免单帧多次 tokenize
  // 串联阻断主线程 ── 1000 行代码块连续输入时从「每键 50–200ms」变
  // 成「每帧 1 次」。
  //
  // state 闭包 ── 每个 proseMirrorPluginShiki() 实例持有自己的
  // currentView / pendingRaf, 多编辑器场景不互相干扰。
  let currentView: EditorView | null = null
  let pendingRaf: number | null = null

  const flushRecompute = () => {
    // 先清 pendingRaf 再 dispatch ── 万一 dispatch 触发嵌套调用
    // scheduleRecompute, 状态机不会卡死。
    pendingRaf = null
    if (!currentView || currentView.isDestroyed) return
    currentView.dispatch(
      currentView.state.tr.setMeta('shikiPluginForceDecoration', true)
    )
  }

  const scheduleRecompute = () => {
    if (pendingRaf !== null) return
    pendingRaf = requestAnimationFrame(flushRecompute)
  }

  const shikiPlugin: Plugin = new Plugin({
    key: new PluginKey('codeBlockShiki'),

    state: {
      init: (_, { doc }) => {
        return {
          decorations: getDecorations({ doc, name, defaultLanguage, defaultTheme }),
          loadVersion: 0,
        } satisfies ShikiPluginState
      },

      apply: (transaction, pluginState, oldState, newState) => {
        const oldNodeName = oldState.selection.$head.parent.type.name
        const newNodeName = newState.selection.$head.parent.type.name

        // didChangeSomeCodeBlock 两条短路 OR, 任一为真即触发重算:
        //   A: selection 跨代码块 (光标进/出) ── 不需要扫 doc
        //   B: step 前后任一局部变更范围相交代码块 ── 覆盖内容编辑、
        //      创建、删除和替换，只遍历变更范围而非整篇 doc。
        let didChangeSomeCodeBlock = false
        let needsShikiLoad = false
        if (transaction.docChanged) {
          if ([oldNodeName, newNodeName].includes(name)) {
            didChangeSomeCodeBlock = true
          } else {
            didChangeSomeCodeBlock = transactionTouchesCodeBlock(transaction, name)
          }
          needsShikiLoad = transactionNeedsShikiLoad(transaction, name)
        }

        // 强制刷新路径 ── rAF 批处理触发 / highlighter 加载完成 /
        // 外部显式调用 forceDecoration。同步执行, 不再 batched, 确
        // 保调用方看到的 DecorationSet 立即反映 doc 状态。
        if (transaction.getMeta('shikiPluginForceDecoration')) {
          // 当前 transaction 已经把 doc 同步 tokenize 了一遍, 任何
          // 之前因 keystroke 排上的 rAF 都已无意义 ── 取消掉, 避
          // 免 rAF 触发后再跑一次相同输入的 getDecorations。
          if (pendingRaf !== null) {
            cancelAnimationFrame(pendingRaf)
            pendingRaf = null
          }
          return {
            decorations: getDecorations({
              doc: transaction.doc,
              name,
              defaultLanguage,
              defaultTheme
            }),
            loadVersion: pluginState.loadVersion,
          } satisfies ShikiPluginState
        }

        // 代码块内容变化 ── 排到下一帧统一重新计算, 当前 transaction
        // 同步路径返回 mapped set 即可, 避免在 keystroke 回调栈里
        // 跑全量 tokenize。
        if (didChangeSomeCodeBlock) {
          scheduleRecompute()
        }

        return {
          decorations: pluginState.decorations.map(transaction.mapping, transaction.doc),
          loadVersion: pluginState.loadVersion + (needsShikiLoad ? 1 : 0),
        } satisfies ShikiPluginState
      }
    },

    props: {
      decorations(state) {
        return shikiPlugin.getState(state).decorations
      }
    },

    // Lazy Shiki bootstrap: editor mount stays synchronous. Only documents that
    // actually contain code blocks import Shiki and load grammars/themes.
    view(editorView) {
      currentView = editorView
      let cancelled = false
      let pending = false
      let needsRerun = false
      let idleId: number | null = null
      let timeoutId: ReturnType<typeof setTimeout> | null = null

      const forceDecorations = () => {
        if (cancelled) return
        editorView.dispatch(
          editorView.state.tr.setMeta('shikiPluginForceDecoration', true)
        )
      }

      // ── 主题切换响应 ──────────────────────────────────────────
      // cssTheme 缓存 (shiki-decorations.ts) 把 getComputedStyle 从
      // hot path 上拿掉, 但缓存只在下次 getDecorations 才会被消费,
      // 而 getDecorations 只在 apply() 触发时跑 ── 用户切完主题
      // 若不再输入, apply() 不跑, 装饰颜色就停留在旧值。
      //
      // 这里在 view() 挂 per-editor 监听器, 主题切换时:
      //   1. invalidateShikiThemeCache() ── 清缓存, 下次 getDecorations
      //      强制重新读 --shiki-theme (拿新主题)
      //   2. forceDecorations() ── 派发 shikiPluginForceDecoration,
      //      触发一次 apply() 同步重算, 把新主题应用到所有现有装饰
      //
      // destroy() 时同步 removeEventListener, 不留 zombie listener。
      const handleThemeChange = () => {
        if (cancelled) return
        invalidateShikiThemeCache()
        notifyCodeBlockThemeChange(editorView)
        forceDecorations()
      }
      window.addEventListener('app-theme-changed', handleThemeChange)

      const loadForCurrentDoc = async () => {
        if (cancelled || pending) return
        pending = true
        needsRerun = false
        markDocumentOpenTrace(traceId, 'shiki:init-start', {
          codeBlockCount: countCodeBlocks(editorView.state.doc, name),
        })
        try {
          await initHighlighter({
            doc: editorView.state.doc,
            name,
            language: defaultLanguage ?? null,
            theme: defaultTheme,
            themes: preloadThemes,
          })
          markDocumentOpenTrace(traceId, 'shiki:ready')
          forceDecorations()
          markDocumentOpenTrace(traceId, 'shiki:first-decoration')
        } catch (err) {
          console.error('[CodeBlockShiki] failed to initialize highlighter:', err)
        } finally {
          pending = false
          if (needsRerun) scheduleLoad()
        }
      }

      const scheduleLoad = () => {
        if (cancelled) return
        if (pending) {
          needsRerun = true
          return
        }
        if (idleId !== null || timeoutId !== null) return

        if ('requestIdleCallback' in window) {
          idleId = window.requestIdleCallback(() => {
            idleId = null
            void loadForCurrentDoc()
          }, { timeout: 1200 })
        } else {
          timeoutId = globalThis.setTimeout(() => {
            timeoutId = null
            void loadForCurrentDoc()
          }, 300)
        }
      }

      if (countCodeBlocks(editorView.state.doc, name) > 0) scheduleLoad()

      return {
        update(view, prevState) {
          const docChanged = prevState.doc !== view.state.doc
          if (!docChanged && getShiki()) return
          const previousPluginState = shikiPlugin.getState(prevState)
          const currentPluginState = shikiPlugin.getState(view.state)
          if (currentPluginState.loadVersion !== previousPluginState.loadVersion) {
            scheduleLoad()
          }
        },
        destroy() {
          cancelled = true
          window.removeEventListener('app-theme-changed', handleThemeChange)
          if (idleId !== null && 'cancelIdleCallback' in window) {
            window.cancelIdleCallback(idleId)
            idleId = null
          }
          if (timeoutId !== null) {
            globalThis.clearTimeout(timeoutId)
            timeoutId = null
          }
          // 编辑器销毁时取消未触发的 rAF, 防止回调里访问已销毁的 view。
          if (pendingRaf !== null) {
            cancelAnimationFrame(pendingRaf)
            pendingRaf = null
          }
          if (currentView === editorView) currentView = null
        }
      }
    }
  })

  return shikiPlugin
}
