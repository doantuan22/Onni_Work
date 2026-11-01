import { afterEach, describe, expect, it } from 'vitest';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import {
  DEFAULT_SERVER_INSTANCE,
  agentHomePaths,
  onniHomeDir,
  claudeStateFilePath,
  instanceSlug,
  isAbsolutePath,
  serverInstancesDir,
  serverLockPath,
  serverStatePath,
  workspaceConfigPath,
  workspaceUiStatePath,
} from './paths.ts';

const testHome = resolve('test-home');
const testOverrides = resolve('test-overrides');
const onniOverride = resolve('test-onni-home');

describe('paths', () => {
  const original = process.env.ONNI_HOME;
  afterEach(() => {
    if (original === undefined) delete process.env.ONNI_HOME;
    else process.env.ONNI_HOME = original;
  });

  it('defaults onniHomeDir to ~/.onni', () => {
    delete process.env.ONNI_HOME;
    expect(onniHomeDir()).toBe(join(homedir(), '.onni'));
  });

  it('honors the ONNI_HOME override', () => {
    process.env.ONNI_HOME = onniOverride;
    expect(onniHomeDir()).toBe(onniOverride);
    expect(serverStatePath()).toBe(join(onniOverride, 'server.json'));
    expect(serverLockPath()).toBe(join(onniOverride, 'server.install.lock'));
  });

  it('the default instance keeps the legacy un-suffixed paths', () => {
    process.env.ONNI_HOME = onniOverride;
    expect(serverStatePath(DEFAULT_SERVER_INSTANCE)).toBe(join(onniOverride, 'server.json'));
    expect(serverLockPath(DEFAULT_SERVER_INSTANCE)).toBe(join(onniOverride, 'server.install.lock'));
  });

  it('workspace config/ui-state live directly under the onni home', () => {
    delete process.env.ONNI_HOME;
    expect(workspaceConfigPath()).toBe(join(homedir(), '.onni', 'config.json'));
    expect(workspaceUiStatePath()).toBe(join(homedir(), '.onni', 'ui-state.json'));
  });

  it('workspace paths honor the ONNI_HOME override', () => {
    process.env.ONNI_HOME = onniOverride;
    expect(workspaceConfigPath()).toBe(join(onniOverride, 'config.json'));
    expect(workspaceUiStatePath()).toBe(join(onniOverride, 'ui-state.json'));
  });

  it('a named instance lives under server-instances/, keyed by slug', () => {
    process.env.ONNI_HOME = onniOverride;
    expect(serverInstancesDir()).toBe(join(onniOverride, 'server-instances'));
    expect(serverStatePath('shop-example-com')).toBe(join(onniOverride, 'server-instances', 'shop-example-com.json'));
    expect(serverLockPath('shop-example-com')).toBe(
      join(onniOverride, 'server-instances', 'shop-example-com.install.lock'),
    );
  });
});

describe('isAbsolutePath', () => {
  it('accepts native Windows roots on win32: drive, forward-slash drive, UNC', () => {
    expect(isAbsolutePath('C:\\projects\\ProjectName', 'win32')).toBe(true);
    expect(isAbsolutePath('C:/Repos', 'win32')).toBe(true);
    expect(isAbsolutePath('\\\\server\\share\\repo', 'win32')).toBe(true);
  });

  it('refuses relative and drive-relative paths on win32', () => {
    expect(isAbsolutePath('projects\\ProjectName', 'win32')).toBe(false);
    expect(isAbsolutePath('..\\repo', 'win32')).toBe(false);
    expect(isAbsolutePath('C:repo', 'win32')).toBe(false);
    expect(isAbsolutePath('~/onni/projects', 'win32')).toBe(false);
  });

  it('keeps the POSIX rule on POSIX — a Windows spelling is not absolute there', () => {
    expect(isAbsolutePath('/home/me/repo', 'linux')).toBe(true);
    expect(isAbsolutePath('/Users/me/repo', 'darwin')).toBe(true);
    expect(isAbsolutePath('C:\\projects\\ProjectName', 'linux')).toBe(false);
    expect(isAbsolutePath('relative/repo', 'darwin')).toBe(false);
  });
});

describe('instanceSlug', () => {
  it('lowercases and turns every non-alnum run (incl. dots) into a single dash', () => {
    expect(instanceSlug('Shop.Example.COM')).toBe('shop-example-com');
    expect(instanceSlug('a__b--c')).toBe('a-b-c');
    expect(instanceSlug('  lead.trail.  ')).toBe('lead-trail');
  });

  it('degenerate/empty input can never escape the instance namespace', () => {
    expect(instanceSlug('')).toBe(DEFAULT_SERVER_INSTANCE);
    expect(instanceSlug(undefined)).toBe(DEFAULT_SERVER_INSTANCE);
    expect(instanceSlug('.-.-')).toBe(DEFAULT_SERVER_INSTANCE);
  });
});

