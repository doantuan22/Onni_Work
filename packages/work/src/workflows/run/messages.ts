import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { isImageAttachmentName } from '@onni/contract';
import type { ContentBlock } from '../../core/agent-runner.ts';
import type { QueuedMessage } from '../../runs/store.ts';
import { extractTaskRefs, refineTaskRefs } from '../../runs/task-refs.ts';
import { messageText } from '../queued-bounds.ts';
import { stepKind } from '../types.ts';
import { makeRunTitle } from './start.ts';
import {
  contentBlocksOf,
  mediaTypeFor,
  pastedAttachmentsNote,
  type PersistedAttachment,
  type PastedContent,
} from './preparation.ts';
import type {
  MessageContext,
  PendingContinuation,
  PersistedAttachments,
  PreparedUserMessage,
} from './internal-types.ts';
import type { StartRunInput } from '../run.ts';

/**
 * Fold a queued run's persisted prompt — `run.task` plus everything stacked
 * onto it (#472) — into the job input that is about to execute.
 *
 * Called from `pump()` immediately before `execute()`, which makes the RECORD
 * the single source of truth for a queued run's prompt. Before this, the
 * executing copy lived in `pendingJobs` (memory) while the record held a
 * second one, so an edit that PATCHed the record silently did nothing until a
 * restart. `recover()` rebuilds through the same helper, so both paths agree.
 *
 * **Read-only, and that is load-bearing.** It composes into the in-memory
 * `input` and never writes the folded string back to `RunRecord.task`; the
 * task and its stack stay separate on disk for the life of the run. Writing
 * back would re-append the whole stack on every recovery and compound without
 * bound — asserted directly by a test.
 */
export function hydrateQueuedInput(ctx: MessageContext, runId: string, input: StartRunInput): StartRunInput {
  const run = ctx.store.getRun(runId);
  if (!run) return input;
  const stack = run.queuedMessages ?? [];

  const task = [run.task, ...stack.map((m) => m.text)]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join('\n\n');

  // Keep the original in-memory blocks for a live process (including the
  // best-effort case where persistence failed). Recovery has no such copy,
  // so rebuild it from the durable task-image URLs.
  const images = input.images?.length
    ? input.images
    : readPersistedAttachments(ctx, runId, run.taskImages ?? [], 'task').blocks;
  const stackedImages = readPersistedAttachments(ctx,
    runId,
    stack.flatMap((m) => m.images ?? []),
    'queued',
  ).blocks;

  return {
    ...input,
    task,
    ...(images.length ? { images } : { images: undefined }),
    ...(stackedImages.length ? { stackedImages } : { stackedImages: undefined }),
  };
}

/** Apply edits and messages made while a restart continuation waits for
 * capacity. The durable record remains the source of truth, just as it is for
 * an ordinary queued workflow (#472), so a second restart reconstructs and
 * hydrates the same amendments instead of dropping them. */
export function hydrateQueuedContinuation(
  ctx: MessageContext,
  runId: string,
  continuation: PendingContinuation,
): PendingContinuation & {
  persistedImages: ContentBlock[];
  persistedAttachments: PersistedAttachment[];
} {
  const run = ctx.store.getRun(runId);
  if (!run) {
    return { ...continuation, persistedImages: [], persistedAttachments: [] };
  }
  const stack = run.queuedMessages ?? [];
  const amendedTask = [run.task, ...stack.map((message) => message.text)]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join('\n\n');
  const prompt = amendedTask
    ? `${continuation.prompt}\n\nCurrent task and queued updates:\n\n${amendedTask}`
    : continuation.prompt;
  const persisted = readPersistedAttachments(ctx,
    runId,
    stack.flatMap((message) => message.images ?? []),
    'queued',
  );
  return {
    ...continuation,
    prompt,
    persistedImages: persisted.blocks,
    persistedAttachments: persisted.attachments,
  };
}

/** Where `persistAttachment` writes a run's pasted files. */
export function attachmentsDir(ctx: MessageContext, runId: string): string {
  return join(ctx.dataDir, 'runs', `${runId}-images`);
}

