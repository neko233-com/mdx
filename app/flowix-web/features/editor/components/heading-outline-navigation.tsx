import type { Editor } from '@tiptap/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '@/lib/i18n'

const HEADING_SELECTOR = 'h1, h2, h3, h4'
const NON_DOCUMENT_HEADING_SELECTOR = '.agent-thread-card, .frontmatter-property-node'
const MAX_OUTLINE_ITEMS = 30
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

/**
 * Keep the compact outline usable for long documents by dropping the least
 * important heading levels first. This only changes the navigation; the
 * document headings themselves remain untouched.
 */
export function filterHeadingsForOutline(headings: HeadingItem[]): HeadingItem[] {
  if (headings.length <= MAX_OUTLINE_ITEMS) return headings

  const withoutH4 = headings.filter((heading) => heading.level !== 4)
  if (withoutH4.length <= MAX_OUTLINE_ITEMS) return withoutH4

  // H1/H2 are always retained. If those alone exceed the limit, showing more
  // than 30 items is preferable to hiding structural headings.
  return withoutH4.filter((heading) => heading.level !== 3)
}

export function getNavigationActiveElement(
  allHeadings: HeadingItem[],
  visibleHeadings: HeadingItem[],
  activeElement: HTMLElement | null,
): HTMLElement | null {
  if (!activeElement) return null

  const visibleElements = new Set(visibleHeadings.map((heading) => heading.element))
  const activeIndex = allHeadings.findIndex((heading) => heading.element === activeElement)
  if (activeIndex < 0) return null

  for (let index = activeIndex; index >= 0; index -= 1) {
    const element = allHeadings[index].element
    if (visibleElements.has(element)) return element
  }

  return null
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
  const [allHeadings, setAllHeadings] = useState<HeadingItem[]>([])
  const [activeElement, setActiveElement] = useState<HTMLElement | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [visible, setVisible] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const allHeadingsRef = useRef<HeadingItem[]>([])
  const headings = filterHeadingsForOutline(allHeadings)

  const refreshHeadings = useCallback(() => {
    const nextHeadings = readHeadings(editor)
    allHeadingsRef.current = nextHeadings
    setAllHeadings(nextHeadings)
  }, [editor])

  useEffect(() => {
    refreshHeadings()
    editor.on('update', refreshHeadings)

    return () => {
      editor.off('update', refreshHeadings)
    }
  }, [editor, refreshHeadings])

  useEffect(() => {
    setActiveElement(null)
    if (allHeadings.length === 0) {
      setVisible(false)
      return
    }

    const revealTimer = window.setTimeout(() => setVisible(true), REVEAL_DELAY_MS)
    return () => window.clearTimeout(revealTimer)
  }, [allHeadings.length])

  useEffect(() => {
    if (!expanded) return

    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && !anchorRef.current?.contains(target)) {
        setExpanded(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false)
    }

    document.addEventListener('pointerdown', closeOnPointerDown, true)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown, true)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [expanded])

  useEffect(() => {
    const scrollContainer = getScrollContainer(editor)
    if (!scrollContainer) return

    let frameId: number | null = null
    const updateActiveHeading = () => {
      frameId = null
      const currentHeadings = allHeadingsRef.current
      const nextHeading = currentHeadings.length === 0
        ? null
        : currentHeadings[getActiveHeadingIndex(currentHeadings, scrollContainer)] ?? null
      setActiveElement((current) => current === nextHeading?.element ? current : nextHeading?.element ?? null)
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
    if (scrollContainer && allHeadings.length > 0) {
      const activeHeading = allHeadings[getActiveHeadingIndex(allHeadings, scrollContainer)]
      setActiveElement(activeHeading?.element ?? null)
    }
  }, [editor, allHeadings])

  const scrollToHeading = (heading: HeadingItem) => {
    const scrollContainer = getScrollContainer(editor)
    if (!scrollContainer) return

    const targetRect = heading.element.getBoundingClientRect()
    const containerRect = scrollContainer.getBoundingClientRect()
    const top = Math.max(
      0,
      scrollContainer.scrollTop + targetRect.top - containerRect.top - SCROLL_OFFSET_PX,
    )
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    setActiveElement(heading.element)
    setExpanded(false)
    scrollContainer.scrollTo({
      top,
      behavior: reduceMotion ? 'auto' : 'smooth',
    })
  }

  const navigationActiveElement = getNavigationActiveElement(
    allHeadings,
    headings,
    activeElement,
  )

  if (allHeadings.length === 0 || !visible) return null

  return (
    <div ref={anchorRef} className="heading-outline-navigation-anchor">
      <nav
        className="heading-outline-navigation"
        role="button"
        tabIndex={0}
        aria-label={t('editor.headingOutline.ariaLabel')}
        aria-expanded={expanded}
        onClick={() => setExpanded(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setExpanded(true)
          }
        }}
      >
        {headings.map((heading, index) => (
          <span
            key={`${heading.level}-${index}`}
            className={`heading-outline-navigation__item${heading.element === navigationActiveElement ? ' is-active' : ''}`}
            data-level={heading.level}
          />
        ))}
      </nav>
      {expanded && (
        <div
          className="heading-outline-navigation__popover"
          role="dialog"
          aria-label={t('editor.headingOutline.fullOutlineAriaLabel')}
        >
          <div className="heading-outline-navigation__popover-title">
            {t('editor.headingOutline.title')}
          </div>
          <div className="heading-outline-navigation__popover-list">
            {allHeadings.map((heading, index) => (
              <button
                key={`${heading.level}-${index}`}
                type="button"
                className={`heading-outline-navigation__popover-item${heading.element === activeElement ? ' is-active' : ''}`}
                data-level={heading.level}
                aria-current={heading.element === activeElement ? 'location' : undefined}
                onClick={() => scrollToHeading(heading)}
              >
                {heading.text || `H${heading.level}`}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
