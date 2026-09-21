import assert from 'node:assert/strict'
import { createHttpTransport } from '../src/http-transport.js'

const events = [{ jsonrpc: '2.0', method: 'turn/completed', params: { threadId: 't1', sourceSeq: 1 } }]
const app = {
  reconnectConnection() {}, disconnectConnection() {}, subscribeConnection() { return () => {} },
  pendingServerRequests() { return [] },
  async replayNotifications() { return { data: events, nextCursor: null } },
  async dispatch(request) { return { jsonrpc: '2.0', id: request.id, result: {} } },
  async readExport() { return { filename: 'session.json', content: '{"ok":true}' } },
}
const transport = createHttpTransport(app, {
  port: 0,
  pairingMaxAttempts: 2,
  mobileAuth: { pairingSecret: 'pairing-secret' },
})
const address = await transport.listen()
const base = `http://${address.address}:${address.port}`
try {
  const pair = await fetch(`${base}/auth/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pairingSecret: 'pairing-secret', deviceName: 'smoke' }) })
  assert.equal(pair.status, 200)
  const credentials = await pair.json()
  const unauthorized = await fetch(`${base}/sync?threadId=t1`)
  assert.equal(unauthorized.status, 401)
  const sync = await fetch(`${base}/sync?threadId=t1`, { headers: { authorization: `Bearer ${credentials.accessToken}` } })
  assert.equal(sync.status, 200)
  assert.equal((await sync.json()).events.length, 1)
  const refresh = await fetch(`${base}/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: credentials.refreshToken }) })
  assert.equal(refresh.status, 200)
  const refreshed = await refresh.json()
  const download = await fetch(`${base}/exports/demo`, { headers: { authorization: `Bearer ${refreshed.accessToken}` } })
  assert.equal(download.status, 200)
  assert.equal((await download.json()).ok, true)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const rejected = await fetch(`${base}/auth/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pairingSecret: 'wrong' }) })
    assert.equal(rejected.status, 401)
  }
  const limited = await fetch(`${base}/auth/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pairingSecret: 'pairing-secret' }) })
  assert.equal(limited.status, 429)
  console.log('mobile HTTP smoke: ok')
} finally {
  await transport.close()
}