it('an EMPTY ONNI_HOME falls back to the default instead of a relative cwd path', () => {
  const original = process.env.ONNI_HOME;
  process.env.ONNI_HOME = '';
  try {
    expect(isAbsolute(onniHomeDir())).toBe(true);
    expect(onniHomeDir()).toBe(join(homedir(), '.onni'));
  } finally {
    if (original === undefined) delete process.env.ONNI_HOME;
    else process.env.ONNI_HOME = original;
  }
});

describe('agentHomePaths', () => {
  it('defaults to the agents\' documented home directories', () => {
    const paths = agentHomePaths({ HOME: testHome } as NodeJS.ProcessEnv);
    expect(paths.claude).toBe(join(testHome, '.claude'));
    expect(paths.codex).toBe(join(testHome, '.codex'));
    expect(paths.opencodeConfig).toBe(join(testHome, '.config', 'opencode'));
    expect(paths.cursor).toBe(join(testHome, '.cursor'));
  });

  it('honors agent-specific home overrides', () => {
    const paths = agentHomePaths({
      HOME: testHome,
      CLAUDE_CONFIG_DIR: join(testOverrides, 'claude-klaudiusz'),
      CODEX_HOME: join(testOverrides, 'codex'),
      CURSOR_CONFIG_DIR: join(testOverrides, 'cursor'),
      XDG_CONFIG_HOME: join(testOverrides, 'xdg'),
    } as NodeJS.ProcessEnv);
    expect(paths.claude).toBe(join(testOverrides, 'claude-klaudiusz'));
    expect(paths.codex).toBe(join(testOverrides, 'codex'));
    expect(paths.opencodeConfig).toBe(join(testOverrides, 'xdg', 'opencode'));
    expect(paths.cursor).toBe(join(testOverrides, 'cursor'));
  });

  it('ignores a blank CLAUDE_CONFIG_DIR rather than yielding a relative path', () => {
    const paths = agentHomePaths({ HOME: testHome, CLAUDE_CONFIG_DIR: '   ' } as NodeJS.ProcessEnv);
    expect(paths.claude).toBe(join(testHome, '.claude'));
  });

  it('falls back to USERPROFILE when HOME is unset', () => {
    const paths = agentHomePaths({ USERPROFILE: testHome } as NodeJS.ProcessEnv);
    expect(paths.claude).toBe(join(testHome, '.claude'));
  });
});

describe('claudeStateFilePath', () => {
  it('is a SIBLING of the default ~/.claude', () => {
    const env = { HOME: testHome } as NodeJS.ProcessEnv;
    expect(claudeStateFilePath(agentHomePaths(env).claude, env)).toBe(join(testHome, '.claude.json'));
  });

  it('moves INSIDE an overridden config dir', () => {
    const env = { HOME: testHome, CLAUDE_CONFIG_DIR: join(testHome, '.claude-klaudiusz') } as NodeJS.ProcessEnv;
    expect(claudeStateFilePath(agentHomePaths(env).claude, env)).toBe(join(testHome, '.claude-klaudiusz', '.claude.json'));
  });

  it('moves inside for a profile dir passed explicitly, with no env override', () => {
    // The agent-profile path: the env still says "default", but the caller resolved
    // a second account's dir. Reading `dirname()` here would hit the WRONG account's file.
    const env = { HOME: testHome } as NodeJS.ProcessEnv;
    expect(claudeStateFilePath(join(testHome, '.claude-klaudiusz'), env)).toBe(join(testHome, '.claude-klaudiusz', '.claude.json'));
  });

  it('reads an account\'s OWN state file when the onni process carries an override', () => {
    // Review case: onni started with CLAUDE_CONFIG_DIR=/opt/work, and `~/.claude` added as a NAMED
    // account (legal — the discovered account is /opt/work, so it is not a duplicate). The answer is
    // the file INSIDE it, because that is the one the CLI will read when onni runs that account as
    // `CLAUDE_CONFIG_DIR=~/.claude claude`. The sibling would describe a login it never uses.
    const env = { HOME: testHome, CLAUDE_CONFIG_DIR: join(testOverrides, 'work') } as NodeJS.ProcessEnv;
    expect(claudeStateFilePath(join(testHome, '.claude'), env)).toBe(join(testHome, '.claude', '.claude.json'));
    expect(claudeStateFilePath(join(testOverrides, 'work'), env)).toBe(join(testOverrides, 'work', '.claude.json'));
  });

  it('keeps the SIBLING spelling for the discovered account on a plain machine', () => {
    // The zero-config path, and the one case where the file is not inside: no override anywhere, so
    // the CLI never sees the variable.
    const env = { HOME: testHome } as NodeJS.ProcessEnv;
    expect(claudeStateFilePath(join(testHome, '.claude'), env)).toBe(join(testHome, '.claude.json'));
  });
});
