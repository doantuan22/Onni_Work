import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { isImageMediaType, sanitizeAttachmentName } from '@onni/contract';
import type { ContentBlock } from '../../core/agent-runner.ts';

/**
 * The effective "extra" system prompt for a run (spec §protocol v2, R2 2.3):
 * the per-run override (`POST /api/runs` `systemPrompt`) REPLACES the
 * `config.json` default — they are the same knob at two scopes, so the more
 * specific one wins outright; they never concatenate. The global instructions
 * (`~/.onni/config.json` `systemPrompt`) are a different knob: they always
 * ride along, placed FIRST and labelled as yielding to the project's. Whichever
 * wins is ADDITIVE to the skill body and the handoff contract (see
 * `composeSystemPrompt`). Blank strings count as unset.
 */
export function resolveExtraSystemPrompt(
  override: string | undefined,
  configDefault: string | undefined,
  globalDefault?: string,
): string | undefined {
  const project = override?.trim() || configDefault?.trim() || undefined;
  const global = globalDefault?.trim() || undefined;
  if (!global || !project) return project ?? global;
  return [
    `${GLOBAL_INSTRUCTIONS_HEADING}\n\n${global}`,
    `${PROJECT_INSTRUCTIONS_HEADING}\n\n${project}`,
  ].join('\n\n---\n\n');
}

export const GLOBAL_INSTRUCTIONS_HEADING =
  '## Global instructions\n\nThese apply to every project. Where they conflict with the project instructions below, the project instructions win.';
export const PROJECT_INSTRUCTIONS_HEADING =
  '## Project instructions\n\nThese are specific to this project and take precedence over the global instructions above.';

/**
 * Joins the parts of one agent step's system prompt in fixed order — skill
 * body (most task-specific), then the run's extra prompt (user guidance, can
 * amend the skill), then the handoff contract (always last, never optional in
 * practice). Blank parts drop out; survivors join with the same `\n\n---\n\n`
 * divider the skill+handoff composition has always used.
 */
export function composeSystemPrompt(...parts: Array<string | undefined>): string {
  return parts
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p))
    .join('\n\n---\n\n');
}

/**
 * The DISPATCH prompt part of a run's system prompt (spec 2026-09-10-dispatch) — composed at
 * BOTH session sites, so a task knows how to dispatch and report on its first step, on every
 * Continue, and after a restart.
 *
 * De-duplicated against the run's extra system prompt, and that is not a micro-optimisation:
 * `dispatch()` seeds a child's extra prompt with the very same text, so composing both would
 * hand the backend the same instructions twice. Containment, not equality: with global
 * instructions set, `resolveExtraSystemPrompt` wraps that seed under its own heading.
 */
export function dispatchPromptPart(prompt: string | undefined, extra: string | undefined): string | undefined {
  const part = prompt?.trim();
  if (!part) return undefined;
  return extra?.includes(part) ? undefined : part;
}

/**
 * The directories a spawned agent may reach outside its worktree: the run-state
 * folder that holds its handoff file and its pasted attachments, the attachment
 * library when the project has one (#929), plus its own temp directory when this
 * run got one (#785). Handing an agent a `TMPDIR` its file tools are not allowed
 * to write would trade one silent failure for another, so the two travel
 * together; under `ONNI_AGENT_TMPDIR=0` there is no per-run directory and the
 * list is exactly what it always was.
 *
 * The library is on this list for the same reason `runsDir` is: `pastedAttachmentsText`
 * NAMES it in the note appended to a message, and a directory an agent is told to look in
 * but whose `Read`/`Glob` it is refused is worse than one it was never told about — headless
 * runs use `--permission-mode dontAsk`, so the refusal does not even prompt. Pass `undefined`
 * when the project has no library yet: `--add-dir` on a path that is not there is its own
 * failure, and a project where nothing has been filed has nothing to grant.
 */
export function agentDirectories(
  runsDir: string,
  libraryDir: string | undefined,
  env: Record<string, string>,
): string[] {
  const dirs = [runsDir, ...(libraryDir ? [libraryDir] : []), ...(env.TMPDIR ? [env.TMPDIR] : [])];
  // A dispatched run's tree directory (spec 2026-09-10-dispatch: the filesystem channel) — its
  // brief, its notes, its inbox. Same rule as TMPDIR: the env names it, so the file tools must
  // reach it.
  if (env.ONNI_TREE_DIR) dirs.push(env.ONNI_TREE_DIR);
  return dirs;
}

/**
 * Materialized pasted attachment: the on-disk name/serving-URL pair the
 * transcript already used, plus the absolute path that lets the agent
 * operate on the file itself — save it, `cp` it, attach it to a GitHub
 * issue/PR (#357). `path` is only ever an absolute path under
 * `.ai/onni/runs/<runId>-images/` (see `RunManager.persistAttachment`).
 */
