import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { discoverPiModels, parsePiModels } from './pi-model-catalog.ts';

/** A stand-in for the `pi --list-models` child: write its output, then close with a code. */
function fakeChild(): {
  child: ChildProcessWithoutNullStreams;
  say(text: string): void;
  close(code: number): void;
} {
  const process = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  Object.assign(process, {
    stdin,
    stdout,
    stderr,
    exitCode: null,
    signalCode: null,
    killed: false,
    kill: () => true,
    pid: 321,
  });
  return {
    child: process as unknown as ChildProcessWithoutNullStreams,
    say: (text: string) => stderr.write(text),
    close(code: number) {
      Object.assign(process, { exitCode: code });
      process.emit('exit', code, null);
      queueMicrotask(() => process.emit('close', code));
    },
  };
}

function discover(script: (fake: ReturnType<typeof fakeChild>) => void) {
  const fake = fakeChild();
  const promise = discoverPiModels({ cwd: '/repo', spawn: () => fake.child });
  queueMicrotask(() => script(fake));
  return promise;
}

const LISTING = [
  'provider   model              context  max-out  thinking  images',
  'anthropic  claude-sonnet-4-5  200K     64K      yes       yes',
  'openai     gpt-5.1            400K     128K     yes       yes',
].join('\n');

describe('parsePiModels', () => {
  it('lists provider/model ids from the table, in order', () => {
    expect(parsePiModels(LISTING)).toEqual([
      { id: 'anthropic/claude-sonnet-4-5', label: 'claude-sonnet-4-5', description: 'via anthropic' },
      { id: 'openai/gpt-5.1', label: 'gpt-5.1', description: 'via openai' },
    ]);
  });

  it('reads the documented logged-out answer as an empty catalog', () => {
    expect(
      parsePiModels('No models available. Use /login to log into a provider via OAuth or API key.\n'),
    ).toEqual([]);
  });

  it('throws on output it cannot recognize, so the picker falls back to the presets', () => {
    expect(() => parsePiModels('Models may be available')).toThrow(/unrecognized/);
  });
});

describe('discoverPiModels', () => {
  it('reads the answer pi writes to stderr when stdin is not a TTY', async () => {
    await expect(discover((fake) => { fake.say(LISTING); fake.close(0); }))
      .resolves.toEqual(parsePiModels(LISTING));
  });

  it('rejects a failing child instead of reporting an empty catalog', async () => {
    await expect(discover((fake) => { fake.say(LISTING); fake.close(1); }))
      .rejects.toThrow(/exited \(1\)/);
  });
});
