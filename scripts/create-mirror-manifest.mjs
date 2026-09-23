import { readFileSync, writeFileSync } from 'node:fs'

const [input, assetsInput, tag, officialOutput, mirrorOutput] = process.argv.slice(2)
if (!input || !assetsInput || !tag || !officialOutput || !mirrorOutput) {
  throw new Error('usage: node scripts/create-mirror-manifest.mjs latest.json assets.json vVERSION latest-public.json latest-mirror.json')
}

const manifest = JSON.parse(readFileSync(input, 'utf8'))
const release = JSON.parse(readFileSync(assetsInput, 'utf8'))
if (tag !== `v${manifest.version}` || !manifest.platforms || typeof manifest.platforms !== 'object') {
  throw new Error('updater manifest version or platforms are invalid')
}
if (!Array.isArray(release.assets)) throw new Error('GitHub release asset list is missing')

const assetsByApiUrl = new Map(release.assets.map(asset => [asset.apiUrl, asset.name]))
const assetNames = new Set(release.assets.map(asset => asset.name))
const downloadPrefix = `https://github.com/neko233-com/mdx/releases/download/${tag}/`
let rewritten = 0
for (const platform of Object.values(manifest.platforms)) {
  if (!platform || typeof platform.url !== 'string' || !platform.signature) {
    throw new Error('updater manifest has an incomplete platform')
  }
  const source = new URL(platform.url)
  let assetName
  if (source.origin === 'https://api.github.com' &&
      /^\/repos\/neko233-com\/mdx\/releases\/assets\/\d+$/.test(source.pathname)) {
    assetName = assetsByApiUrl.get(source.href)
  } else if (source.origin === 'https://github.com' &&
      source.pathname.startsWith('/neko233-com/mdx/releases/download/')) {
    assetName = decodeURIComponent(source.pathname.split('/').pop() ?? '')
  }
  if (!assetName || !assetNames.has(assetName)) {
    throw new Error(`updater asset is not in the release: ${platform.url}`)
  }
  platform.url = `${downloadPrefix}${encodeURIComponent(assetName)}`
  rewritten += 1
}
if (rewritten === 0) throw new Error('updater manifest has no release assets')

const mirror = structuredClone(manifest)
for (const platform of Object.values(mirror.platforms)) {
  platform.url = `https://ghproxy.net/${platform.url}`
}
writeFileSync(officialOutput, `${JSON.stringify(manifest, null, 2)}\n`)
writeFileSync(mirrorOutput, `${JSON.stringify(mirror, null, 2)}\n`)
