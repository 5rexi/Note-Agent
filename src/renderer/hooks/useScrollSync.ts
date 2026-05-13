import { useEffect, useRef } from 'react'
import type { editor } from 'monaco-editor'

/**
 * 同步 Monaco Editor 与 HTMLElement 的滚动位置
 * 使用比例同步：根据源容器的滚动比例计算目标容器的滚动位置
 */
export function useEditorPreviewScrollSync(
  editor: editor.IStandaloneCodeEditor | null,
  previewRef: React.RefObject<HTMLElement | null>,
  enabled: boolean
) {
  const isSyncingRef = useRef(false)

  useEffect(() => {
    if (!enabled || !editor || !previewRef.current) return

    const preview = previewRef.current

    const handleEditorScroll = editor.onDidScrollChange((e) => {
      if (isSyncingRef.current) return
      isSyncingRef.current = true
      const maxEditor = Math.max(1, editor.getScrollHeight() - editor.getLayoutInfo().height)
      const ratio = e.scrollTop / maxEditor
      const maxPreview = Math.max(1, preview.scrollHeight - preview.clientHeight)
      preview.scrollTop = ratio * maxPreview
      requestAnimationFrame(() => { isSyncingRef.current = false })
    })

    const handlePreviewScroll = () => {
      if (isSyncingRef.current) return
      isSyncingRef.current = true
      const maxPreview = Math.max(1, preview.scrollHeight - preview.clientHeight)
      const ratio = preview.scrollTop / maxPreview
      const maxEditor = Math.max(1, editor.getScrollHeight() - editor.getLayoutInfo().height)
      editor.setScrollTop(ratio * maxEditor)
      requestAnimationFrame(() => { isSyncingRef.current = false })
    }

    preview.addEventListener('scroll', handlePreviewScroll)
    return () => {
      handleEditorScroll.dispose()
      preview.removeEventListener('scroll', handlePreviewScroll)
    }
  }, [enabled, editor, previewRef])
}

/**
 * 同步两个 HTMLElement 的滚动位置
 * 使用比例同步
 */
export function useElementScrollSync(
  sourceRef: React.RefObject<HTMLElement | null>,
  targetRef: React.RefObject<HTMLElement | null>,
  enabled: boolean
) {
  const isSyncingRef = useRef(false)

  useEffect(() => {
    if (!enabled) return
    const source = sourceRef.current
    const target = targetRef.current
    if (!source || !target) return

    const handleSourceScroll = () => {
      if (isSyncingRef.current) return
      isSyncingRef.current = true
      const ratio = source.scrollTop / Math.max(1, source.scrollHeight - source.clientHeight)
      target.scrollTop = ratio * Math.max(1, target.scrollHeight - target.clientHeight)
      requestAnimationFrame(() => { isSyncingRef.current = false })
    }

    const handleTargetScroll = () => {
      if (isSyncingRef.current) return
      isSyncingRef.current = true
      const ratio = target.scrollTop / Math.max(1, target.scrollHeight - target.clientHeight)
      source.scrollTop = ratio * Math.max(1, source.scrollHeight - source.clientHeight)
      requestAnimationFrame(() => { isSyncingRef.current = false })
    }

    source.addEventListener('scroll', handleSourceScroll)
    target.addEventListener('scroll', handleTargetScroll)
    return () => {
      source.removeEventListener('scroll', handleSourceScroll)
      target.removeEventListener('scroll', handleTargetScroll)
    }
  }, [enabled, sourceRef, targetRef])
}

/**
 * 同步 HTMLElement 与 iframe contentWindow 的滚动位置
 * 用于 WordViewer / LaTeXViewer split 模式（HTML/Editor ↔ PDF iframe）
 *
 * 关键设计：使用轮询检测 iframe document 的变化（因为 iframe 重新加载时
 * load 事件可能已错过，或者 React 不会重新运行 effect）。当检测到新的
 * document 且 readyState === 'complete' 时，自动重新绑定监听器。
 *
 * Chrome/Electron 内置 PDF viewer 的滚动行为：
 * - scroll 事件通常不冒泡到 window（viewer 内部自行处理）
 * - window.scrollTo() 在某些版本中有效
 * - 因此本 hook 优先保证 源→iframe 的单向同步，双向同步作为尽力而为
 */
