import { ProjectionWorkerPool } from '../src/app-server/runtime/projection-worker-pool.js'

const pool = new ProjectionWorkerPool({ size: 1, thresholdEvents: 0, timeoutMs: 3000 })
try {
  const result = await pool.run('turns', {
    sessionId: 'worker-smoke',
    events: [
      { seq: 0, type: 'turn/start', data: { turn: 1 } },
      { seq: 1, type: 'user/message', data: { message: { content: 'hi' } } },
      { seq: 2, type: 'turn/end', data: { status: 'completed' } },
    ],
    fallbackMessages: [],
    options: { preserveCompactedHistory: true },
  })
  if (!Array.isArray(result)) throw new Error('projection worker returned a non-array result')
  console.log('projection worker: ok')
} finally {
  await pool.dispose()
}
