import { parentPort } from 'node:worker_threads'
import { projectHistoryMessages } from '../projections/transcript-projector.js'
import { projectTurns } from '../projections/turn-projector.js'

parentPort.on('message', message => {
  const { id, kind, payload } = message
  try {
    let result
    if (kind === 'history') {
      result = projectHistoryMessages(payload.sessionId, payload.events, new Map(payload.toolNames), payload.allEvents, payload.options)
    } else if (kind === 'turns') {
      result = projectTurns(payload.sessionId, payload.events, payload.fallbackMessages || [], payload.options)
    } else throw new Error(`Unknown projection task: ${kind}`)
    parentPort.postMessage({ id, result })
  } catch (error) {
    parentPort.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
})
