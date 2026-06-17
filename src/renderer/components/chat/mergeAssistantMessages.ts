/**
 * Collapses each agent "reply" into a single assistant message so it renders as
 * ONE card. A reply is everything between two user messages: all the assistant
 * messages of a turn (the model may emit several across tool rounds) plus the
 * interleaved tool messages. We concatenate the assistant text and accumulate
 * all tool_calls; tool messages themselves are dropped (their results are shown
 * via the assistant's tool-call metadata).
 *
 * The first assistant message of the turn is kept as the base (stable id +
 * reasoning), so the card has one consistent key for expand/pop-out.
 */
export function mergeAssistantMessages(msgs: any[]): any[] {
  const result: any[] = []
  let i = 0

  while (i < msgs.length) {
    const m = msgs[i]

    if (m.role === 'user') {
      result.push({ ...m })
      i++
      continue
    }

    // A leading tool message with no assistant to attach to — skip it.
    if (m.role === 'tool') {
      i++
      continue
    }

    // m.role === 'assistant' → gather the whole turn up to the next user message.
    const base = m
    const contents: string[] = []
    const toolCalls: any[] = []
    let j = i
    while (j < msgs.length && msgs[j].role !== 'user') {
      const cur = msgs[j]
      if (cur.role === 'assistant') {
        const c = (cur.content || '').trim()
        if (c) contents.push(c)
        if (cur.tool_calls && typeof cur.tool_calls === 'string') {
          try {
            const parsed = JSON.parse(cur.tool_calls)
            if (Array.isArray(parsed)) toolCalls.push(...parsed)
          } catch { /* ignore malformed tool_calls */ }
        }
      }
      j++
    }

    result.push({
      ...base,
      content: contents.join('\n\n'),
      tool_calls: toolCalls.length > 0 ? JSON.stringify(toolCalls) : undefined,
    })
    i = j
  }

  return result
}
