import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const hash = value => createHash('sha256').update(String(value)).digest('hex')
const equal = (left, right) => {
  const a = Buffer.from(String(left)); const b = Buffer.from(String(right))
  return a.length === b.length && timingSafeEqual(a, b)
}

export class MobileAuthStore {
  constructor({ pairingSecret, persistencePath, tokenTtlMs = 30 * 24 * 60 * 60_000, refreshTtlMs = 180 * 24 * 60 * 60_000, maxDevices = 64 } = {}) {
    this.pairingSecret = pairingSecret
    this.persistencePath = persistencePath
    this.tokenTtlMs = tokenTtlMs; this.refreshTtlMs = refreshTtlMs; this.maxDevices = maxDevices
    this.devices = new Map(); this.loaded = false
  }
  async load() {
    if (this.loaded) return
    this.loaded = true
    if (!this.persistencePath) return
    try {
      const data = JSON.parse(await readFile(this.persistencePath, 'utf8'))
      const now = Date.now()
      for (const device of Array.isArray(data) ? data : []) {
        if (device?.deviceId && Number(device.refreshExpiresAt) > now) this.devices.set(device.deviceId, device)
      }
    } catch { /* first run or unreadable state starts empty */ }
  }
  async save() {
    if (!this.persistencePath) return
    await mkdir(dirname(this.persistencePath), { recursive: true })
    await writeFile(this.persistencePath, JSON.stringify([...this.devices.values()], null, 2), { encoding: 'utf8', mode: 0o600 })
    try { await chmod(this.persistencePath, 0o600) } catch { /* Windows */ }
  }
  async pair({ pairingSecret, deviceName = 'mobile-device' } = {}) {
    await this.load()
    if (!this.pairingSecret || !equal(pairingSecret, this.pairingSecret)) return null
    const deviceId = `device-${randomUUID()}`
    const issued = this.issue(deviceId, deviceName)
    await this.save()
    return issued
  }
  issue(deviceId, deviceName) {
    const accessToken = randomUUID() + randomUUID(); const refreshToken = randomUUID() + randomUUID(); const now = Date.now()
    if (!this.devices.has(deviceId) && this.devices.size >= this.maxDevices) {
      const oldest = [...this.devices.values()].sort((left, right) => Number(left.lastSeenAt || left.createdAt) - Number(right.lastSeenAt || right.createdAt))[0]
      if (oldest) this.devices.delete(oldest.deviceId)
    }
    const device = { deviceId, deviceName: String(deviceName || 'mobile-device'), accessHash: hash(accessToken), refreshHash: hash(refreshToken), accessExpiresAt: now + this.tokenTtlMs, refreshExpiresAt: now + this.refreshTtlMs, createdAt: now, lastSeenAt: now }
    this.devices.set(deviceId, device)
    return { deviceId, deviceName: device.deviceName, accessToken, refreshToken, expiresAt: new Date(device.accessExpiresAt).toISOString() }
  }
  async refresh(refreshToken) {
    await this.load()
    const device = [...this.devices.values()].find(row => equal(row.refreshHash, hash(refreshToken)) && row.refreshExpiresAt > Date.now())
    if (!device) return null
    const issued = this.issue(device.deviceId, device.deviceName); await this.save(); return issued
  }
  async authenticate(accessToken) {
    await this.load()
    const tokenHash = hash(accessToken)
    const device = [...this.devices.values()].find(row => equal(row.accessHash, tokenHash) && row.accessExpiresAt > Date.now())
    if (!device) return null
    device.lastSeenAt = Date.now()
    return { deviceId: device.deviceId, deviceName: device.deviceName }
  }
  async revoke(deviceId) { await this.load(); const removed = this.devices.delete(String(deviceId)); await this.save(); return removed }
  async dispose() { await this.save() }
}