/** Inverse of `attachmentExtension` (#472) — a persisted attachment is re-encoded from disk at
 *  dequeue and needs its media type back. Only ever asked about IMAGE names (a file reaches the
 *  agent as a path, never as a block), so an unknown extension still answers `image/png`: that is
 *  the pre-existing fallback for the `.img` an SVG or a BMP paste lands as. */
export function mediaTypeFor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  return ext === 'jpg' ? 'image/jpeg'
    : ext === 'webp' ? 'image/webp'
    : ext === 'gif' ? 'image/gif'
    : 'image/png';
}

/** Highest `<prefix>-<n>.<ext>` suffix already present in a run's image dir (#472).
 *  `screenshot-*` and `pasted-*` share one numbering space, so this scans both and
 *  returns 0 for a missing/empty directory. */
export function highestImageSeq(dir: string): number {
  try {
    return readdirSync(dir).reduce((max, name) => {
      const m = /^(?:screenshot|pasted)-(\d+)\./.exec(name);
      return m ? Math.max(max, Number(m[1])) : max;
    }, 0);
  } catch {
    return 0;
  }
}

export interface PersistedAttachment {
  name: string;
  url: string;
  path: string;
}

/** The per-project attachment library (#929): one folder per repository holding every document a
 *  user has attached to any task in it, under the name they know it by. Ignored via
 *  `ensureDataGitignore` — it is USER content and must never surface in their `git status`. */
export function attachmentLibraryDir(dataDir: string): string {
  return join(dataDir, 'attachments');
}

/** How many `<stem>-<n>.<ext>` variants to try before giving up on a name. */
const MAX_LIBRARY_COLLISION_ATTEMPTS = 100;

/**
 * File a copy of an attachment in the per-project library and answer where it landed, or `null`
 * when it could not be filed.
 *
 * Two files with the same name are the common case here, not the edge case — a library spanning
 * every task in a repository collects a great many `notes.md` — so the name is resolved against
 * CONTENT first: byte-identical means the same document, and the existing copy is reused rather
 * than duplicated (attaching the same brief to six tasks leaves one file, not six). Only a genuine
 * clash — same name, different bytes — takes a `-2`/`-3` suffix.
 *
 * Strictly best-effort, exactly like `persistAttachment`: this is a convenience copy of a file
 * that is already safely on disk in the run folder, so a read-only volume or a full disk must cost
 * the user the library entry and nothing else.
 *
 * Concurrency note: the exclusive create plus content compare below is exact within one process,
 * because these writes are synchronous and cannot interleave. Two onni processes on the same
 * repository can have the second read a partially written file, miss the dedupe and keep a
 * redundant `-2` copy. That is the best-effort contract doing its job, not a bug to fix here.
 */
