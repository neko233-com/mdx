import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import test from 'node:test'

const repository = resolve(import.meta.dirname, '..')
const version = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8')).version
const script = join(repository, 'scripts/prepare-mdx-manual-release.mjs')
const names = [
  `MDX_${version}_x64-setup.exe`,
  `MDX_${version}_x64-setup.exe.sig`,
  `MDX_${version}_aarch64.app.tar.gz`,
  `MDX_${version}_aarch64.app.tar.gz.sig`,
  `MDX_${version}_aarch64.dmg`,
  `MDX_${version}_x64.app.tar.gz`,
  `MDX_${version}_x64.app.tar.gz.sig`,
  `MDX_${version}_x64.dmg`,
]

function withStaging(run) {
  const directory = mkdtempSync(join(tmpdir(), 'mdx-manual-release-test-'))
  try {
    return run(directory)
  } finally {
    const root = resolve(tmpdir()) + sep
    const target = resolve(directory)
    if (!target.startsWith(root) || !basename(target).startsWith('mdx-manual-release-test-')) {
      throw new Error('Refusing to remove an unexpected test directory')
    }
    rmSync(target, { recursive: true, force: true })
  }
}

function prepare(directory) {
  return spawnSync(process.execPath, [script, directory], { cwd: repository, encoding: 'utf8' })
}

test('requires all Windows and macOS assets before writing updater manifests', () => withStaging((directory) => {
  for (const name of names.slice(0, -1)) writeFileSync(join(directory, name), `asset:${name}`)
  const result = prepare(directory)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /release asset is missing/)
  assert.equal(readdirSync(directory).includes('latest.json'), false)
}))

test('generates signed direct and mirrored manifests for each desktop target', () => withStaging((directory) => {
  for (const name of names) writeFileSync(join(directory, name), `asset:${name}`)
  const result = prepare(directory)
  assert.equal(result.status, 0, result.stderr)
  const direct = JSON.parse(readFileSync(join(directory, 'latest.json'), 'utf8'))
  const mirror = JSON.parse(readFileSync(join(directory, 'latest-mirror.json'), 'utf8'))
  assert.equal(direct.version, version)
  assert.deepEqual(Object.keys(direct.platforms), [
    'windows-x86_64', 'windows-x86_64-nsis',
    'darwin-aarch64', 'darwin-aarch64-app',
    'darwin-x86_64', 'darwin-x86_64-app',
  ])
  assert.equal(direct.platforms['windows-x86_64'].signature, `asset:${names[1]}`)
  assert.equal(direct.platforms['windows-x86_64'].url,
    `https://github.com/neko233-com/mdx/releases/download/v${version}/${names[0]}`)
  assert.equal(mirror.platforms['darwin-aarch64'].url,
    `https://ghproxy.net/${direct.platforms['darwin-aarch64'].url}`)
  assert.equal(readFileSync(join(directory, 'SHA256SUMS'), 'utf8').trim().split('\n').length, 10)
}))
