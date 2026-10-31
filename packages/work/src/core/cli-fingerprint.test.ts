import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { programFingerprint } from './cli-fingerprint.ts';

describe('programFingerprint', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'onni-fingerprint-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('changes when the CLI file is rewritten, so a cached catalog can be invalidated', () => {
    const bin = join(dir, process.platform === 'win32' ? 'codex.exe' : 'codex');
    writeFileSync(bin, 'v1');
    // PATH resolution on POSIX requires the execute bit; Windows ignores it.
    if (process.platform !== 'win32') chmodSync(bin, 0o755);

    const first = programFingerprint(bin);
    expect(first).toContain(bin);

    writeFileSync(bin, 'version two');
    expect(programFingerprint(bin)).not.toBe(first);
  });

  it('is null for a CLI that is not installed yet', () => {
    expect(programFingerprint(join(dir, 'missing'))).toBeNull();
    expect(programFingerprint('onni-no-such-cli-anywhere')).toBeNull();
  });
});
