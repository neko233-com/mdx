import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { METHOD_SCHEMAS } from '../src/app-server/protocol/method-schema.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = resolve(root, 'docs', 'PROTOCOL.md')
const rows = Object.entries(METHOD_SCHEMAS)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([method, schema]) => {
    const id = Array.isArray(schema.id) ? schema.id.join(' / ') : schema.id || '—'
    const required = [...(schema.strings || []), ...(schema.object ? [schema.object] : [])].join(', ') || '—'
    const limits = Object.entries(schema.limits || {}).map(([name, max]) => `${name}≤${max}`).join(', ') || '—'
    return `| \`${method}\` | ${schema.schedule || 'read'} | ${id} | ${required} | ${limits} |`
  })

const document = `# DSH App Server Protocol\n\n> 此文件由 \`npm run docs:protocol\` 从 Method Schema 生成，请勿手工维护接口表。\n\n| 方法 | 调度域 | 资源 ID | 必填字段 | 限制 |\n|---|---|---|---|---|\n${rows.join('\n')}\n`
await mkdir(dirname(target), { recursive: true })
await writeFile(target, document, 'utf8')
