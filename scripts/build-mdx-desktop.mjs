import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const npm = process.env.npm_execpath
if (!npm) throw new Error('Run this build with npm run tauri:build:prod')
if (!process.env.TAURI_SIGNING_PRIVATE_KEY && process.env.TAURI_SIGNING_PRIVATE_KEY_PATH) {
  process.env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(process.env.TAURI_SIGNING_PRIVATE_KEY_PATH, 'utf8')
}
if (!process.env.TAURI_SIGNING_PRIVATE_KEY || !process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
  throw new Error('TAURI_SIGNING_PRIVATE_KEY and TAURI_SIGNING_PRIVATE_KEY_PASSWORD are required')
}

function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    shell: false,
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run([npm, 'run', 'cli:build:prod'])
const platformConfig = process.platform === 'win32'
  ? 'tauri.windows.conf.json'
  : process.platform === 'darwin' ? 'tauri.macos.conf.json' : null
if (!platformConfig) throw new Error('MDX desktop packages support Windows and macOS')
run([
  resolve(root, 'node_modules/@tauri-apps/cli/tauri.js'),
  'build', '--ci',
  '--config', 'app/flowix-desktop/tauri.conf.json',
  '--config', `app/flowix-desktop/${platformConfig}`,
])
