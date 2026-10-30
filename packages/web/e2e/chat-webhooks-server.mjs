import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'onni-chat-webhooks-e2e-'))
const repository = resolve(import.meta.dirname, '../../..')
execFileSync('git', ['init', '-q'], { cwd: root })
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('ONNI_')))
Object.assign(env, {
  ONNI_DRY_RUN: '1', ONNI_HOME: join(root, '.onni-home'), ONNI_WEBHOOKS: '1',
  ONNI_SKILLS_AUTO_UPDATE: '0', ONNI_AUTOMATIONS: '0',
})
const child = spawn(process.execPath, ['--import', 'tsx', join(repository, 'packages/work/src/index.ts'),
  'serve', '--repo', root, '--port', process.env.PORT, '--no-open'], { cwd: repository, env, stdio: 'inherit' })
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal))
child.on('exit', code => { rmSync(root, { recursive: true, force: true }); process.exit(code ?? 0) })
