export function stableTurnId(threadId, turn) { return `${threadId}-turn-${turn}` }
export function stableItemId(threadId, event) { return `${threadId}-item-${event.data?.id || event.data?.messageId || event.seq}` }
export function stableAssistantStreamItemId(threadId, attemptId) { return `${threadId}-assistant-stream-${String(attemptId)}` }

/** Normalize the text-bearing shapes emitted by supported DSH versions. */
export function textOf(value) {
  if (typeof value === 'string') return value
  if (typeof value?.text === 'string') return value.text
  if (value?.message) return textOf(value.message)
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join('')
  if (Array.isArray(value?.content)) return value.content.map(textOf).filter(Boolean).join('')
  if (typeof value?.content === 'string') return value.content
  return JSON.stringify(value)
}

export function normalizeEvent(event) {
  if (!event || typeof event !== 'object') return null
  return {
    ...event,
    type: typeof event.type === 'string' ? event.type : 'unknown',
    seq: Number.isFinite(Number(event.seq)) ? Number(event.seq) : null,
    data: event.data && typeof event.data === 'object' ? event.data : {},
  }
}

export function assistantChunkText(value) {
  const chunk = value?.chunk
  return chunk?.type === 'text-delta' && typeof chunk.text === 'string' ? chunk.text : undefined
}

export function turnEndStatus(data) {
  const value = String(data?.reason?.kind || data?.reason || data?.status || '')
  if (/cancel|abort|interrupt|disposed/u.test(value)) return 'interrupted'
  if (/max-token|max_token|maxtoken|fail|error/u.test(value)) return 'failed'
  return 'completed'
}

// Provider failures are commonly encoded in the turn reason rather than as a
// separate assistant message. Normalize the upstream shape once so live
// notifications and historical projections expose the same error contract.
export function turnEndError(data) {
  if (turnEndStatus(data) !== 'failed') return undefined
  const candidates = [
    data?.error,
    data?.reason?.error,
    data?.reason,
    data?.message,
  ]
  let raw
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() && !/^(?:failed|error|max[-_]tokens?)$/iu.test(candidate.trim())) {
      raw = { message: candidate.trim() }
      break
    }
    if (!candidate || typeof candidate !== 'object') continue
    const message = candidate.message || candidate.errorMessage || candidate.error?.message || candidate.details?.message
    if (typeof message === 'string' && message.trim()) {
      raw = { ...candidate, message: message.trim() }
      break
    }
  }
  const embedded = embeddedProviderError(raw?.message)
  const message = embedded?.message || raw?.message || `DeepSeek Harness turn failed (${String(data?.reason?.kind || data?.reason || 'failed')})`
  const supplied = data?.errorDetails || data?.error_details || raw?.errorDetails || raw?.error_details
  const statusCode = Number.isSafeInteger(Number(supplied?.statusCode ?? supplied?.status_code ?? raw?.statusCode ?? raw?.status_code))
    ? Number(supplied?.statusCode ?? supplied?.status_code ?? raw?.statusCode ?? raw?.status_code)
    : (() => {
        const match = /\b(?:http\s*(?:status)?\s*)?([45]\d{2})\b/iu.exec(raw?.message || message)
        return match ? Number(match[1]) : undefined
      })()
  const lower = message.toLowerCase()
  const quota = lower.includes('token plan')
    || lower.includes('usage limit')
    || lower.includes('quota exceeded')
    || lower.includes('insufficient balance')
    || lower.includes('insufficient credit')
    || lower.includes('5 hour')
    || message.includes('用量上限')
    || message.includes('套餐')
    || message.includes('积分补充')
    || message.includes('积分不足')
    || message.includes('余额不足')
    || message.includes('配额不足')
    || message.includes('额度不足')
  const category = supplied?.category || (quota
    ? 'quota_exhausted'
    : statusCode === 429 || lower.includes('rate limit') || lower.includes('too many requests')
      ? 'rate_limited'
      : statusCode >= 500 || lower.includes('service unavailable') || lower.includes('internal server error')
        ? 'provider'
        : 'unknown')
  return {
    message,
    details: {
      category,
      ...(statusCode ? { statusCode } : {}),
      ...(supplied?.requestId || supplied?.request_id || raw?.requestId || raw?.request_id || embedded?.requestId
        ? { requestId: supplied?.requestId || supplied?.request_id || raw?.requestId || raw?.request_id || embedded?.requestId }
        : {}),
      ...(supplied?.retryAfter || supplied?.retry_after || raw?.retryAfter || raw?.retry_after
        ? { retryAfter: supplied?.retryAfter || supplied?.retry_after || raw?.retryAfter || raw?.retry_after }
        : {}),
      upstreamMessage: supplied?.upstreamMessage || supplied?.upstream_message || embedded?.message || message,
      source: supplied?.source || 'dsh-history',
      retryable: supplied?.retryable ?? (!quota && (category === 'rate_limited' || category === 'provider')),
    },
  }
}

/**
 * Providers sometimes put a second JSON error envelope inside the turn error
 * string, for example `429 {"error":{"message":"..."},"request_id":"..."}`.
 * Keep the event projector tolerant of that legacy shape so the user sees the
 * provider message and diagnostics rather than the generic turn status.
 */
function embeddedProviderError(value) {
  if (typeof value !== 'string') return undefined
  const start = value.indexOf('{')
  const end = value.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    const parsed = JSON.parse(value.slice(start, end + 1))
    const nested = parsed?.error && typeof parsed.error === 'object' ? parsed.error : parsed
    const message = nested?.message || parsed?.message || parsed?.detail
    if (typeof message !== 'string' || !message.trim()) return undefined
    return {
      message: message.trim(),
      requestId: parsed?.request_id || parsed?.requestId || nested?.request_id || nested?.requestId,
    }
  } catch (_) {
    return undefined
  }
}
