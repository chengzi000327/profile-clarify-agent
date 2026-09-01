import { execFile } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const requiredDirectories = [
  'apps/web',
  'apps/api',
  'apps/harness-sidecar',
  'apps/intro-web',
  'packages',
  'docs/product',
  'evals',
  'scripts',
  'openspec',
]
const legacyDirectories = ['frontend', 'server', 'harness-sidecar', 'agent-intro-frontend']
const productDocuments = [
  '岗位画像澄清Agent_PRD_v0.md',
  '岗位画像澄清Agent_PRD_v1.md',
  '岗位画像澄清Agent_PRD反哺清单_v0.md',
  '岗位画像澄清Agent_前端方案_v0.md',
  '评测任务清单_v1.4.md',
]
const failures = []

const exists = async (path) => {
  try {
    await access(resolve(root, path))
    return true
  } catch {
    return false
  }
}

for (const path of requiredDirectories) {
  if (!await exists(path)) failures.push(`Missing required directory: ${path}`)
}
for (const path of [...legacyDirectories, ...productDocuments]) {
  if (await exists(path)) failures.push(`Legacy root entry still exists: ${path}`)
}

const { stdout } = await exec('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
const trackedFiles = stdout.split('\0').filter(Boolean)
const legacyPathPattern = /(^|[\s"'`(=:])(?:\.\.\/|\.\/|\/)*(frontend|server|harness-sidecar|agent-intro-frontend)\//m
for (const path of trackedFiles) {
  if (path.startsWith('openspec/changes/') || path === 'scripts/check-project-layout.mjs') continue
  let content
  try {
    content = await readFile(resolve(root, path), 'utf8')
  } catch {
    continue
  }
  if (content.includes('\0')) continue
  if (legacyPathPattern.test(content)) failures.push(`Legacy path reference in ${path}`)
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`${failure}\n`)
  process.exit(1)
}

process.stdout.write('Project layout verified: apps, packages, docs, scripts, evals, and OpenSpec are separated.\n')