export function copyToAttachmentLibrary(dataDir: string, name: string, bytes: Buffer): string | null {
  try {
    // Defense in depth: every caller today comes through `toPastedContent`, which sanitizes at the
    // wire boundary — but `FileBlock.name` is a plain `string`, so a future route that builds one
    // directly would hand a raw client value to `join()` below and the failure would be a path
    // traversal rather than a type error. The check belongs next to the write that would suffer
    // from its absence.
    if (name !== basename(name) || name.startsWith('.') || name === '') return null;
    const dir = attachmentLibraryDir(dataDir);
    mkdirSync(dir, { recursive: true });
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let attempt = 1; attempt <= MAX_LIBRARY_COLLISION_ATTEMPTS; attempt += 1) {
      const candidate = attempt === 1 ? name : `${stem}-${attempt}${ext}`;
      const path = join(dir, candidate);
      try {
        // Exclusive create, so two runs persisting at once cannot overwrite each other's file
        // between the existence check and the write.
        writeFileSync(path, bytes, { flag: 'wx' });
        return path;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      }
      // Taken. The same document already filed here is a hit, not a collision.
      if (readFileSync(path).equals(bytes)) return path;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * A user attachment that is NOT an image (#950) — a PDF, a `.txt`, a `.md`.
 *
 * Deliberately not a `ContentBlock` variant: `ContentBlock` is the runner protocol
 * (`AGENT_PROTOCOL.md`), and a file has nothing a model can look at. The RunManager
 * converts these into files on disk plus a path in the prompt before anything is
 * handed to a session, so a `file` block can never reach a backend.
 */
export interface FileBlock {
  type: 'file';
  mediaType: string;
  data: string;
  /** The user's own filename, ALREADY through `sanitizeAttachmentName` — `toPastedContent` is the
   *  wire boundary and does it there, so no raw client string travels past it. Absent when the
   *  client sent none, or when nothing usable survived sanitization. Names the copy in the
   *  per-project attachment library (#929); the run folder still names files itself. */
  name?: string;
}

/** What the routes hand the engine: image/text blocks the session will see, plus file blocks it
 *  will never see. Every RunManager entry point accepts this wider type. */
export type PastedContent = ContentBlock | FileBlock;

// Metadata belongs to the original in-memory block, never the vendor protocol. Queue
// persistence files the library copy before serializing; deferred delivery retains the block.
export const imageLibraryNames = new WeakMap<ContentBlock, string>();

/** Convert a wire attachment without writing files. Named images are filed only when
 * RunManager persists an accepted user attachment, on the same terms as documents. */
export function toPastedContent(
  attachment: {
    mediaType: string;
    data: string;
    name?: string;
  },
): PastedContent {
  if (isImageMediaType(attachment.mediaType)) {
    const block: ContentBlock = {
      type: 'image', source: { type: 'base64', media_type: attachment.mediaType, data: attachment.data },
    };
    const name = attachment.name ? sanitizeAttachmentName(attachment.name, attachment.mediaType) : null;
    if (name) imageLibraryNames.set(block, name);
    return block;
  }
  const name = attachment.name ? sanitizeAttachmentName(attachment.name, attachment.mediaType) : null;
  return { type: 'file', mediaType: attachment.mediaType, data: attachment.data, ...(name ? { name } : {}) };
}

/** The image blocks of a mixed list — what may be delivered to a session. */
export function contentBlocksOf(content: readonly PastedContent[]): ContentBlock[] {
  return content.filter((b): b is ContentBlock => b.type !== 'file');
}

/** The opening prompt of a task given as attachments alone (telemetry 18c930de). */
export const ATTACHMENT_ONLY_TASK = 'The user attached the files below without a written task — work out what they need from them.';

/**
 * Plain-text note listing the absolute paths of pasted attachments, appended
 * to the message that carries them (#357). The base64 image blocks stay in
 * the message for the model to *view*; this note is what lets it *use* the
 * files as files — and the only usable reference on backends (codex,
 * opencode) whose `textOf()` drops image blocks before reaching the model.
 */
export function pastedAttachmentsText(attachments: PersistedAttachment[], libraryDir?: string): string {
  const list = attachments.map((a) => `- ${a.path}`).join('\n');
  // The library (#929) is pointed at as a DIRECTORY rather than per-file, deliberately: the paths
  // above already cover the files on THIS message, and what the library is for is the file the
  // user attached to some earlier task and now refers to only by name. Naming the folder also
  // keeps the note independent of per-attachment state, which does not survive the re-read at
  // dequeue (`readPersistedAttachments` reconstructs an attachment from its URL alone).
  // Says "documents and named images", not "attachments": an upload that arrived without a name of
  // its own — a clipboard paste, typically — is never filed (#929, #960), so a note promising every
  // attachment would send an agent hunting for last week's pasted screenshot in a folder that was
  // never going to hold it.
  const library = libraryDir
    ? `Documents and named images attached anywhere in this project are also kept under their ` +
      `original names in ${libraryDir} — look there for a file the user names but did not attach ` +
      `to this message.\n`
    : '';
  return (
    `The user attached ${attachments.length} pasted file${attachments.length > 1 ? 's' : ''}, ` +
    `also saved on disk at:\n${list}\n${library}` +
    `When the task involves saving, uploading, attaching, or transforming the pasted content ` +
    `(e.g. attaching to a GitHub issue/PR, copying into the repo), operate on these files — do ` +
    `not attempt to reconstruct them from the conversation.`
  );
}

/** Same note as `pastedAttachmentsText`, wrapped as a trailing `ContentBlock`
 *  ready to append to a message's content array. */
export function pastedAttachmentsNote(attachments: PersistedAttachment[], libraryDir?: string): ContentBlock {
  return { type: 'text', text: pastedAttachmentsText(attachments, libraryDir) };
}

/** Variant letters + the fixed diversification hints (spec 010). A runs the
 *  task verbatim; B/C get one constant sentence each — zero configuration. */
export const VARIANT_LETTERS = ['A', 'B', 'C'] as const;
export const VARIANT_HINTS: Record<string, string | undefined> = {
  A: undefined,
  B: 'Approach hint: prefer the minimal, surgical change.',
  C: 'Approach hint: prefer a thorough, structural approach.',
};

export const RESTART_CONTINUATION_PROMPT =
  'The onni process restarted while you were working on this task. Read the handoff file (ONNI_HANDOFF_FILE) to recover context, then continue the task from where you left off.';