/**
 * Re-read persisted attachments at dequeue/restart (#472): an image comes back as a viewable
 * block AND a path, a file (#950) as a path only. The branch is on the NAME's extension, never
 * on which list the URL came from — images and files share one list, and re-encoding a `.pdf`
 * into a base64 image block is a message no backend can accept.
 *
 * A file is still `stat`-checked here rather than trusted: an attachment the user deleted must
 * drop out of the paths handed to the agent, exactly as a missing image does.
 */
export function readPersistedAttachments(
  ctx: MessageContext,
  runId: string,
  urls: string[],
  kind: 'task' | 'queued',
): PersistedAttachments {
  const blocks: ContentBlock[] = [];
  const attachments: PersistedAttachment[] = [];
  for (const url of urls) {
    const name = url.split('/').pop();
    if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) continue;
    const path = join(attachmentsDir(ctx, runId), name);
    try {
      if (isImageAttachmentName(name)) {
        const data = readFileSync(path);
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: mediaTypeFor(name), data: data.toString('base64') },
        });
      } else if (!existsSync(path)) {
        throw new Error('missing');
      }
      attachments.push({ name, url, path });
    } catch {
      // Degrade, never fail the boot (AGENTS.md): the user deleted `.ai/onni/`
      // or the file is unreadable — start with the text and say which attachment went.
      ctx.store.appendEvent(runId, {
        type: 'note',
        message: `${kind} attachment ${name} could not be read — starting without it`,
      });
    }
  }
  return { blocks, attachments };
}

/**
 * Still waiting for a slot? Checked against the engine's own queue rather than
 * the record's `status` (#472): the record is written by `execute()` a tick
 * after `pump()` dequeues, so a status read can see `queued` for a run that has
 * already started. The pending maps are deleted synchronously at dequeue, so
 * they are the authoritative answer for "can this prompt still be amended".
 */
export function isQueued(ctx: MessageContext, runId: string): boolean {
  return ctx.pendingJobs.has(runId) || ctx.pendingContinuations.has(runId);
}

