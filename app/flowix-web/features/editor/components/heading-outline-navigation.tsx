import type { Editor } from '@tiptap/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '@/lib/i18n'

const HEADING_SELECTOR = 'h1, h2, h3, h4'
const NON_DOCUMENT_HEADING_SELECTOR = '.agent-thread-card, .frontmatter-property-node'
const REVEAL_DELAY_MS = 450
const SCROLL_OFFSET_PX = 16

export interface HeadingItem {
  element: HTMLElement
  level: 1 | 2 | 3 | 4
  text: string
}

export function extractHeadings(editorRoot: HTMLElement): HeadingItem[] {
  return Array.from(editorRoot.querySelectorAll<HTMLElement>(HEADING_SELECTOR))
    .filter((heading) => !heading.closest(NON_DOCUMENT_HEADING_SELECTOR))
    .map((element) => ({
      element,
      level: Number(element.tagName.slice(1)) as HeadingItem['level'],
      text: element.textContent?.trim() ?? '',
    }))
}

function readHeadings(editor: Editor): HeadingItem[] {
  if (editor.isDestroyed) return []
  return extractHeadings(editor.view.dom)
}

function getScrollContainer(editor: Editor): HTMLElement | null {
  if (editor.isDestroyed) return null
  return editor.view.dom.closest<HTMLElement>('.editor-content')
}

function getActiveHeadingIndex(headings: HeadingItem[], scrollContainer: HTMLElement): number {
  const threshold = scrollContainer.getBoundingClientRect().top + 72
  let activeIndex = 0

  headings.forEach((heading, index) => {
    if (heading.element.getBoundingClientRect().top <= threshold) activeIndex = index
  })

  return activeIndex
}

export function HeadingOutlineNavigation({ editor }: { editor: Editor }) {
  const { t } = useI18n()
  const [headings, setHeadings] = useState<HeadingItem[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [visible, setVisible] = useState(false)
  const headingsRef = useRef<HeadingItem[]>([])

  const refreshHeadings = useCallback(() => {
    const nextHeadings = readHeadings(editor)
    headingsRef.current = nextHeadings
    setHeadings(nextHeadings)
  }, [editor])

  useEffect(() => {
    refreshHeadings()
    editor.on('update', refreshHeadings)

    return () => {
      editor.off('update', refreshHeadings)
    }
  }, [editor, refreshHeadings])

  useEffect(() => {
    setActiveIndex(0)
    if (headings.length === 0) {
      setVisible(false)
      return
    }

    const revealTimer = window.setTimeout(() => setVisible(true), REVEAL_DELAY_MS)
    return () => window.clearTimeout(revealTimer)
  }, [headings.length])

  useEffect(() => {
    const scrollContainer = getScrollContainer(editor)
    if (!scrollContainer) return

    let frameId: number | null = null
    const updateActiveHeading = () => {
      frameId = null
      const currentHeadings = headingsRef.current
      const nextIndex = currentHeadings.length === 0
        ? 0
        : getActiveHeadingIndex(currentHeadings, scrollContainer)
      setActiveIndex((current) => current === nextIndex ? current : nextIndex)
    }
    const scheduleUpdate = () => {
      if (frameId !== null) return
      frameId = window.requestAnimationFrame(updateActiveHeading)
    }

    updateActiveHeading()
    scrollContainer.addEventListener('scroll', scheduleUpdate, { passive: true })
    window.addEventListener('resize', scheduleUpdate)

    return () => {
      scrollContainer.removeEventListener('scroll', scheduleUpdate)
      window.removeEventListener('resize', scheduleUpdate)
      if (frameId !== null) window.cancelAnimationFrame(frameId)
    }
  }, [editor])

  useEffect(() => {
    const scrollContainer = getScrollContainer(editor)
    if (scrollContainer && headings.length > 0) {
      setActiveIndex(getActiveHeadingIndex(headings, scrollContainer))
    }
  }, [editor, headings])

  const scrollToHeading = (heading: HeadingItem, index: number) => {
    const scrollContainer = getScrollContainer(editor)
    if (!scrollContainer) return

    const targetRect = heading.element.getBoundingClientRect()
    const containerRect = scrollContainer.getBoundingClientRect()
    const top = Math.max(
      0,
      scrollContainer.scrollTop + targetRect.top - containerRect.top - SCROLL_OFFSET_PX,
    )
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    setActiveIndex(index)
    scrollContainer.scrollTo({
      top,
      behavior: reduceMotion ? 'auto' : 'smooth',
    })
  }

  if (headings.length === 0 || !visible) return null

  return (
    <div className="heading-outline-navigation-anchor">
      <nav
        className="heading-outline-navigation"
        aria-label={t('editor.headingOutline.ariaLabel')}
      >
        {headings.map((heading, index) => (
          <button
            key={`${heading.level}-${index}`}
            type="button"
            className={`heading-outline-navigation__item${index === activeIndex ? ' is-active' : ''}`}
            data-level={heading.level}
            aria-label={heading.text || `H${heading.level}`}
            aria-current={index === activeIndex ? 'location' : undefined}
            title={heading.text || `H${heading.level}`}
            onClick={() => scrollToHeading(heading, index)}
          />
        ))}
      </nav>
    </div>
  )
}