export function useIframeScrollSync(
  sourceRef: React.RefObject<HTMLElement | null>,
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
  enabled: boolean
) {
  const cleanupRef = useRef<(() => void) | null>(null)
  const lastDocRef = useRef<Document | null>(null)

  useEffect(() => {
    if (!enabled) {
      if (cleanupRef.current) {
        cleanupRef.current()
        cleanupRef.current = null
      }
      lastDocRef.current = null
      return
    }

    const source = sourceRef.current
    const iframe = iframeRef.current
    if (!source || !iframe) return

    let tick = 0
    let isSyncing = false

    const getScrollMetrics = (win: Window, doc: Document) => {
      const b = doc.body
      const de = doc.documentElement
      // Chrome PDF viewer: body 往往是实际滚动容器
      const scrollTop = Math.max(win.scrollY || 0, win.pageYOffset || 0, b?.scrollTop || 0, de?.scrollTop || 0)
      const scrollHeight = Math.max(b?.scrollHeight || 0, de?.scrollHeight || 0)
      const clientHeight = Math.max(de?.clientHeight || 0, win.innerHeight || 0)
      return { scrollTop, scrollHeight, clientHeight }
    }

    const bind = (): boolean => {
      const win = iframe.contentWindow
      const doc = iframe.contentDocument
      if (!win || !doc) return false
      if (doc.readyState !== 'complete') return false
      if (doc === lastDocRef.current && cleanupRef.current) return true // already bound

      // unbind old
      if (cleanupRef.current) {
        cleanupRef.current()
        cleanupRef.current = null
      }
      lastDocRef.current = doc

      const handleSourceScroll = () => {
        if (isSyncing) return
        isSyncing = true
        const ratio = source.scrollTop / Math.max(1, source.scrollHeight - source.clientHeight)
        const { scrollHeight, clientHeight } = getScrollMetrics(win, doc)
        const maxTarget = Math.max(1, scrollHeight - clientHeight)
        try {
          win.scrollTo(0, ratio * maxTarget)
        } catch {
          // fallback
          try { doc.documentElement.scrollTop = ratio * maxTarget } catch {}
          try { if (doc.body) doc.body.scrollTop = ratio * maxTarget } catch {}
        }
        requestAnimationFrame(() => { isSyncing = false })
      }

      const handleTargetScroll = () => {
        if (isSyncing) return
        isSyncing = true
        const { scrollTop, scrollHeight, clientHeight } = getScrollMetrics(win, doc)
        const ratio = scrollTop / Math.max(1, scrollHeight - clientHeight)
        source.scrollTop = ratio * Math.max(1, source.scrollHeight - source.clientHeight)
        requestAnimationFrame(() => { isSyncing = false })
      }

      source.addEventListener('scroll', handleSourceScroll)
      // 同时监听 window 和 body — PDF viewer 可能在任意层级触发 scroll
      win.addEventListener('scroll', handleTargetScroll)
      let bodyCleanup: (() => void) | null = null
      if (doc.body) {
        doc.body.addEventListener('scroll', handleTargetScroll)
        bodyCleanup = () => doc.body?.removeEventListener('scroll', handleTargetScroll)
      }

      cleanupRef.current = () => {
        source.removeEventListener('scroll', handleSourceScroll)
        win.removeEventListener('scroll', handleTargetScroll)
        bodyCleanup?.()
      }

      return true
    }

    // 立即尝试，然后每 300ms 轮询一次，最多 10 秒
    bind()
    const interval = setInterval(() => {
      tick++
      if (bind() || tick > 30) {
        clearInterval(interval)
      }
    }, 300)

    return () => {
      clearInterval(interval)
      if (cleanupRef.current) {
        cleanupRef.current()
        cleanupRef.current = null
      }
      lastDocRef.current = null
    }
  }, [enabled, sourceRef, iframeRef])
}

