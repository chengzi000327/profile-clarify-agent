import { execFile } from 'node:child_process'
import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const exec = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const lock = JSON.parse(await readFile(resolve(root, 'harness-sidecar/runtime-lock.json'), 'utf8'))
const checkout = resolve(root, '.harness/deepseek-harness')
const pluginSource = resolve(root, 'packages/dsh-role-clarifier')
const pluginTarget = resolve(checkout, 'packages/external/role-clarifier')

const run = async (command, args, cwd = root) => {
  process.stdout.write(`> ${command} ${args.join(' ')}\n`)
  await exec(command, args, { cwd, maxBuffer: 32 * 1024 * 1024 })
}

const exists = async (path) => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const hasGitObject = async (object, cwd) => {
  try {
    await exec('git', ['cat-file', '-e', `${object}^{commit}`], { cwd })
    return true
  } catch {
    return false
  }
}

await mkdir(dirname(checkout), { recursive: true })
if (!await exists(resolve(checkout, '.git'))) {
  await mkdir(checkout, { recursive: true })
  await run('git', ['init'], checkout)
  await run('git', ['remote', 'add', 'origin', lock.repository], checkout)
}
if (!await hasGitObject(lock.commit, checkout)) {
  await run('git', ['fetch', '--depth', '1', 'origin', lock.commit], checkout)
}
await rm(pluginTarget, { recursive: true, force: true })
await run('git', ['switch', '--detach', lock.commit], checkout)
await run('git', ['restore', '--source=HEAD', '--worktree', 'pnpm-lock.yaml'], checkout)

const head = (await exec('git', ['rev-parse', 'HEAD'], { cwd: checkout })).stdout.trim()
if (head !== lock.commit) throw new Error(`Harness commit mismatch: ${head}`)
const upstreamManifest = JSON.parse(await readFile(resolve(checkout, 'package.json'), 'utf8'))
if (upstreamManifest.version !== lock.sourceVersion) {
  throw new Error(`Harness source version mismatch: ${upstreamManifest.version}`)
}

// Build the pristine official source before adding the external workspace.
// The upstream tsdown aggregator intentionally assumes every package it sees
// follows the official multi-entry layout.
await run('corepack', ['pnpm', 'install', '--frozen-lockfile'], checkout)
await run('corepack', ['pnpm', 'run', 'build:lib'], checkout)

await mkdir(dirname(pluginTarget), { recursive: true })
await cp(pluginSource, pluginTarget, {
  recursive: true,
  filter: (path) => !path.includes('/node_modules/') && !path.includes('/dist/'),
})
const pluginManifestPath = resolve(pluginTarget, 'package.json')
const pluginManifest = JSON.parse(await readFile(pluginManifestPath, 'utf8'))
pluginManifest.main = './lib/index.js'
pluginManifest.types = './lib/index.d.ts'
pluginManifest.files = ['lib', 'cordis.yml']
for (const section of ['dependencies', 'devDependencies']) {
  for (const name of Object.keys(pluginManifest[section] ?? {})) {
    if (name.startsWith('@deepseek-ai/')) pluginManifest[section][name] = 'workspace:^'
    if (pluginManifest[section][name] === 'catalog:') {
      const upstreamVersion = upstreamManifest.devDependencies?.[name]
      if (!upstreamVersion) delete pluginManifest[section][name]
      else pluginManifest[section][name] = upstreamVersion
    }
  }
}
await writeFile(pluginManifestPath, `${JSON.stringify(pluginManifest, null, 2)}\n`)
await writeFile(resolve(pluginTarget, 'tsconfig.json'), `${JSON.stringify({
  compilerOptions: {
    target: 'ES2022',
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    strict: true,
    declaration: true,
    declarationMap: false,
    sourceMap: false,
    skipLibCheck: true,
    esModuleInterop: true,
    forceConsistentCasingInFileNames: true,
    outDir: 'lib',
    rootDir: 'src',
    types: ['node'],
  },
  include: ['src/**/*.ts'],
}, null, 2)}\n`)
await cp(resolve(root, 'harness-sidecar/runtime/cordis.yml'), resolve(pluginTarget, 'cordis.yml'))

await run('corepack', ['pnpm', 'install', '--no-frozen-lockfile'], checkout)
await run('corepack', ['pnpm', '--filter', '@role-clarifier/dsh-bundle', 'exec', 'tsc', '-p', 'tsconfig.json'], checkout)

const runtimeBin = resolve(checkout, 'packages/examples/jsonrpc-demo/lib/bin.js')
if (!await exists(runtimeBin)) throw new Error(`Harness runtime bin was not built: ${runtimeBin}`)
process.stdout.write(`DeepSeek Harness ${lock.sourceVersion} prepared at ${head}\n`)
