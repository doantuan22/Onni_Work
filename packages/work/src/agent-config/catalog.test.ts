import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONFIG_FILES, findConfigFile, listConfigFiles, type AgentHomePaths } from './catalog.ts';

const REPO = resolve('repo');
const HOME_ROOT = resolve('home', 'u');
const HOME: AgentHomePaths = {
  claude: join(HOME_ROOT, '.claude'),
  codex: join(HOME_ROOT, '.codex'),
  opencodeConfig: join(HOME_ROOT, '.config', 'opencode'),
  cursor: join(HOME_ROOT, '.cursor'),
  copilot: join(HOME_ROOT, '.copilot'),
  cline: join(HOME_ROOT, '.cline'),
  junie: join(HOME_ROOT, '.junie'),
  antigravity: join(HOME_ROOT, '.gemini'),
};

describe('agent-config catalog', () => {
  it('every id is unique and URL-safe', () => {
    const ids = CONFIG_FILES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9.]+$/);
  });

  it('every entry carries a non-empty precedence string and a docs URL', () => {
    for (const f of CONFIG_FILES) {
      expect(f.precedence.trim().length).toBeGreaterThan(0);
      expect(f.docsUrl).toMatch(/^https:\/\//);
    }
  });

  it('<repo>/AGENTS.md is ONE entry read by every runner that reads it', () => {
    const agents = CONFIG_FILES.filter((f) => f.label === 'AGENTS.md' && f.scope === 'project');
    expect(agents).toHaveLength(1);
    expect(agents[0]!.runners).toEqual(['codex', 'opencode', 'copilot']);
  });

  it('resolves repo-relative paths under the repo root', () => {
    const proj = findConfigFile('claude.project.settings')!;
    expect(proj.resolve(REPO, HOME)).toBe(join(REPO, '.claude', 'settings.json'));
  });

  it('honours the injected home dirs (so $CODEX_HOME / $XDG_CONFIG_HOME / $CURSOR_CONFIG_DIR flow through)', () => {
    expect(findConfigFile('codex.user.config')!.resolve(REPO, HOME)).toBe(join(HOME.codex, 'config.toml'));
    expect(findConfigFile('opencode.user.config')!.resolve(REPO, HOME)).toBe(
      join(HOME.opencodeConfig, 'opencode.json'),
    );
    expect(findConfigFile('claude.user.settings')!.resolve(REPO, HOME)).toBe(join(HOME.claude, 'settings.json'));
    expect(findConfigFile('cursor.user.settings')!.resolve(REPO, HOME)).toBe(
      join(HOME.cursor, 'cli-config.json'),
    );
    expect(findConfigFile('cursor.project.settings')!.resolve(REPO, HOME)).toBe(join(REPO, '.cursor', 'cli.json'));
    expect(findConfigFile('cursor.user.mcp')!.resolve(REPO, HOME)).toBe(join(HOME.cursor, 'mcp.json'));
    expect(findConfigFile('cursor.project.mcp')!.resolve(REPO, HOME)).toBe(join(REPO, '.cursor', 'mcp.json'));
  });

  it('marks only Claude’s gitignored personal layer as seeded', () => {
    const seeded = CONFIG_FILES.filter((f) => f.seeded).map((f) => f.id).sort();
    expect(seeded).toEqual(['claude.local.memory', 'claude.local.settings']);
    for (const f of CONFIG_FILES) {
      if (f.seeded) expect(f.tracked).toBe('gitignored');
    }
  });

  it('every seeded/gitignored file is a repo-relative path (never in $HOME)', () => {
    for (const f of CONFIG_FILES) {
      if (f.tracked === 'gitignored') {
        const rel = relative(REPO, f.resolve(REPO, HOME));
        expect(rel === '..' || rel.startsWith(`..${sep}`)).toBe(false);
        expect(resolve(REPO, rel)).not.toBe(REPO);
      }
    }
  });

  it('holdsMcp is set exactly where MCP servers actually live', () => {
    const mcp = CONFIG_FILES.filter((f) => f.holdsMcp).map((f) => f.id).sort();
    expect(mcp).toEqual([
      'claude.project.mcp',
      'codex.project.config',
      'codex.user.config',
      // Copilot keeps MCP in its own file rather than inside its settings, like Claude.
      'copilot.user.mcp',
      'cursor.project.mcp',
      'cursor.user.mcp',
      // Onni Work's own private, per-project servers (spec 2026-10-07-private-project-mcp).
      'onni.private.mcp',
      'opencode.project.config',
      'opencode.user.config',
    ]);
  });

  it('listConfigFiles returns the table; findConfigFile is undefined for junk', () => {
    expect(listConfigFiles().length).toBe(CONFIG_FILES.length);
    expect(findConfigFile('../../etc/passwd')).toBeUndefined();
    expect(findConfigFile('nope')).toBeUndefined();
  });
});
