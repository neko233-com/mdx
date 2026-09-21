import { describe, expect, it, vi } from 'vitest'
import { ThreadLifecycleService } from '../src/app-server/services/thread-lifecycle-service.js'

function serviceFor(existingHandle) {
  const registry = {
    handle: vi.fn(() => existingHandle),
    close: vi.fn(async () => { existingHandle = undefined }),
    resolutions: new Map(),
    setHandle: vi.fn(),
  }
  const resumedHandle = { agent: { session: { id: 'session-1', header: { config: { provider: 'p', model: 'b' } } } } }
  const resume = vi.fn(async () => resumedHandle)
  const service = new ThreadLifecycleService(
    { agents: { resume } },
    registry,
    {
      createOptions: () => ({}),
      resumeOptions: (id, config) => ({ resumeSessionId: id, provider: config.provider, model: config.model }),
      applyPermission: vi.fn(),
      projectThread: agent => agent.session,
    },
  )
  return { service, registry, resume }
}

describe('ThreadLifecycleService model resume', () => {
  it('reuses a live session when provider/model are unchanged', async () => {
    const existingHandle = { agent: { session: { id: 'session-1', header: { config: { provider: 'p', model: 'a' } }, events: [{ type: 'request/context', data: { provider: 'p', model: 'a' } }] } }, dispose: vi.fn() }
    const { service, registry, resume } = serviceFor(existingHandle)

    await expect(service.resume('session-1', { provider: 'p', model: 'a' })).resolves.toEqual(existingHandle.agent.session)
    expect(registry.close).not.toHaveBeenCalled()
    expect(resume).not.toHaveBeenCalled()
  })

  it('reopens the same durable session when the model changes', async () => {
    const existingHandle = { agent: { session: { id: 'session-1', header: { config: { provider: 'p', model: 'a' } }, events: [{ type: 'request/context', data: { provider: 'p', model: 'a' } }] } }, dispose: vi.fn() }
    const { service, registry, resume } = serviceFor(existingHandle)

    await expect(service.resume('session-1', { provider: 'p', model: 'b' })).resolves.toEqual({ id: 'session-1', header: { config: { provider: 'p', model: 'b' } } })
    expect(registry.close).toHaveBeenCalledWith('session-1')
    expect(resume).toHaveBeenCalledWith({ resumeSessionId: 'session-1', provider: 'p', model: 'b' })
  })
})
