import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(root, '../..')
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const profileManifest = JSON.parse(
  await readFile(resolve(repositoryRoot, 'packages/dsh-profile/package.json'), 'utf8'),
)
const runtimeLock = JSON.parse(
  await readFile(resolve(repositoryRoot, 'harness-sidecar/runtime-lock.json'), 'utf8'),
)
const runtimeConfig = await readFile(
  resolve(repositoryRoot, 'harness-sidecar/runtime/cordis.yml'),
  'utf8',
)

const reasoningEffort = runtimeConfig.match(/reasoningEffort:\s*([^\s#]+)/)?.[1]
if (!reasoningEffort || !['off', 'high', 'max'].includes(reasoningEffort)) {
  throw new Error(`Harness rc.5 reasoningEffort must be off, high, or max; got ${reasoningEffort ?? 'missing'}`)
}
const patch = await readFile(resolve(root, 'cordis.patch.yml'), 'utf8')
const source = await readFile(resolve(root, 'src/index.ts'), 'utf8')

for (const [packageName, version] of Object.entries(manifest.dependencies)) {
  if (packageName.startsWith('@deepseek-ai/') && packageName !== '@deepseek-ai/cordis' && version !== '0.1.0-rc.5') {
    throw new Error(`${packageName} must be pinned to 0.1.0-rc.5`)
  }
}
for (const [packageName, version] of Object.entries({
  ...profileManifest.dependencies,
  ...profileManifest.devDependencies,
})) {
  if (packageName.startsWith('@deepseek-ai/') && version !== '0.1.0-rc.5') {
    throw new Error(`${packageName} must be pinned to 0.1.0-rc.5`)
  }
}
if (runtimeLock.sourceVersion !== '0.1.0-rc.5') {
  throw new Error('Harness source lock must declare 0.1.0-rc.5')
}
if (!/^[0-9a-f]{40}$/.test(runtimeLock.commit)) {
  throw new Error('Harness source lock must contain a full Git commit SHA')
}

const bannedRows = [
  'tool-bash',
  'tool-pwsh',
  'tool-fs',
  'tool-fs-search',
  'tool-subagent',
  'tool-subagent-fork',
  'tool-workflow',
  'tool-str-replace-editor',
  'tool-web',
]
for (const id of bannedRows) {
  const block = patch.match(new RegExp(`id: ${id.replaceAll('-', '\\-')}[\\s\\S]{0,120}`))?.[0]
  if (!block?.includes('disabled: true')) throw new Error(`Banned row ${id} is not disabled`)
}

for (const packageName of [
  '@deepseek-ai/dsh-tool-bash',
  '@deepseek-ai/dsh-tool-pwsh',
  '@deepseek-ai/dsh-tool-fs',
  '@deepseek-ai/dsh-tool-fs-search',
  '@deepseek-ai/dsh-tool-web',
  '@deepseek-ai/dsh-tool-skill',
  '@deepseek-ai/dsh-tool-subagent',
  '@deepseek-ai/dsh-tool-workflow',
  '@deepseek-ai/dsh-tool-goal',
]) {
  if (runtimeConfig.includes(packageName)) {
    throw new Error(`Real runtime must not load ${packageName}`)
  }
}

const allowed = [
  'read_role_state',
  'update_role_identity_draft',
  'save_fact_draft',
  'save_artifact_draft',
  'save_candidate_evidence',
  'propose_calibration_signal',
  'read_version_diff',
]
for (const name of allowed) {
  if (!source.includes(`name: '${name}'`)) throw new Error(`Missing domain tool ${name}`)
}

for (const forbiddenArgument of ['actor_role', 'actor_user_id', 'tenant_id']) {
  const modelSchema = source.slice(source.indexOf('ctx.tools.register'))
  if (modelSchema.includes(`${forbiddenArgument}:`)) {
    throw new Error(`Identity field ${forbiddenArgument} must not be model-provided`)
  }
}

console.info(
  `role-clarifier profile verified: Harness 0.1.0-rc.5 @ ${runtimeLock.commit} and domain-only tool surface`,
)