/**
 * 同步 Monaco Editor 与 iframe contentWindow 的滚动位置
 * 用于 LaTeX split 模式（Editor ↔ PDF iframe）
 */
export function useEditorIframeScrollSync(
  editor: editor.IStandaloneCodeEditor | null,
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
  enabled: boolean
) {
  const cleanupRef = useRef<(() => void) | null>(null)
  const lastDocRef = useRef<Document | null>(null)

  useEffect(() => {
    if (!enabled) {
      if (cleanupRef.current) {
        cleanupRef.current()
        cleanupRef.current = null
      }
      lastDocRef.current = null
      return
    }

    if (!editor || !iframeRef.current) return
    const iframe = iframeRef.current

    let tick = 0
    let isSyncing = false

    const getScrollMetrics = (win: Window, doc: Document) => {
      const b = doc.body
      const de = doc.documentElement
      const scrollTop = Math.max(win.scrollY || 0, win.pageYOffset || 0, b?.scrollTop || 0, de?.scrollTop || 0)
      const scrollHeight = Math.max(b?.scrollHeight || 0, de?.scrollHeight || 0)
      const clientHeight = Math.max(de?.clientHeight || 0, win.innerHeight || 0)
      return { scrollTop, scrollHeight, clientHeight }
    }

    const bind = (): boolean => {
      const win = iframe.contentWindow
      const doc = iframe.contentDocument
      if (!win || !doc) return false
      if (doc.readyState !== 'complete') return false
      if (doc === lastDocRef.current && cleanupRef.current) return true

      if (cleanupRef.current) {
        cleanupRef.current()
        cleanupRef.current = null
      }
      lastDocRef.current = doc

      const handleEditorScroll = editor.onDidScrollChange((e) => {
        if (isSyncing) return
        isSyncing = true
        const maxEditor = Math.max(1, editor.getScrollHeight() - editor.getLayoutInfo().height)
        const ratio = e.scrollTop / maxEditor
        const { scrollHeight, clientHeight } = getScrollMetrics(win, doc)
        const maxTarget = Math.max(1, scrollHeight - clientHeight)
        try {
          win.scrollTo(0, ratio * maxTarget)
        } catch {
          try { doc.documentElement.scrollTop = ratio * maxTarget } catch {}
          try { if (doc.body) doc.body.scrollTop = ratio * maxTarget } catch {}
        }
        requestAnimationFrame(() => { isSyncing = false })
      })

      const handleTargetScroll = () => {
        if (isSyncing) return
        isSyncing = true
        const { scrollTop, scrollHeight, clientHeight } = getScrollMetrics(win, doc)
        const ratio = scrollTop / Math.max(1, scrollHeight - clientHeight)
        const maxEditor = Math.max(1, editor.getScrollHeight() - editor.getLayoutInfo().height)
        editor.setScrollTop(ratio * maxEditor)
        requestAnimationFrame(() => { isSyncing = false })
      }

      win.addEventListener('scroll', handleTargetScroll)
      let bodyCleanup: (() => void) | null = null
      if (doc.body) {
        doc.body.addEventListener('scroll', handleTargetScroll)
        bodyCleanup = () => doc.body?.removeEventListener('scroll', handleTargetScroll)
      }

      cleanupRef.current = () => {
        handleEditorScroll.dispose()
        win.removeEventListener('scroll', handleTargetScroll)
        bodyCleanup?.()
      }

      return true
    }

    bind()
    const interval = setInterval(() => {
      tick++
      if (bind() || tick > 30) {
        clearInterval(interval)
      }
    }, 300)

    return () => {
      clearInterval(interval)
      if (cleanupRef.current) {
        cleanupRef.current()
        cleanupRef.current = null
      }
      lastDocRef.current = null
    }
  }, [enabled, editor, iframeRef])
}
