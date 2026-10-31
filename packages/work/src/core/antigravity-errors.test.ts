import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { classifyAgentFailure } from './agent-failure-class.ts';
import { AGY_ERROR_EXIT_CODE, needsSignIn, parseAgyError, signInMessage } from './antigravity-errors.ts';

// Shape from `agy changelog`: a structured AGY_ERROR line on stderr and exit code 3. The key names are a guess.
const UNAUTHENTICATED = 'AGY_ERROR: {"status":"UNAUTHENTICATED","code":401,"retryable":false,"error_id":"synthetic-0001"}';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'antigravity', 'not-logged-in.synthetic.txt');

describe('the synthetic not-signed-in fixture', () => {
  // The checkout may use CRLF on Windows: compare trimmed lines.
  const lines = readFileSync(FIXTURE, 'utf8').split(String.fromCharCode(10)).map((line) => line.trimEnd());
  const stderr = lines.slice(lines.indexOf('stderr:') + 1).join(String.fromCharCode(10));

  it('says it is synthetic at the top, and that the exit code is 3', () => {
    expect(lines[0]).toMatch(/^# synthetic/);
    expect(lines).toContain('exit=3');
  });

  it('reads as a sign-in need, through the structured line and through the prompt alone', () => {
    expect(needsSignIn(stderr)).toBe(true);
    expect(parseAgyError(stderr)?.fields).toMatchObject({ status: 'UNAUTHENTICATED' });
    // Without the structured line the prompt still says it (the real key names are unknown).
    expect(needsSignIn(stderr.split(String.fromCharCode(10)).filter((l) => !l.startsWith('AGY_ERROR')).join(String.fromCharCode(10)))).toBe(true);
  });
});

describe('antigravity errors', () => {
  it('exit code 3 is the documented "turn ended on an agent or model error"', () => {
    expect(AGY_ERROR_EXIT_CODE).toBe(3);
  });

  it('parses the last AGY_ERROR line, as JSON when it is JSON and as text when it is not', () => {
    const nl = String.fromCharCode(10);
    expect(parseAgyError(`warming up${nl}${UNAUTHENTICATED}${nl}`)?.fields).toMatchObject({ status: 'UNAUTHENTICATED', code: 401 });
    expect(parseAgyError(`AGY_ERROR: boom${nl}`)).toEqual({ text: 'boom' });
    expect(parseAgyError(`AGY_ERROR: {"a":1}${nl}AGY_ERROR: {"a":2}`)?.fields).toEqual({ a: 2 });
    expect(parseAgyError('no marker here')).toBeUndefined();
    expect(parseAgyError('')).toBeUndefined();
  });

  it('reads a sign-in need from status words, a 401, or the CLI wording', () => {
    for (const text of [UNAUTHENTICATED, 'AUTH_REQUIRED', 'HTTP 401', 'You are not signed in', 'Please sign in', 'sign in required', 'Authentication required', 'credentials expired', 'token has expired', 'Log in to continue']) {
      expect(needsSignIn(text), text).toBe(true);
    }
  });

  it('does not read a sign-in need into ordinary failures', () => {
    for (const text of ['jetski: no output produced — a tool required the "command" permission', 'exit code 1', 'AGY_ERROR: {"status":"UNAVAILABLE","code":503}', 'processed 4012 files', 'rate limit exceeded']) {
      expect(needsSignIn(text), text).toBe(false);
    }
  });

  it('the message is classified as auth, so the run engine marks it and adds the sign-in guidance', () => {
    const message = signInMessage(UNAUTHENTICATED);
    expect(message).toContain('not signed in');
    expect(message).toContain('run `agy` once');
    expect(classifyAgentFailure(message)).toBe('auth');
    expect(message.length).toBeLessThan(400);
  });
});
