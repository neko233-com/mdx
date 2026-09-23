import { readFileSync, writeFileSync } from 'node:fs'

const [input, output] = process.argv.slice(2)
if (!input || !output) throw new Error('usage: node scripts/create-mirror-manifest.mjs latest.json latest-mirror.json')

const manifest = JSON.parse(readFileSync(input, 'utf8'))
if (!manifest.platforms || typeof manifest.platforms !== 'object') {
  throw new Error('updater manifest has no platforms')
}
let rewritten = 0
for (const platform of Object.values(manifest.platforms)) {
  if (!platform || typeof platform.url !== 'string') continue
  const url = new URL(platform.url)
  if (url.origin !== 'https://github.com' || !url.pathname.startsWith('/neko233-com/mdx/releases/download/')) {
    throw new Error(`unexpected updater asset URL: ${url}`)
  }
  platform.url = `https://ghproxy.net/${url}`
  rewritten += 1
}
if (rewritten === 0) throw new Error('updater manifest has no release assets')
writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`)
