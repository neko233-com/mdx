import { createHash } from 'node:crypto'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const releaseDir = process.argv[2] ? resolve(process.argv[2]) : null
if (!releaseDir) {
  throw new Error('usage: node scripts/prepare-mdx-manual-release.mjs <staged-release-directory>')
}

const repository = resolve(import.meta.dirname, '..')
const { version } = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8'))
const tauriVersion = JSON.parse(readFileSync(join(repository, 'app/flowix-desktop/tauri.conf.json'), 'utf8')).version
if (!/^\d+\.\d+\.\d+$/.test(version) || tauriVersion !== version) {
  throw new Error('package.json and Tauri desktop versions must match')
}

const tag = `v${version}`
const downloadBase = `https://github.com/neko233-com/mdx/releases/download/${tag}/`
const windows = `MDX_${version}_x64-setup.exe`
const macArm = `MDX_${version}_aarch64.app.tar.gz`
const macIntel = `MDX_${version}_x64.app.tar.gz`
const assets = [
  windows,
  `${windows}.sig`,
  macArm,
  `${macArm}.sig`,
  `MDX_${version}_aarch64.dmg`,
  macIntel,
  `${macIntel}.sig`,
  `MDX_${version}_x64.dmg`,
]

for (const name of assets) {
  const file = join(releaseDir, name)
  if (basename(file) !== name || !statSync(file, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`release asset is missing: ${name}`)
  }
  if (statSync(file).size === 0) throw new Error(`release asset is empty: ${name}`)
}

function updaterEntry(name) {
  const signature = readFileSync(join(releaseDir, `${name}.sig`), 'utf8').trim()
  if (!signature) throw new Error(`updater signature is empty: ${name}.sig`)
  return { signature, url: `${downloadBase}${encodeURIComponent(name)}` }
}

const windowsEntry = updaterEntry(windows)
const armEntry = updaterEntry(macArm)
const intelEntry = updaterEntry(macIntel)
const manifest = {
  version,
  notes: `MDX ${tag}`,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': { ...windowsEntry },
    'windows-x86_64-nsis': { ...windowsEntry },
    'darwin-aarch64': { ...armEntry },
    'darwin-aarch64-app': { ...armEntry },
    'darwin-x86_64': { ...intelEntry },
    'darwin-x86_64-app': { ...intelEntry },
  },
}
const mirror = structuredClone(manifest)
for (const platform of Object.values(mirror.platforms)) {
  platform.url = `https://ghproxy.net/${platform.url}`
}

const officialName = 'latest.json'
const mirrorName = 'latest-mirror.json'
writeFileSync(join(releaseDir, officialName), `${JSON.stringify(manifest, null, 2)}\n`)
writeFileSync(join(releaseDir, mirrorName), `${JSON.stringify(mirror, null, 2)}\n`)

const checksumNames = [...assets, officialName, mirrorName]
const checksums = checksumNames.map((name) => {
  const digest = createHash('sha256').update(readFileSync(join(releaseDir, name))).digest('hex')
  return `${digest}  ${name}`
})
writeFileSync(join(releaseDir, 'SHA256SUMS'), `${checksums.join('\n')}\n`)
console.log(`Prepared ${tag}: ${checksumNames.length} assets and SHA256SUMS in ${releaseDir}`)
