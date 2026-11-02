#!/usr/bin/env node
// Live probe: which installed agent CLIs can list models, and can a reasoning level be set per
// model? Run by hand (`node scripts/probe-agent-reasoning.mjs`); it calls real CLIs, so it is not
// part of `npm test`. Read-only: it never starts an agent turn.
import { spawn, spawnSync } from 'node:child_process'

const TIMEOUT = 40_000
const isWin = process.platform === 'win32'

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: TIMEOUT, shell: isWin })
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

function found(cmd) {
  const r = spawnSync(isWin ? 'where' : 'which', [cmd], { encoding: 'utf8' })
  return r.status === 0
}

const lines = (s) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

/** codex: JSON-RPC `model/list` over `app-server` stdio; the only source with per-model efforts. */
function codexModels() {
  return new Promise((resolve) => {
    const child = spawn('codex', ['app-server'], { shell: isWin, stdio: ['pipe', 'pipe', 'ignore'] })
    const timer = setTimeout(() => { child.kill(); resolve(null) }, TIMEOUT)
    let buf = ''
    const send = (o) => child.stdin.write(`${JSON.stringify(o)}\n`)
    child.stdout.on('data', (d) => {
      buf += d
      for (const l of lines(buf)) {
        let m
        try { m = JSON.parse(l) } catch { continue }
        if (m.id === 1) {
          send({ method: 'initialized', params: {} })
          send({ id: 2, method: 'model/list', params: { includeHidden: false } })
        } else if (m.id === 2) {
          clearTimeout(timer); child.kill()
          resolve((m.result?.data ?? []).map((x) => ({
            model: x.model,
            efforts: x.supportedReasoningEfforts ?? null,
          })))
        }
      }
      buf = buf.endsWith('\n') ? '' : buf.slice(buf.lastIndexOf('\n') + 1)
    })
    child.on('error', () => resolve(null))
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'probe', version: '0' }, capabilities: { experimentalApi: true } } })
  })
}

const effortFlag = (help, re) => (help.match(re)?.[0] ?? null)

const probes = {
  async codex() {
    const m = await codexModels()
    const help = run('codex', ['exec', '--help']).out
    return {
      models: m?.map((x) => x.model) ?? null,
      perModelLevels: m ? Object.fromEntries(m.map((x) => [x.model, x.efforts])) : null,
      setFlag: /model_reasoning_effort/.test(help) || /-c, --config/.test(help) ? '-c model_reasoning_effort=<level>' : null,
    }
  },
  async opencode() {
    const r = run('opencode', ['models'])
    const help = run('opencode', ['run', '--help']).out
    return {
      models: r.ok ? lines(r.out) : null,
      perModelLevels: null, // `models` prints ids only; variants are not listed
      setFlag: effortFlag(help, /provider\/model#variant/) && '--model provider/model#variant',
    }
  },
  async agy() {
    const r = run('agy', ['models'])
    const help = run('agy', ['--help']).out
    return {
      models: r.ok ? lines(r.out).filter((l) => /\t/.test(l)).map((l) => l.split('\t')[0]) : null,
      perModelLevels: null, // some ids embed a level (-high/-medium/-low); not a separate field
      setFlag: effortFlag(help, /--effort\s+Reasoning effort[^\n]*/),
    }
  },
  async cline() {
    const help = run('cline', ['--help']).out
    return {
      models: null, // no list command; `-m` takes a free-form id per provider
      perModelLevels: null,
      setFlag: effortFlag(help, /--thinking <level>/) && '--thinking none|low|medium|high|xhigh',
    }
  },
  async claude() {
    const help = run('claude', ['--help']).out
    return { models: null, perModelLevels: null, setFlag: effortFlag(help, /--effort[^\n]*/) }
  },
  async copilot() {
    const help = run('copilot', ['--help']).out
    return { models: null, perModelLevels: null, setFlag: effortFlag(help, /--(effort|reasoning)[^\n]*/) }
  },
  async 'cursor-agent'() {
    const r = run('cursor-agent', ['--list-models'])
    return { models: r.ok ? lines(r.out) : null, perModelLevels: null, setFlag: null }
  },
  async pi() {
    const r = run('pi', ['--list-models'])
    const help = run('pi', ['--help']).out
    return { models: r.ok ? lines(r.out) : null, perModelLevels: null, setFlag: effortFlag(help, /--thinking[^\n]*/) }
  },
  async junie() {
    const help = run('junie', ['--help']).out
    return { models: null, perModelLevels: null, setFlag: effortFlag(help, /--(effort|reasoning|thinking)[^\n]*/) }
  },
}

const rows = []
for (const [name, probe] of Object.entries(probes)) {
  if (!found(name)) { rows.push({ agent: name, installed: false }); continue }
  try {
    const r = await probe()
    rows.push({
      agent: name,
      installed: true,
      listsModels: r.models ? `${r.models.length} models` : 'no',
      levelsPerModel: r.perModelLevels ? 'yes' : 'no',
      canSetLevel: r.setFlag ?? 'no',
      sample: r.models?.slice(0, 3).join(', ') ?? '',
      detail: r.perModelLevels,
    })
  } catch (e) {
    rows.push({ agent: name, installed: true, error: String(e) })
  }
}

console.table(rows.map(({ detail, ...r }) => r))
for (const r of rows) {
  if (r.detail) console.log(`\n${r.agent} per-model reasoning levels:`, r.detail)
}
