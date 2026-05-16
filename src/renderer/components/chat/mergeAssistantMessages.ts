/**
 * Merges adjacent assistant messages.
 *
 * 1. Empty-content assistants with tool_calls are merged into the next
 *    content-bearing assistant (original behaviour).
 * 2. Short "bridge" assistants (≤120 chars) that sit between tool results
 *    and the next assistant are also merged forward. This prevents a single
 *    task from being visually fragmented into many tiny bubbles when the
 *    model emits a brief "let me check..." text before its next tool call.
 *
 * All tool_calls are accumulated and merged into the final assistant message.
 */
export function mergeAssistantMessages(msgs: any[]): any[] {
  const result: any[] = []
  let i = 0

  while (i < msgs.length) {
    const msg = msgs[i]

    // Not an assistant — pass through
    if (msg.role !== 'assistant') {
      result.push({ ...msg })
      i++
      continue
    }

    const content = (msg.content || '').trim()
    const hasContent = content !== ''
    const isShortBridge = hasContent && content.length <= 120
    let hasToolCalls = false
    if (msg.tool_calls && typeof msg.tool_calls === 'string') {
      try {
        const parsed = JSON.parse(msg.tool_calls)
        hasToolCalls = Array.isArray(parsed) && parsed.length > 0
      } catch {
        hasToolCalls = false
      }
    }

    // If this assistant has substantial content (not a short bridge) and
    // no tool_calls, keep it standalone. Tool-carrying assistants are
    // always merged forward so the whole round appears as one bubble.
    if (hasContent && !isShortBridge && !hasToolCalls) {
      result.push({ ...msg })
      i++
      continue
    }

    // Accumulate tool_calls from this (empty or short-bridge) assistant
    let accumulatedTC: any[] = []
    if (msg.tool_calls && typeof msg.tool_calls === 'string') {
      try {
        const parsed = JSON.parse(msg.tool_calls)
        if (Array.isArray(parsed)) accumulatedTC = parsed
      } catch { /* ignore invalid JSON */ }
    }
    let j = i + 1

    // Skip over tool results and any further empty/short-bridge assistants
    while (j < msgs.length) {
      const next = msgs[j]
      if (next.role === 'tool') {
        j++
      } else if (next.role === 'assistant') {
        const nextContent = (next.content || '').trim()
        let nextHasToolCalls = false
        if (next.tool_calls && typeof next.tool_calls === 'string') {
          try {
            const parsed = JSON.parse(next.tool_calls)
            nextHasToolCalls = Array.isArray(parsed) && parsed.length > 0
          } catch {
            nextHasToolCalls = false
          }
        }
        // Only skip empty or short-bridge assistants.  Any assistant with
        // substantial content (>120 chars) is a merge TARGET, regardless of
        // whether it also carries tool_calls.
        if (nextContent.length > 120) {
          break
        }
        if (next.tool_calls && typeof next.tool_calls === 'string') {
          try {
            const parsed = JSON.parse(next.tool_calls)
            if (Array.isArray(parsed)) accumulatedTC.push(...parsed)
          } catch {
            // ignore invalid tool_calls JSON
          }
        }
        j++
      } else {
        break
      }
    }

    // If we found a following substantial assistant, merge everything into it
    if (j < msgs.length && msgs[j].role === 'assistant') {
      const target = msgs[j]
      let targetTC: any[] = []
      if (target.tool_calls && typeof target.tool_calls === 'string') {
        try {
          targetTC = JSON.parse(target.tool_calls)
          if (!Array.isArray(targetTC)) targetTC = []
        } catch {
          targetTC = []
        }
      }
      const mergedContent = (isShortBridge || hasToolCalls) && !target.content?.includes(content)
        ? `${content}\n\n${target.content || ''}`
        : target.content
      result.push({
        ...target,
        content: mergedContent,
        tool_calls:
          accumulatedTC.length > 0 || targetTC.length > 0
            ? JSON.stringify([...accumulatedTC, ...targetTC])
            : undefined,
      })
      i = j + 1
      continue
    }

    // No following assistant — try to merge backward into the most recent
    // substantial assistant in the result array
    if (accumulatedTC.length > 0) {
      let merged = false
      for (let k = result.length - 1; k >= 0; k--) {
        const prev = result[k]
        if (prev.role === 'assistant' && (prev.content || '').trim() !== '') {
          let prevTC: any[] = []
          if (prev.tool_calls && typeof prev.tool_calls === 'string') {
            try {
              prevTC = JSON.parse(prev.tool_calls)
              if (!Array.isArray(prevTC)) prevTC = []
            } catch {
              prevTC = []
            }
          }
          const mergedContent = (isShortBridge || hasToolCalls) && !prev.content?.includes(content)
            ? `${prev.content}\n\n${content}`
            : prev.content
          result[k] = {
            ...prev,
            content: mergedContent,
            tool_calls: JSON.stringify([...prevTC, ...accumulatedTC]),
          }
          merged = true
          break
        }
      }
      if (!merged) {
        result.push({
          ...msg,
          tool_calls: accumulatedTC.length > 0 ? JSON.stringify(accumulatedTC) : msg.tool_calls,
        })
      }
    } else if (hasContent) {
      // Short bridge with no tool_calls and no place to merge — keep it
      result.push({ ...msg })
    }

    i = j
  }

  return result
}
