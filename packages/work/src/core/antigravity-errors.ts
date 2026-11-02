/**
 * What `agy -p` says when it cannot run, and when that means "sign in".
 *
 * agy's changelog (`agy changelog`) documents the shape: a headless turn that ends on a model or
 * API failure exits with code 3 and prints one `AGY_ERROR: {…}` JSON line on stderr carrying a
 * canonical status, an HTTP or gRPC code, retryability and an error id. The exact key names are
 * not documented and no real "not signed in" capture exists (spike step 0, e), so everything here
 * is deliberately loose: the line is parsed if it is JSON, and the sign-in test reads the whole
 * text — status words, a 401, or the CLI's own sign-in wording — never one named field.
 */

/** The marker agy puts in front of the structured error line. */
export const AGY_ERROR_PREFIX = 'AGY_ERROR:';

/** agy exits with this code when a turn ended on a model or agent error (changelog). */
export const AGY_ERROR_EXIT_CODE = 3;

export interface AgyError {
  /** The parsed JSON, when the line was JSON. */
  readonly fields?: Record<string, unknown>;
  /** The line as printed, without the marker. */
  readonly text: string;
}

/** The last `AGY_ERROR:` line in a stderr dump, parsed when it is JSON. Never throws. */
export function parseAgyError(stderr: string): AgyError | undefined {
  const lines = stderr.split(String.fromCharCode(10));
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    const at = line.indexOf(AGY_ERROR_PREFIX);
    if (at === -1) continue;
    const text = line.slice(at + AGY_ERROR_PREFIX.length).trim();
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return { fields: parsed as Record<string, unknown>, text };
      }
    } catch {
      /* not JSON: keep the text */
    }
    return { text };
  }
  return undefined;
}

/** Status words, a 401, or the CLI's own sign-in wording. */
const SIGN_IN_PATTERNS: readonly RegExp[] = [
  /\bUNAUTHENTICATED\b/,
  /\bAUTH_REQUIRED\b/,
  /\b401\b/,
  /\b(?:not|never) (?:signed|logged) in\b/i,
  /\bsign[ -]?in (?:is )?(?:required|needed)\b/i,
  /\b(?:please|you must|you need to) (?:sign|log) ?in\b/i,
  /\b(?:log ?in|sign ?in|authenticate) (?:to continue|first)\b/i,
  /\bauthentication (?:is )?required\b/i,
  /\bcredentials? (?:are |is )?(?:missing|expired|invalid|not found)\b/i,
  /\b(?:token|session|login) (?:has )?expired\b/i,
];

/** True when agy's stderr (or any text it printed) says the account is not signed in. */
export function needsSignIn(text: string): boolean {
  return SIGN_IN_PATTERNS.some((pattern) => pattern.test(text));
}

/** agy's own headless wording when a tool needing a permission was auto-denied. */
const HEADLESS_DENIAL = /headless mode cannot prompt|auto-denied/i;

/** True when agy's stderr says a tool was denied because headless mode cannot ask for approval. */
export function isHeadlessPermissionDenial(text: string): boolean {
  return HEADLESS_DENIAL.test(text);
}

/**
 * One line saying WHO blocked a command and how to unblock it. At "Files only" Onni passes agy no
 * grants, so agy auto-denies shell commands (file edits still work); at "Allow-rules" only the
 * listed exact lines pass. Replaces agy's own two-sentence hint, which names flags Onni owns.
 */
export function permissionDenialHelp(level: string): string {
  if (level === 'bypass') {
    return 'agy still denied a tool at "Skip all confirmations" — an unattended run never skips checks; use Allow-rules or run the task attended.';
  }
  const where = level === 'allow-rules' ? 'this command is not in the "Allow-rules" list' : 'shell commands are off at the "Files only" level';
  return `blocked by Onni's permission level (agy cannot ask headless): ${where}. To allow commands, raise the level in Settings → Agents; file edits in the worktree are unaffected.`;
}

/**
 * The failure text a run shows. It contains "authentication failed … not signed in" on purpose: the
 * run engine classifies a failure as `auth` by pattern (`classifyAgentFailure`), which marks the
 * run, adds the "sign in, then Continue" line and tells the cockpit the login is gone.
 */
export function signInMessage(detail: string): string {
  const said = detail.replace(/\s+/g, ' ').trim().slice(0, 160);
  return `antigravity authentication failed — not signed in: run \`agy\` once in a terminal and sign in, then Continue${said ? ` (agy said: ${said})` : ''}`;
}
