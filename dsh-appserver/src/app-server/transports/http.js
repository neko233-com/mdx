import { createServer } from 'node:http'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { ErrorCode, failure } from '../protocol/json-rpc.js'
import { MobileAuthStore } from '../services/mobile-auth-store.js'

const json = (response, status, value) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

function authorized(request, authToken) {
  if (!authToken) return true
  const supplied = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const expected = Buffer.from(String(authToken))
  const actual = Buffer.from(supplied)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function eventSequence(event) {
  const value = Number(event?.params?.sourceSeq)
  return Number.isFinite(value) ? value : null
}

async function readJsonBody(request, maxBodyBytes) {
  let size = 0; const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > maxBodyBytes) return null
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return null }
}

/** HTTP JSON-RPC and resumable SSE transport. */
export function createHttpTransport(appServer, {
  host = '127.0.0.1', port = 0, maxBodyBytes = 1024 * 1024,
  authToken, mobileAuth = {}, allowedOrigins = [], heartbeatMs = 15000, maxSseConnections = 64, maxReplayEvents = 5000, secureClientIdentity = false,
  pairingMaxAttempts = 5, pairingWindowMs = 60_000, pairingBlockMs = 5 * 60_000,
  requestTimeoutMs = 30_000, headersTimeoutMs = 15_000, keepAliveTimeoutMs = 5_000,
  clientIdentityTtlMs = 24 * 60 * 60_000,
} = {}) {
  const loopback = new Set(['127.0.0.1', '::1', 'localhost'])
  if (!loopback.has(String(host).toLowerCase()) && !authToken && !mobileAuth?.pairingSecret) {
    throw new TypeError('Remote HTTP listening requires authToken or mobileAuth.pairingSecret')
  }
  const subscribers = new Map()
  const mobile = new MobileAuthStore(mobileAuth)
  const clientSecrets = new Map()
  const pairingAttempts = new Map()
  const pairingKey = request => String(request.socket?.remoteAddress || 'unknown')
  const pairingRetryAfter = request => {
    const row = pairingAttempts.get(pairingKey(request))
    if (!row) return 0
    const now = Date.now()
    if (row.blockedUntil > now) return row.blockedUntil - now
    if (now - row.windowStartedAt >= pairingWindowMs) pairingAttempts.delete(pairingKey(request))
    return 0
  }
  const recordPairingFailure = request => {
    const key = pairingKey(request), now = Date.now()
    if (!pairingAttempts.has(key) && pairingAttempts.size >= 1024) pairingAttempts.delete(pairingAttempts.keys().next().value)
    let row = pairingAttempts.get(key)
    if (!row || now - row.windowStartedAt >= pairingWindowMs) row = { attempts: 0, windowStartedAt: now, blockedUntil: 0 }
    row.attempts += 1
    if (row.attempts >= pairingMaxAttempts) row.blockedUntil = now + pairingBlockMs
    pairingAttempts.set(key, row)
  }
  const verifyClient = (clientId, secret) => {
    if (!secureClientIdentity) return true
    const key = String(clientId)
    const row = clientSecrets.get(key)
    if (!row || !secret || Date.now() - row.lastSeenAt > clientIdentityTtlMs) {
      clientSecrets.delete(key)
      return false
    }
    const left = Buffer.from(row.secret)
    const right = Buffer.from(String(secret))
    const valid = left.length === right.length && timingSafeEqual(left, right)
    if (valid) row.lastSeenAt = Date.now()
    return valid
  }
  const server = createServer(async (request, response) => {
    if (request.url === '/readyz' && request.method === 'GET') { response.writeHead(200); response.end('ready'); return }
    const origin = request.headers.origin
    if (origin && !(Array.isArray(allowedOrigins) && allowedOrigins.includes(origin))) { response.writeHead(403); response.end(); return }
    if (origin) { response.setHeader('access-control-allow-origin', origin); response.setHeader('access-control-allow-headers', 'authorization,content-type,x-dsh-client-id,x-dsh-client-secret,x-device-id'); response.setHeader('access-control-allow-credentials', 'true') }
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return }
    const requestUrl = new URL(request.url || '/', 'http://localhost')
    if (request.method === 'POST' && requestUrl.pathname === '/auth/pair') {
      const retryAfterMs = pairingRetryAfter(request)
      if (retryAfterMs > 0) {
        response.writeHead(429, { 'retry-after': String(Math.max(1, Math.ceil(retryAfterMs / 1000))) })
        response.end(); return
      }
      const body = await readJsonBody(request, maxBodyBytes)
      const issued = await mobile.pair(body || {})
      if (!issued) { recordPairingFailure(request); json(response, 401, { error: { kind: 'pairing_rejected' } }); return }
      pairingAttempts.delete(pairingKey(request))
      json(response, 200, issued); return
    }
    if (request.method === 'POST' && requestUrl.pathname === '/auth/refresh') {
      const body = await readJsonBody(request, maxBodyBytes)
      const issued = await mobile.refresh(body?.refreshToken)
      if (!issued) { json(response, 401, { error: { kind: 'refresh_rejected' } }); return }
      json(response, 200, issued); return
    }
    const authHeader = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '') || requestUrl.searchParams.get('accessToken') || ''
    const identity = await mobile.authenticate(authHeader)
    if (identity && request.headers['x-device-id'] && String(request.headers['x-device-id']) !== identity.deviceId) { response.writeHead(403); response.end(); return }
    if (authToken && !authorized(request, authToken) && !identity) { response.writeHead(401, { 'www-authenticate': 'Bearer' }); response.end(); return }
    if (mobileAuth?.pairingSecret && !identity && !authToken) { response.writeHead(401, { 'www-authenticate': 'Bearer' }); response.end(); return }
    if (request.method === 'POST' && requestUrl.pathname === '/auth/revoke') {
      if (!identity) { response.writeHead(401); response.end(); return }
      await mobile.revoke(identity.deviceId); json(response, 200, { revoked: true }); return
    }
    if (request.url === '/healthz' && request.method === 'GET') { response.writeHead(200); response.end('ok'); return }

    if (request.method === 'GET' && request.url?.startsWith('/events')) {
      if (subscribers.size >= maxSseConnections) { response.writeHead(503, { 'retry-after': '5' }); response.end(); return }
      const query = requestUrl.searchParams
      const threadId = query.get('threadId')
      const clientId = String(identity?.deviceId || query.get('clientId') || request.headers['x-dsh-client-id'] || 'http-default')
      const clientSecret = query.get('clientSecret') || request.headers['x-dsh-client-secret']
      if (!identity && !verifyClient(clientId, clientSecret)) { response.writeHead(401); response.end(); return }
      const afterSeq = Number(query.get('afterSeq') ?? request.headers['last-event-id'] ?? -1)
      const limit = Math.min(1000, Math.max(1, Number(query.get('limit') ?? 200) || 200))
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform', connection: 'keep-alive',
        'x-accel-buffering': 'no', 'x-dsh-client-id': clientId,
      })
      response.write(': connected\n\n')

      let replaying = true
      let closed = false
      const buffered = []
      const delivered = new Set()
      let writeQueue = Promise.resolve()
      const send = event => {
        if (closed) return
        const seq = eventSequence(event)
        const key = seq == null && (event?.id || event?.params?.requestId)
          ? `${event.method}:${String(event.id || event.params.requestId)}`
          : null
        if (key && delivered.has(key)) return
        if (key) delivered.add(key)
        writeQueue = writeQueue.then(() => new Promise(resolve => {
          const payload = `${seq == null ? '' : `id: ${seq}\n`}data: ${JSON.stringify(event)}\n\n`
          if (response.write(payload)) resolve()
          else response.once('drain', resolve)
        }))
      }
      appServer.reconnectConnection?.(clientId)
      const unsubscribe = appServer.subscribeConnection?.(clientId, event => {
        const eventThreadId = event.params?.threadId || event.params?.thread?.id
        if (threadId && eventThreadId && threadId !== eventThreadId) return
        if (replaying) buffered.push(event)
        else send(event)
      }) || (() => {})

      const heartbeat = setInterval(() => { if (!closed) response.write(': heartbeat\n\n') }, Math.max(1000, heartbeatMs))
      subscribers.set(response, { threadId, clientId, unsubscribe, heartbeat })
      try {
        let highWatermark = Number.isFinite(afterSeq) ? afterSeq : -1
        let replayed = 0
        if (threadId && typeof appServer.replayNotifications === 'function') {
          let next = String(highWatermark)
          do {
            const page = await appServer.replayNotifications(threadId, Number(next), limit)
            for (const event of page.data || []) {
              if (++replayed > maxReplayEvents) throw new Error(`SSE replay exceeds ${maxReplayEvents} events; reconnect with a newer afterSeq`)
              highWatermark = Math.max(highWatermark, eventSequence(event) ?? highWatermark)
              send(event)
            }
            next = page.nextCursor
          } while (next !== null && !closed)
        }
        replaying = false
        for (const event of buffered) {
          const seq = eventSequence(event)
          if (seq == null || seq > highWatermark) send(event)
        }
        for (const event of appServer.pendingServerRequests?.(clientId, threadId) || []) send(event)
      } catch (error) {
        response.write(`event: error\ndata: ${JSON.stringify({ message: String(error) })}\n\n`)
      }

      request.on('close', () => {
        if (closed) return
        closed = true
        const subscription = subscribers.get(response)
        subscription?.unsubscribe?.()
        clearInterval(subscription?.heartbeat)
        subscribers.delete(response)
        appServer.disconnectConnection?.(clientId, 5000)
      })
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/sync') {
      const threadId = requestUrl.searchParams.get('threadId')
      if (!threadId) { json(response, 400, { error: { kind: 'invalid_input', field: 'threadId' } }); return }
      const afterSeq = Number(requestUrl.searchParams.get('afterSeq') ?? request.headers['last-event-id'] ?? -1)
      const limit = Math.min(1000, Math.max(1, Number(requestUrl.searchParams.get('limit') || 200)))
      const page = await appServer.replayNotifications(threadId, Number.isFinite(afterSeq) ? afterSeq : -1, limit)
      json(response, 200, { threadId, snapshotSequence: page.snapshotSequence ?? page.data?.at(-1)?.params?.sourceSeq ?? afterSeq, events: page.data || [], nextCursor: page.nextCursor })
      return
    }
    if (request.method === 'GET' && requestUrl.pathname.startsWith('/exports/')) {
      const receiptId = requestUrl.pathname.slice('/exports/'.length)
      const exported = await appServer.readExport?.(receiptId)
      if (!exported) { response.writeHead(404); response.end(); return }
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="${exported.filename}"` })
      response.end(exported.content); return
    }
    if (request.method !== 'POST' || requestUrl.pathname !== '/rpc') { response.writeHead(404); response.end(); return }
    let size = 0
    const chunks = []
    for await (const chunk of request) {
      size += chunk.length
      if (size > maxBodyBytes) { response.writeHead(413); response.end(); return }
      chunks.push(chunk)
    }
    try {
      let requestBody
      try { requestBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { requestBody = null }
      let clientId = String(identity?.deviceId || request.headers['x-dsh-client-id'] || 'http-default')
      let issuedSecret
      if (secureClientIdentity && !request.headers['x-dsh-client-id'] && requestBody?.method === 'initialize') {
        clientId = `http-${randomUUID()}`
        issuedSecret = randomUUID()
        clientSecrets.set(clientId, { secret: issuedSecret, lastSeenAt: Date.now() })
      } else if (!verifyClient(clientId, request.headers['x-dsh-client-secret'])) {
        response.writeHead(401); response.end(); return
      }
      response.setHeader('x-dsh-client-id', clientId)
      if (issuedSecret) response.setHeader('x-dsh-client-secret', issuedSecret)
      const result = requestBody === null ? failure(null, 'Invalid JSON', ErrorCode.parseError) : await appServer.dispatch(requestBody, clientId)
      json(response, 200, result)
    } catch (error) {
      json(response, 500, { error: { kind: 'transport_error', message: String(error) } })
    }
  })
  server.requestTimeout = Math.max(1000, Number(requestTimeoutMs) || 30_000)
  server.headersTimeout = Math.max(1000, Number(headersTimeoutMs) || 15_000)
  server.keepAliveTimeout = Math.max(1000, Number(keepAliveTimeoutMs) || 5_000)
  let listenPromise
  const listen = () => {
    if (server.listening) return Promise.resolve(server.address())
    if (listenPromise) return listenPromise
    listenPromise = new Promise((resolve, reject) => {
      const onError = error => reject(error)
      server.once('error', onError)
      server.listen(port, host, () => {
        server.removeListener('error', onError)
        resolve(server.address())
      })
    }).catch(error => { listenPromise = undefined; throw error })
    return listenPromise
  }
  return {
    server,
    listen,
    close: async () => {
      if (listenPromise) await listenPromise.catch(() => undefined)
      for (const [response, subscription] of subscribers) {
        subscription.unsubscribe?.()
        clearInterval(subscription.heartbeat)
        response.end()
      }
      subscribers.clear()
      clientSecrets.clear()
      pairingAttempts.clear()
      await mobile.dispose()
      if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    },
  }
}