/** Split a pasted message into the persisted shape a stacked message holds. */
export function toQueuedMessage(
  ctx: MessageContext,
  runId: string,
  content: PastedContent[],
  managerDeliveryId?: string,
): QueuedMessage {
  const text = content
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  const images = ctx.persistPastedAttachments(runId, content).map((saved) => saved.url);
  return {
    id: randomUUID(),
    text,
    ...(managerDeliveryId ? { managerDeliveryId } : {}),
    ...(images.length ? { images } : {}),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Append a prompt message onto a still-queued run (#472). Returns the stored
 * entry, or null when the run has already started — the caller then falls
 * through to `deferMessage`.
 */
export function enqueueMessage(
  ctx: MessageContext,
  runId: string,
  content: PastedContent[],
  managerDeliveryId?: string,
): QueuedMessage | null {
  if (!isQueued(ctx, runId)) return null;
  const run = ctx.store.getRun(runId);
  if (!run) return null;
  const message = toQueuedMessage(ctx, runId, content, managerDeliveryId);
  ctx.store.updateRun(runId, { queuedMessages: [...(run.queuedMessages ?? []), message] });
  return message;
}

/** Edit a stacked message in place. Omitted fields retain their current value. */
export function editQueuedMessage(
  ctx: MessageContext,
  runId: string,
  msgId: string,
  edit: { text?: string; images?: PastedContent[] },
): QueuedMessage | null {
  if (!isQueued(ctx, runId)) return null;
  const run = ctx.store.getRun(runId);
  const stack = run?.queuedMessages;
  if (!stack) return null;
  const at = stack.findIndex((m) => m.id === msgId);
  if (at < 0) return null;
  const current = stack[at]!;
  const replacementImages = edit.images === undefined
    ? current.images
    : toQueuedMessage(ctx, runId, edit.images).images;
  const replacement: QueuedMessage = {
    id: msgId,
    text: edit.text ?? current.text,
    ...(current.managerDeliveryId ? { managerDeliveryId: current.managerDeliveryId } : {}),
    ...(replacementImages?.length ? { images: replacementImages } : {}),
    createdAt: current.createdAt,
  };
  const next = [...stack];
  next[at] = replacement;
  ctx.store.updateRun(runId, { queuedMessages: next });
  // Images the edit dropped are now orphans.
  dropOrphanImages(ctx, runId, stack[at]!.images ?? [], next);
  return replacement;
}

/** Remove a stacked message and its now-orphaned attachments. */
export function removeQueuedMessage(ctx: MessageContext, runId: string, msgId: string): boolean {
  if (!isQueued(ctx, runId)) return false;
  const run = ctx.store.getRun(runId);
  const stack = run?.queuedMessages;
  if (!stack) return false;
  const target = stack.find((m) => m.id === msgId);
  if (!target) return false;
  const next = stack.filter((m) => m.id !== msgId);
  ctx.store.updateRun(runId, { queuedMessages: next });
  dropOrphanImages(ctx, runId, target.images ?? [], next);
  return true;
}

/**
 * Delete image files no longer referenced by anything (#472). Best effort — a
 * leftover file is harmless and goes with the run. Never touches a URL still
 * referenced by another stacked entry or by the initial prompt's `taskImages`.
 */
export function dropOrphanImages(
  ctx: MessageContext,
  runId: string,
  candidates: string[],
  stack: QueuedMessage[],
): void {
  if (!candidates.length) return;
  const run = ctx.store.getRun(runId);
  const referenced = new Set([
    ...(run?.taskImages ?? []),
    ...stack.flatMap((m) => m.images ?? []),
  ]);
  for (const url of candidates) {
    if (referenced.has(url)) continue;
    const name = url.split('/').pop();
    // Defend the join against a crafted URL: only a bare file name may be deleted.
    if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) continue;
    try {
      rmSync(join(ctx.dataDir, 'runs', `${runId}-images`, name), { force: true });
    } catch {
      /* best effort */
    }
  }
}

/**
 * Edit the initial prompt of a still-queued run (#472). Re-derives the
 * heuristic title and the PR/issue chips, but never re-runs the LLM namer —
 * it already fired at creation and a second model call per edit is unjustified.
 */
export function editTask(ctx: MessageContext, runId: string, task: string): boolean {
  if (!isQueued(ctx, runId)) return false;
  const run = ctx.store.getRun(runId);
  if (!run) return false;
  const workflow = ctx.pendingJobs.get(runId)?.workflow;
  const skillHint = workflow?.steps.find((s) => stepKind(s) === 'agent' && s.skill)?.skill?.trim();
  const refs = refineTaskRefs(extractTaskRefs(task), skillHint);
  // Hand-edited titles always win (#389): `user` beats the heuristic, and a
  // `marker` title the agent declared beats it too.
  const keepTitle = run.titleOrigin === 'user' || run.titleOrigin === 'marker';
  ctx.store.updateRun(runId, {
    task,
    ...(keepTitle || !workflow ? {} : { title: makeRunTitle(task, workflow) }),
    ...(refs.prNumber !== undefined ? { prNumber: refs.prNumber } : {}),
    ...(refs.issueNumber !== undefined ? { issueNumber: refs.issueNumber } : {}),
  });
  return true;
}

/**
 * Buffer a message that arrived in the gap between dequeue and session-open
 * (#472). `pump()` has already folded the stack and `execute()` is spawning the
 * backend, so there is nothing left to amend and no session to deliver into —
 * without this rung the message would 409, a genuinely dropped message in the
 * feature built to stop dropping them. Flushed as an ordinary follow-up turn
 * the instant the session opens; a run that settles first resumes with it
 * (`redeliverDeferred`).
 *
 * The buffer lives on the manager rather than the `ActiveRun` because the
 * `ActiveRun` does not exist yet for part of this window.
 */
export function deferMessage(
  ctx: MessageContext,
  runId: string,
  content: PastedContent[],
  managerDeliveryId?: string,
): boolean {
  // The window spans two sub-states: `starting` (no `ActiveRun` yet) and the
  // longer stretch where the `ActiveRun` exists but the backend is still being
  // spawned. `execute()` deletes the run from `starting` as soon as it builds
  // the state — seconds before the session opens — so checking `starting`
  // alone would reopen exactly the drop this rung exists to close.
  const state = ctx.active.get(runId);
  const startingUp = (ctx.starting.has(runId) && !ctx.cancelledStarting.has(runId)) || (state !== undefined && !state.sessionEverOpened && !state.cancelled);
  // A session gap on a live owner — between workflow steps, or settling after the last turn
  // (landing, review gate: well over ten seconds on a busy Windows host) while the record still
  // says `running`. The next session's open flushes it; `dropActive` resumes with it otherwise
  // (telemetry 1408d7cb). A park (`waiting`: a CI or children wait, the review gate) is not a gap —
  // nothing opens a session there soon, so the message would sit unseen; it answers 409 as before.
  const sessionGap = state !== undefined && !state.cancelled && !state.session?.open && !ctx.waiting.has(runId) && !ctx.lifecycle.isBlocked(runId);
  if (!startingUp && !sessionGap) return false;
  const pending = ctx.deferredMessages.get(runId) ?? [];
  const deliveryIds = ctx.deferredManagerDeliveryIds.get(runId) ?? pending.map(() => undefined);
  ctx.setDeferred(runId, [...pending, content], [...deliveryIds, managerDeliveryId]);
  return true;
}

/** Deliver anything `deferMessage` buffered, once the session is live. */
export function flushDeferred(ctx: MessageContext, runId: string): void {
  const pending = ctx.deferredMessages.get(runId);
  if (!pending?.length) return;
  const deliveryIds = ctx.deferredManagerDeliveryIds.get(runId) ?? [];
  // Re-buffer whatever the session refused rather than dropping it. `sendMessage`
  // answers false when the session is not open yet — and silently losing a message
  // here would be precisely the failure `deferMessage` exists to prevent. Anything
  // left over is retried by the next session that opens on this run.
  const unsent: PastedContent[][] = [];
  const unsentIds: Array<string | undefined> = [];
  pending.forEach((content, index) => {
    const managerDeliveryId = deliveryIds[index];
    if (!ctx.sendMessage(runId, content, undefined, managerDeliveryId)) {
      unsent.push(content);
      unsentIds.push(managerDeliveryId);
    }
  });
  ctx.setDeferred(runId, unsent, unsentIds);
}

/**
 * Deliver a user message into the run's live claude session (mid-turn or
 * while `waiting`). Returns false when there is no open session — the GUI
 * then offers "Continue" instead.
 */
export function sendMessage(
  ctx: MessageContext,
  runId: string,
  content: PastedContent[],
  replyTo?: string,
  managerDeliveryId?: string,
): boolean {
  const delivered = ctx.deliverMessage(runId, content, true, undefined, replyTo, managerDeliveryId);
  if (delivered) {
    const state = ctx.active.get(runId);
    if (state) state.monitoringWakeups = 0;
    ctx.store.updateRun(runId, { monitoringWakeCapReached: undefined });
  }
  return delivered;
}

/** Shared live-session delivery. Synthetic scheduler prompts reuse lifecycle
 * bookkeeping without masquerading as user-authored transcript messages. */
export function deliverMessage(
  ctx: MessageContext,
  runId: string,
  content: PastedContent[],
  userAuthored: boolean,
  preparedUserMessage?: PreparedUserMessage,
  replyTo?: string,
  managerDeliveryId?: string,
): boolean {
  if (ctx.lifecycle.isBlocked(runId)) return false;
  // Plan v2 §9: only the answer that names the OPEN manager question retires it. A free message
  // — the ordinary way a Guard ask is answered — leaves it alone, so the card keeps its question.
  const answering = userAuthored ? ctx.softAskFor(runId, replyTo) : undefined;
  const state = ctx.active.get(runId);
  // A graph gate/question parked with no session (1c) takes the user's reply as its answer.
  // Only a USER-authored message answers it: a child report or a wake nudge must not approve a gate.
  if (state && !state.cancelled && !state.session?.open && state.graphAnswer && userAuthored) {
    const text = content
      .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    ctx.store.appendEvent(runId, { type: 'user-message', stepId: state.currentStepId, text, imageCount: 0, images: [] });
    ctx.clearPendingAsk(runId);
    const answer = state.graphAnswer;
    state.graphAnswer = undefined;
    answer(text);
    return true;
  }
  if (!state?.session?.open || state.cancelled) return false;
  // Acceptance and execution are separate when an in-place task has yielded the repository
  // lease. Persist the user's message at acceptance time so the thread acknowledges it at once,
  // even if another task holds the tree for minutes. The prepared payload travels through the
  // asynchronous lease wait and is reused for delivery, so attachments and the transcript row
  // are still written exactly once.
  let prepared = preparedUserMessage;
  if (userAuthored && !prepared) {
    const text = content
      .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    const imageLibraryWrites: Array<() => void> = [];
    const persisted = ctx.persistPastedAttachments(runId, content, imageLibraryWrites);
    prepared = { text, persisted, imageLibraryWrites };
    if (!managerDeliveryId) {
      ctx.store.appendEvent(runId, {
        type: 'user-message',
        stepId: state.currentStepId,
        text,
        imageCount: content.filter((b) => b.type === 'image').length,
        images: persisted.map((saved) => saved.url),
      });
    }
  }
  // A parked in-place run gave the working-tree lease back (`parkRepoRoot`). It must own the
  // tree again before its session resumes, and the lease is asynchronous — so the message is
  // ACCEPTED here (the caller's delivery ladder stops, as it would for a sent message) and
  // delivered once the tree is ours. Every wake-up that lands meanwhile rides the same wait.
  if (state.repoRootParked && !(state.repoRootResume === undefined && ctx.claimFreeRepoRoot(state))) {
    const resume = (state.repoRootResume ??= ctx.resumeRepoRoot(runId, state));
    if (managerDeliveryId && userAuthored && preparedUserMessage === undefined) {
      ctx.store.appendEvent(runId, {
        type: 'user-message',
        stepId: state.currentStepId,
        text: prepared?.text ?? messageText(content),
        imageCount: content.filter((b) => b.type === 'image').length,
        images: prepared?.persisted.map((saved) => saved.url) ?? [],
      });
    }
    void resume.then((acquired) => {
      if (!acquired) {
        if (managerDeliveryId) ctx.recordManagerDeliveryTransition(runId, managerDeliveryId, 'rejected', 'target-settled');
        return;
      }
      // Another in-place task held the tree while we waited, so this session's picture of it may
      // be stale. Delivered as its own engine message, ahead of the one the run woke for, so a
      // user-authored wake-up stays verbatim in the transcript.
      ctx.deliverMessage(runId, [{ type: 'text', text: ctx.repoRootResumedNote }], false);
      if (ctx.deliverMessage(runId, content, userAuthored, prepared, replyTo, managerDeliveryId)) return;
      // The session closed while we waited: keep the message the way the ladder would.
      if (!ctx.enqueueMessage(runId, content, managerDeliveryId) && !ctx.deferMessage(runId, content, managerDeliveryId)) {
        if (managerDeliveryId) ctx.recordManagerDeliveryTransition(runId, managerDeliveryId, 'rejected', 'runner-rejected');
      }
    });
    return true;
  }

  // Persist the attachments so the thread can render them (not just count them) — the same
  // on-disk store + `/images/` route the agent's own screenshots use. `pasted` prefix marks
  // these as user attachments (vs. agent tool screenshots) on disk (#357).
  // The session can still refuse despite reporting open. Commit image library copies
  // only after it accepts; the run-local paths are needed to build the message first.
  const imageLibraryWrites = prepared?.imageLibraryWrites ?? [];
  const persisted = prepared?.persisted ?? [];

  // Tell the agent where the pasted files live on disk (#357): image blocks still ride along
  // so the model can *view* them, but a real path is what lets it *operate* on them (save,
  // `cp`, attach to a GitHub issue/PR) — and it's the only usable reference on backends (codex,
  // opencode) that drop image blocks entirely before reaching the model, and the ONLY reference
  // at all for a non-image attachment (#950), which is why `contentBlocksOf` drops file blocks
  // here rather than letting one reach a backend that has no idea what it is.
  const blocks = contentBlocksOf(content);
  const expanded = userAuthored ? ctx.expandRegistrySlashSkill(blocks, state.skills ?? []) : blocks;
  if (expanded !== blocks) {
    // Delivery is synchronous; the body already rides the message, so the install can trail it.
    const first = blocks.find((block) => block.type === 'text');
    void ctx.provisionTaskSkills(state, { slash: first?.type === 'text' ? ctx.leadingSlashSkillName(first.text) : undefined });
  }
  const deliverable = persisted.length
    ? [...withAnswerLead(ctx, answering?.question, prepared?.text, expanded), pastedAttachmentsNote(persisted, ctx.attachmentLibraryHint(persisted, state.grantedAttachmentLibrary) ??
        (imageLibraryWrites.length ? ctx.usableAttachmentLibrary(state.grantedAttachmentLibrary) : undefined))]
    : withAnswerLead(ctx, answering?.question, prepared?.text, expanded);
  let returned = false;
  let receiptBeforeReturn: { state: 'acknowledged' | 'rejected'; reasonCode?: 'async-rejected' } | undefined;
  const onReceipt = (receipt: { state: 'acknowledged' | 'rejected'; reasonCode?: 'async-rejected' }): void => {
    if (!managerDeliveryId) return;
    if (!returned) {
      receiptBeforeReturn = receipt;
      return;
    }
    ctx.recordManagerDeliveryTransition(
      runId,
      managerDeliveryId,
      receipt.state,
      receipt.state === 'rejected' ? receipt.reasonCode ?? 'async-rejected' : undefined,
    );
  };
  const delivered = managerDeliveryId && state.session.sendMessageWithReceipt
    ? state.session.sendMessageWithReceipt(deliverable, onReceipt)
    : state.session.sendMessage(deliverable);
  if (delivered && managerDeliveryId) {
    if (userAuthored && preparedUserMessage === undefined) {
      ctx.store.appendEvent(runId, {
        type: 'user-message',
        stepId: state.currentStepId,
        text: prepared?.text ?? messageText(content),
        imageCount: content.filter((b) => b.type === 'image').length,
        images: prepared?.persisted.map((saved) => saved.url) ?? [],
      });
    }
    ctx.recordManagerDeliveryTransition(runId, managerDeliveryId, 'delivered');
  }
  returned = true;
  if (receiptBeforeReturn && managerDeliveryId) {
    ctx.recordManagerDeliveryTransition(
      runId,
      managerDeliveryId,
      receiptBeforeReturn.state,
      receiptBeforeReturn.state === 'rejected' ? receiptBeforeReturn.reasonCode ?? 'async-rejected' : undefined,
    );
  }
  if (delivered) {
    for (const write of imageLibraryWrites) write();
    ctx.clearPendingAsk(runId);
    if (answering) ctx.clearSoftAsk(runId);
    ctx.clearIdleTimer(state);
    ctx.clearMonitoringWakeTimer(state, runId);
    ctx.waiting.delete(runId); // resumed — the run counts against slots again
    state.idleClosed = undefined;
    // A message into the session is a fresh start for the compaction bound (#955): whoever
    // sent it — the user, a child's report, the monitoring wake-up — is asking for work
    // that has not been tried yet, so it must not inherit a spent anti-spin budget.
    state.compactionContinues = 0;
    ctx.leaveMonitoring(runId);
    // The answer landed, so a mid-workflow ask park (#917) is over and the
    // workflow may advance past this step again. The durable twin
    // (`RunRecord.askParked`) is retired by the status write below.
    state.askPark = undefined;
    // Clear any `monitoring` activity — the agent is actively working again
    // (spec 2026-07-18-subagent-monitoring-status, #490).
    ctx.store.updateRun(runId, { status: 'running', activity: undefined, askParked: undefined });
    if (state.currentStepId) {
      ctx.store.updateStep(runId, state.currentStepId, { status: 'running' });
    }
  }
  return delivered;
}

/**
 * The manager hears WHICH question an answer belongs to (plan v2 §9). Only the engine-facing
 * blocks are prefixed — the persisted `user-message` keeps the user's own words — and the text
 * block it replaces is dropped so the answer is read once, while attachments still ride along.
 */
export function withAnswerLead(
  ctx: MessageContext,
  question: string | undefined,
  answer: string | undefined,
  blocks: ContentBlock[],
): ContentBlock[] {
  if (question === undefined) return blocks;
  const said = answer?.trim();
  return [
    {
      type: 'text',
      text: `User answered your question "${question}": ${said || '(see the attached files)'}`,
    },
    ...blocks.filter((block) => block.type !== 'text'),
  ];
}
