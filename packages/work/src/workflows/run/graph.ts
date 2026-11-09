import { randomUUID } from 'node:crypto';
import type { WebhookAttentionRequest } from '@onni/contract';
import { resolve as resolvePath } from 'node:path';
import type { ContentBlock, RunnerId } from '../../core/agent-runner.ts';
import { childSettleReport, handoffSectionExcerpt, isTerminalStatus } from '../../dispatch/engine.ts';
import { autosaveCommit, commitAll, pushBranch, syncWithBase, worktreeChangedFiles, worktreeHeadShort, worktreeShortstat } from '../../git-worktree.ts';
import { readHandoff } from '../../handoff.ts';
import type { RunRecord, StepState } from '../../runs/store.ts';
import { commentOnIssue, commentOnPr, fetchGithubChecks, updatePr } from '../../server/forge/github.ts';
import { createDraftPr } from '../../server/pr.ts';
import { discoverSkills } from '../../skills.ts';
import type { Skill } from '../../skills.ts';
import { provisionSkills } from '../../skills-provision.ts';
import { getTeamSkillsCached, materializeSkillDir, waitForTeamSkills } from '../../skills-remote.ts';
import { chainStepNote } from '../types.ts';
import type { WorkflowDef, WorkflowStepDef } from '../types.ts';
import { advance, compareValues, enterGraph, globMatch, loopBodyIds, edgeFrom, forkShape, isFailurePort, isTerminalAgent, nodeToStep, parseVerdict, renderNodeRefs, stripVerdictMarker, verdictInstruction, isExecutableNode } from '../graph.ts';
import type { Condition, ExecutableNode, ForkShape, GraphNode, GraphStepResult, GraphTransition, WorkflowGraph } from '../graph.ts';
import { loadWorkflows } from '../load.ts';
import { pushRefusal } from '../push-guard.ts';
import { RESTART_CONTINUATION_PROMPT } from './preparation.ts';
import type { PersistedAttachment } from './preparation.ts';
import type { GraphActiveRun, GraphContext } from './internal-types.ts';
import type { StartRunInput } from '../run.ts';

const GRAPH_TAKEN_CAP = 500;
const NODE_SUMMARY_CAP = 4_000;
const TEAM_SKILLS_WAIT_MS = 10_000;

type GraphParkOutcome =
  | { kind: 'answer'; text: string }
  | { kind: 'timeout' }
  | { kind: 'finished' }
  | { kind: 'cancelled' };

function childSucceeded(status: string): boolean {
  return status === 'done' || status === 'review';
}

function describeCondition(c: Condition): string {
  switch (c.kind) {
    case 'diff-lines':
      return `changed lines ${c.op} ${c.value}`;
    case 'diff-files':
      return `changed files ${c.op} ${c.value}`;
    case 'paths-changed':
      return `changed paths match ${c.glob}`;
    case 'output':
      return `${c.ref} ${c.op} ${c.value}`;
    case 'branch':
      return `base branch ${c.op} ${c.value}`;
  }
}

  /**
   * Walk a graph workflow (spec 2026-09-30-workflow-node-editor, phase 1): the graph twin of the
   * v1 step loop in `execute`, using the same step runners, rail updates and settlement. Each
   * finished node emits one port; `advance` follows it through loop nodes to the next agent or
   * check node, or to the run's end. Returns the run error, or null for a successful end.
   *
   * Semantics kept from v1: a failing check's output is handed to the next agent it reaches
   * (the retry prompt); an agent node whose `done` ends the run is the interactive tail; a
   * mid-graph `ONNI:ASK` park ends the walk and the settlement in `execute` owns the outcome.
   */
export async function executeGraph(context: GraphContext,
    runId: string,
    state: GraphActiveRun,
    workflow: WorkflowDef,
    graph: WorkflowGraph,
    ctx: {
      input: StartRunInput;
      skills: Skill[];
      emit: (event: { type: string; stepId?: string; [k: string]: unknown }) => void;
      taskBackend: RunnerId;
      extraSystemPrompt: string | undefined;
      startImages: ContentBlock[] | undefined;
      startAttachments: PersistedAttachment[];
      /** The walk so far, when this run is being RESUMED after a restart (`graphState.cursor`). */
      resume?: RunRecord['graphState'];
      /** The agent step a usage limit interrupted (#1300); `resume.cursor` points at it. */
      usageLimitResume?: StepState;
    },
  ): Promise<string | null> {
    const { input, skills, emit, taskBackend, extraSystemPrompt } = ctx;
    let { startImages, startAttachments } = ctx;
    // Resume only onto a node this graph still has; anything else starts the walk afresh.
    const resumeNode = ctx.resume?.cursor
      ? graph.nodes.find((n): n is ExecutableNode => n.id === ctx.resume?.cursor && isExecutableNode(n))
      : undefined;
    const resume = resumeNode ? ctx.resume : undefined;
    const loopCounts = new Map<string, number>(Object.entries(resume?.loops ?? {}));
    const outputs = new Map<string, Record<string, string | number>>(Object.entries(resume?.outputs ?? {}));
    // #1300: a v1 check's consumed retries live on its step record (`retriesUsed`), so recovery
    // never depends on the transcript. An older executed check has unknown accounting, so
    // conservatively spend its cap rather than grant retries.
    const checkLoops = new Map<string, string>();
    if (!workflow.graph) {
      const checkpoint = context.store.getRun(runId);
      let initializedRetryBudget = false;
      for (const def of workflow.steps) {
        if (!def.command || !def.onFail) continue;
        const loopId = graph.edges.find((e) => e.from === `${def.id}.fail`)?.to;
        if (!loopId) continue;
        checkLoops.set(loopId, def.id);
        const rec = checkpoint?.steps.find((candidate) => candidate.id === def.id);
        // A walk resumed after a restart already carries the exact count; only a record with
        // neither falls back to the conservative legacy rule.
        const walked = resume?.loops?.[loopId];
        const legacyExecuted = rec?.retriesUsed === undefined && walked === undefined && (rec?.iterations ?? 0) > 0;
        const used = rec?.retriesUsed ?? walked ?? (legacyExecuted ? def.onFail.max : 0);
        loopCounts.set(loopId, used);
        if (rec?.retriesUsed === undefined) {
          context.store.updateStep(runId, def.id, { retriesUsed: used });
          initializedRetryBudget = true;
        }
        if (legacyExecuted) {
          emit({
            type: 'note', stepId: def.id,
            message: 'check retry accounting unavailable on this older record — no further retries granted',
          });
        }
      }
      if (initializedRetryBudget) context.store.flush();
    }
    let checkFailure: string | null = null;
    /** The last agent failure, for the run error when its `failed` port is unwired (v1 wording). */
    let agentFailure: string | undefined;
    let cursor: string | undefined;
    const persistWalk = () =>
      context.store.updateRun(runId, {
        graphState: {
          loops: Object.fromEntries(loopCounts),
          taken: taken.slice(-GRAPH_TAKEN_CAP),
          ...(cursor ? { cursor } : {}),
          ...(outputs.size ? { outputs: Object.fromEntries(outputs) } : {}),
        },
      });

    const record = (transitions: GraphTransition[]) => {
      for (const t of transitions) {
        taken.push(`${t.from}.${t.port}->${t.to ?? ''}`);
        const loop = graph.nodes.find((n) => n.id === t.from && n.type === 'loop');
        if (loop && loop.type === 'loop') {
          const iteration = loopCounts.get(loop.id) ?? 0;
          const check = checkLoops.get(loop.id);
          if (check && t.port === 'repeat') {
            // #1300: commit the consumed retry before another agent can start, even after a crash.
            context.store.updateStep(runId, check, { retriesUsed: iteration });
            context.store.flush();
          }
          outputs.set(loop.id, { iteration, max: loop.max });
          emit({
            type: 'note',
            message:
              t.port === 'repeat'
                ? `loop "${loop.name ?? loop.id}" — iteration ${iteration}/${loop.max}${t.to ? `, back to "${t.to}"` : ''}`
                : `loop "${loop.name ?? loop.id}" exhausted after ${loop.max} iterations`,
          });
        }
      }
      // The live graph in the task view reads this off the record (phase 3); the record already
      // streams to the cockpit, so no new channel is needed.
      persistWalk();
      // A loop going back re-opens every rail step between its target and the node that failed,
      // so the rail reads top-to-bottom truthfully (the v1 loop's rule, kept).
      for (const t of transitions) {
        if (t.port !== 'repeat' || !t.to) continue;
        const into = transitions.find((x) => x.to === t.from);
        if (!into?.from) continue;
        const rail = context.store.getRun(runId)?.steps ?? [];
        const body = loopBodyIds(graph, t.to, into.from);
        for (const r of rail) if (body.has(r.id)) context.store.updateStep(runId, r.id, { status: 'pending' });
      }
    };
    const taken: string[] = [...(resume?.taken ?? [])];

    let step: GraphStepResult = resumeNode
      ? { kind: 'node', node: resumeNode, transitions: [] }
      : enterGraph(graph, loopCounts);
    if (resumeNode) {
      const why = ctx.usageLimitResume?.id !== resumeNode.id ? 'a restart'
        : context.autoResumeReasonFor(ctx.usageLimitResume.error) === 'transient' ? 'a temporary provider failure' : 'a usage limit';
      emit({ type: 'note', message: `resuming the workflow at "${resumeNode.name ?? resumeNode.id}" after ${why}` });
    }
    else record(step.transitions);
    while (step.kind === 'node') {
      if (state.cancelled) return null;
      const node = step.node;
      const resuming = resumeNode?.id === node.id && cursor === undefined;
      cursor = node.id;
      persistWalk();
      const kind: 'agent' | 'check' = node.type === 'agent' ? 'agent' : 'check';
      const iteration = (context.store.getRun(runId)?.steps.find((s) => s.id === node.id)?.iterations ?? 0) + 1;
      context.store.updateRun(runId, { currentStepId: node.id });
      context.store.updateStep(runId, node.id, {
        status: 'running',
        iterations: iteration,
        startedAt: new Date().toISOString(),
        finishedAt: undefined,
        error: undefined,
      });
      emit({ type: 'step-start', stepId: node.id, name: node.name ?? node.id, kind, iteration });

      let port: string;
      /** The node the walk leaves from — a fork leaves from its join. */
      let leaveFrom: string = node.id;
      if (node.type === 'fork') {
        const shape = forkShape(graph, node.id);
        const outcome =
          typeof shape === 'string' ? shape : await context.runFork(graph, runId, state, node, shape, outputs, input.task, emit, persistWalk, resuming);
        if (state.cancelled) return null;
        if (outcome === 'finished') {
          context.finishStep(runId, node.id, 'done', undefined, emit);
          return null;
        }
        if (typeof outcome === 'string') {
          // Validation rejects a malformed fork; a graph that skipped it fails here, loudly.
          context.finishStep(runId, node.id, 'failed', outcome, emit);
          port = 'failed';
        } else {
          context.finishStep(runId, node.id, 'done', undefined, emit);
          record(outcome.transitions);
          leaveFrom = outcome.join;
          port = outcome.port;
        }
      } else if (node.type === 'join') {
        // Only a fork reaches a join (it waits there itself); validation rejects anything else.
        context.finishStep(runId, node.id, 'failed', 'a join can only be reached from a fork', emit);
        port = 'failed';
      } else if (node.type !== 'agent' && node.type !== 'check') {
        // Nodes onni runs itself: gates, questions, dispatch, git and GitHub (phase 1c).
        const outcome = await context.runSystemNode(runId, state, node, outputs, input.task, emit, persistWalk, resuming);
        if (state.cancelled) return null;
        // Finish on a parked gate/question is "stop here and accept" — the same settlement a
        // Finish on a parked agent step gets (`askPark === 'abandoned'`).
        if (outcome === 'finished') {
          context.finishStep(runId, node.id, 'done', undefined, emit);
          return null;
        }
        port = outcome;
        const failed = isFailurePort(port);
        context.finishStep(runId, node.id, failed ? 'failed' : 'done', failed ? `ended on "${port}"` : undefined, emit);
      } else if (node.type === 'agent') {
        const stepIdx = workflow.steps.findIndex((s) => s.id === node.id);
        const rendered = nodeToStep(node);
        if (rendered.prompt) rendered.prompt = renderNodeRefs(rendered.prompt, outputs);
        const verdicts = node.verdicts ?? [];
        if (verdicts.length) rendered.prompt = `${rendered.prompt ?? '{{task}}'}\n\n${verdictInstruction(verdicts)}`;
        const backend = node.runner ?? taskBackend;
        const lastTurn = { text: '' };
        const failure = await context.runAgentStep(
          runId,
          state,
          rendered,
          input,
          skills,
          checkFailure,
          isTerminalAgent(graph, node.id),
          emit,
          startImages,
          taskBackend,
          extraSystemPrompt,
          stepIdx >= 0 ? chainStepNote(workflow.steps, stepIdx) : undefined,
          startAttachments,
          resuming && ctx.usageLimitResume?.id === node.id
            ? {
                ...(context.resumableBackends.has(backend) ? { resumeSessionId: ctx.usageLimitResume.sessionId } : {}),
                lastTurn,
                usageLimitResume: ctx.usageLimitResume,
              }
            : resuming
              ? resumeInterruptedAgent(context, runId, node, backend, rendered, lastTurn)
              : { resumeSessionId: graphResumeSession(context, runId, node, backend, emit), lastTurn },
        );
        startImages = undefined;
        startAttachments = [];
        checkFailure = null;
        if (state.cancelled) return null;
        if (state.askPark) {
          if (state.askPark === 'abandoned') context.finishStep(runId, node.id, 'done', undefined, emit);
          return null;
        }
        // Preserve the v1 safety bound on an ordinary terminal wait: session closure caused by
        // inactivity is not evidence that the task completed. The review-gate path remains a
        // needs-you state with its changes available to the user.
        if (await context.idleClosedFails(runId, state)) {
          const error = context.inactivityFailureMessage(runId, state);
          context.finishStep(runId, node.id, 'failed', error, emit);
          return error;
        }
        let verdict: string | null = null;
        if (!failure && verdicts.length) {
          verdict = parseVerdict(lastTurn.text, verdicts);
          // D14: one nudge on the node's own session, then `failed`.
          const own = context.store.getRun(runId)?.steps.find((s) => s.id === node.id)?.sessionId;
          if (!verdict && own && context.resumableBackends.has(backend) && !state.cancelled) {
            emit({ type: 'note', stepId: node.id, message: 'no verdict marker — asking the agent once more' });
            const nudge = await context.runAgentStep(
              runId,
              state,
              { ...rendered, prompt: `You did not end with a verdict. ${verdictInstruction(verdicts)}` },
              input,
              skills,
              null,
              false,
              emit,
              undefined,
              taskBackend,
              extraSystemPrompt,
              undefined,
              [],
              { resumeSessionId: own, lastTurn },
            );
            if (state.cancelled) return null;
            if (!nudge) verdict = parseVerdict(lastTurn.text, verdicts);
          }
        }
        const stepRec = context.store.getRun(runId)?.steps.find((s) => s.id === node.id);
        outputs.set(node.id, {
          summary: stripVerdictMarker(lastTurn.text.trim()).slice(-NODE_SUMMARY_CAP),
          verdict: verdict ?? '',
          costUsd: stepRec?.costUsd ?? 0,
        });
        if (failure) {
          context.finishStep(runId, node.id, 'failed', failure, emit);
          agentFailure = failure;
          port = 'failed';
        } else if (verdicts.length && !verdict) {
          const error = `no verdict — expected one of ${verdicts.map((v) => `ONNI:VERDICT ${v}`).join(', ')}`;
          context.finishStep(runId, node.id, 'failed', error, emit);
          agentFailure = error;
          port = 'failed';
        } else {
          context.finishStep(runId, node.id, 'done', undefined, emit);
          port = verdict ?? 'done';
          if (verdict) emit({ type: 'note', stepId: node.id, message: `verdict: ${verdict}` });
        }
      } else {
        const rendered = nodeToStep(node);
        if (rendered.command) rendered.command = renderNodeRefs(rendered.command, outputs);
        // Check commands are allowed to generate tracked output, but that output
        // is verification residue rather than agent work. Save the agent's state
        // before the command, then keep the command's changed paths excluded from
        // later autosaves while leaving those files dirty for inspection.
        const checkpoint =
          state.cwd === context.repoRoot
            ? 'nothing-to-do'
            : await autosaveCommit(
                state.cwd,
                'turn end',
                await context.currentCheckExclusions(state.cwd, state.autosaveExcludedPaths),
              );
        const checkpointSafe = checkpoint === 'committed' || checkpoint === 'nothing-to-do';
        state.autosaveCheckpointBlocked = !checkpointSafe;
        if (checkpointSafe) context.autosaveCheckpointBlockedRuns.delete(runId);
        else context.autosaveCheckpointBlockedRuns.add(runId);
        let checkResult: { ok: boolean; output: string; exitCode: number };
        state.checkInProgress = true;
        try {
          checkResult = await context.runCheckStep(runId, state, rendered, emit);
        } finally {
          if (checkpointSafe && state.cwd !== context.repoRoot) {
            await context.captureCheckArtifacts(state.cwd, state.autosaveExcludedPaths);
          }
          // Keep the periodic timer fenced until the ownership snapshot is complete;
          // captureCheckArtifacts yields while reading git status.
          state.checkInProgress = false;
        }
        const { ok, output, exitCode } = checkResult;
        if (state.cancelled) return null;
        outputs.set(node.id, { exitCode, output });
        if (ok) {
          context.finishStep(runId, node.id, 'done', undefined, emit);
          port = 'pass';
        } else {
          // The output goes into the next agent prompt — to the agent's model provider — so it is
          // scrubbed like an event is: host secrets, this run's registered secrets (project
          // secrets included) and token patterns. Strictly narrowing, for every workflow.
          checkFailure = context.store.redactRunText(runId, output);
          if (node.retryOn?.length && !node.retryOn.includes(exitCode)) {
            const codes = node.retryOn.join(', ');
            const error = `check "${node.id}" exited ${exitCode}, which onFail.retryOn (${codes}) does not retry`;
            emit({
              type: 'note',
              stepId: node.id,
              message: `check exited ${exitCode} — not retried (onFail.retryOn: ${codes})`,
            });
            context.finishStep(runId, node.id, 'failed', `\`${rendered.command}\` exited ${exitCode}`, emit);
            return error;
          }
          context.finishStep(runId, node.id, 'failed', `\`${rendered.command}\` exited non-zero`, emit);
          port = 'fail';
        }
      }

      step = advance(graph, leaveFrom, port, loopCounts);
      record(step.transitions);
      // Nodes about to run again go back to pending so the rail reads truthfully.
      if (step.kind === 'node') context.store.updateStep(runId, step.node.id, { status: 'pending' });
    }

    cursor = undefined;
    persistWalk();
    if (step.status === 'success') return null;
    if (step.endNode) return `workflow ended at "${step.endNode}"`;
    // An unwired failure port: say what failed, in the words the v1 loop always used.
    const last = step.transitions[step.transitions.length - 1];
    const from = graph.nodes.find((n) => n.id === last?.from);
    if (from?.type === 'agent') return `step "${from.id}" failed: ${agentFailure ?? 'failed'}`;
    if (from?.type === 'check') return `check "${from.id}" failed`;
    if (from?.type === 'loop') {
      const into = step.transitions.find((t) => t.to === from.id);
      const source = graph.nodes.find((n) => n.id === into?.from);
      return source?.type === 'check'
        ? `check "${source.id}" failed after ${from.max + 1} attempts`
        : `loop "${from.name ?? from.id}" exhausted after ${from.max} iterations`;
    }
    return `node "${last?.from ?? '?'}" ended on "${last?.port ?? '?'}" with nothing wired`;
  }

  /** What a session has cost so far: the steps that ran it. A resumed claude process reports the session's
   *  cumulative total, so its runner subtracts this to emit only new spend (Q1). */
export function sessionCostUsd(context: GraphContext, runId: string, sessionId: string): number {
    return (context.store.getRun(runId)?.steps ?? [])
      .filter((step) => step.sessionId === sessionId)
      .reduce((sum, step) => sum + (step.costUsd ?? 0), 0);
  }

  /**
   * Graph hooks for the agent node a restart interrupted: reopen its OWN session and tell it the
   * process restarted, when the backend can resume. Otherwise the node simply runs again.
   */
export function resumeInterruptedAgent(context: GraphContext,
    runId: string,
    node: Extract<GraphNode, { type: 'agent' }>,
    backend: RunnerId,
    rendered: WorkflowStepDef,
    lastTurn: { text: string },
  ): { resumeSessionId?: string; lastTurn: { text: string } } {
    const own = context.store.getRun(runId)?.steps.find((s) => s.id === node.id)?.sessionId;
    if (!own || !context.resumableBackends.has(backend)) return { lastTurn };
    rendered.prompt = RESTART_CONTINUATION_PROMPT;
    return { resumeSessionId: own, lastTurn };
  }

  /**
   * A fork: every branch agent becomes a child task at once (fresh session, own worktree forked
   * off this task's branch, budget carved from this run's), and the walk waits at the join. The
   * task's work is committed first — a child forks from the committed branch, so without it a
   * reviewer would read the code as it was BEFORE the agent that just ran. Resumed after a
   * restart (`resuming`), the fork waits for the children it already dispatched, never a second
   * set — but a loop coming back through it is a new round and dispatches afresh.
   */
export async function runFork(context: GraphContext,
    graph: WorkflowGraph,
    runId: string,
    state: GraphActiveRun,
    fork: Extract<GraphNode, { type: 'fork' }>,
    shape: ForkShape,
    outputs: Map<string, Record<string, string | number>>,
    task: string,
    emit: (event: { type: string; stepId?: string; [k: string]: unknown }) => void,
    onOutputs: () => void,
    resuming: boolean,
  ): Promise<{ port: 'done' | 'failed'; join: string; transitions: GraphTransition[] } | 'finished'> {
    const render = (text: string) => context.applyTemplate(renderNodeRefs(text, outputs), task);
    const note = (message: string, tone?: 'danger') =>
      emit({ type: 'note', stepId: fork.id, message, ...(tone ? { tone } : {}) });
    const byChild = new Map<string, (typeof shape.branches)[number]>();
    const earlier = resuming ? outputs.get(fork.id)?.runIds : undefined;
    // `earlier` may legitimately be '' (the only branch attempted so far was refused) — that
    // must still split to one placeholder entry, not be treated as "nothing dispatched yet".
    const earlierIds = typeof earlier === 'string' ? earlier.split(',') : [];
    if (earlierIds.length === shape.branches.length) {
      // One entry per branch, including empty-string placeholders for branches whose dispatch
      // was refused — this keeps the length check above meaningful even when a prior pass only
      // partially dispatched, so a resumed run never re-dispatches already-running branches.
      shape.branches.forEach((b, i) => {
        const id = earlierIds[i];
        if (id) byChild.set(id, b);
      });
      note(`still waiting for ${byChild.size} branches`);
    } else {
      await autosaveCommit(state.cwd, 'pre-dispatch');
      const reviewOf = context.store.getRun(runId)?.branch ?? runId;
      // Resume a partial dispatch (a restart between two branches) from where it left off —
      // `earlierIds` already holds one entry per branch dispatched before the crash, including
      // '' placeholders for refusals. Restore those as live children before continuing.
      const dispatchedIds: string[] = [...earlierIds];
      shape.branches.forEach((b, i) => {
        const id = earlierIds[i];
        if (id) byChild.set(id, b);
      });
      for (let i = earlierIds.length; i < shape.branches.length; i += 1) {
        const b = shape.branches[i]!;
        const a = b.agent;
        const spawned = context.dispatch(
          runId,
          {
            objective: render(a.prompt ?? '{{task}}').slice(0, 4_000),
            title: a.name ?? a.id,
            ...(a.runner ? { runner: a.runner } : {}),
            ...(a.model ? { model: a.model } : {}),
            ...(a.budgetUsd ? { max_cost: a.budgetUsd } : {}),
            ...(a.review ? { kind: 'review' as const, review_of: [reviewOf] } : {}),
          },
          {
            // The branch's own skill and tool limits ride on the child's single step.
            workflow: {
              name: '(fork branch)',
              source: 'built-in',
              steps: [
                {
                  id: 'task',
                  name: a.name ?? a.id,
                  prompt: '{{task}}',
                  ...(a.skill ? { skill: a.skill } : {}),
                  ...(a.allowedTools ? { allowedTools: a.allowedTools } : {}),
                  ...(a.bashAllowlist ? { bashAllowlist: a.bashAllowlist } : {}),
                },
              ],
            },
          },
        );
        if ('refused' in spawned) {
          note(`branch "${a.name ?? a.id}" refused — ${spawned.refused}`, 'danger');
          context.finishStep(runId, a.id, 'failed', spawned.refused, emit);
          outputs.set(a.id, { runId: '', status: 'refused', summary: spawned.refused });
          dispatchedIds.push('');
        } else {
          byChild.set(spawned.id, b);
          outputs.set(a.id, { runId: spawned.id, status: 'running', summary: '' });
          dispatchedIds.push(spawned.id);
        }
        // Persist after every branch, not just once at the end — a restart between two
        // dispatches must see the ones that already happened, or it re-dispatches them.
        outputs.set(fork.id, { runIds: dispatchedIds.join(',') });
        onOutputs();
      }
      if (byChild.size) {
        note(`forked ${byChild.size} agents (${shape.wait === 'any' ? 'first to succeed wins' : 'waiting for all'})`);
      }
    }
    for (const [childId, b] of byChild) {
      context.store.updateStep(runId, b.agent.id, { status: 'running', startedAt: new Date().toISOString(), error: undefined });
      emit({ type: 'step-start', stepId: b.agent.id, name: b.agent.name ?? b.agent.id, kind: 'agent', iteration: 1, childRunId: childId });
    }
    const ids = [...byChild.keys()];
    const waited = ids.length ? await context.awaitChildren(runId, state, fork.id, ids, shape.wait) : new Map<string, { status: string; summary: string }>();
    if (waited === 'finished') return 'finished';

    const transitions: GraphTransition[] = [];
    let succeeded = 0;
    for (const b of shape.branches) {
      transitions.push({ from: fork.id, port: b.port, to: b.agent.id });
      const childId = ids.find((id) => byChild.get(id) === b);
      const child = childId ? waited.get(childId) : undefined;
      if (!childId || !child) {
        // Refused at dispatch (already failed above), or cancelled because another won an `any`.
        if (childId) {
          outputs.set(b.agent.id, { runId: childId, status: 'cancelled', summary: '' });
          context.finishStep(runId, b.agent.id, 'failed', 'cancelled — another branch finished first', emit);
        }
        continue;
      }
      const ok = childSucceeded(child.status);
      if (ok) succeeded++;
      outputs.set(b.agent.id, { runId: childId, status: child.status, summary: child.summary.slice(-NODE_SUMMARY_CAP) });
      context.finishStep(runId, b.agent.id, ok ? 'done' : 'failed', ok ? undefined : `subtask ended ${child.status}`, emit);
      const port = ok ? 'done' : 'failed';
      // An unwired `failed` port is a branch that simply failed: the join still counts it.
      transitions.push({ from: b.agent.id, port, to: edgeFrom(graph, b.agent.id, port) ? shape.join : null });
    }
    const failedCount = shape.branches.length - succeeded;
    outputs.set(shape.join, { succeeded, failed: failedCount });
    onOutputs();
    const ok = shape.wait === 'any' ? succeeded > 0 : failedCount === 0;
    note(`join — ${succeeded}/${shape.branches.length} succeeded → ${ok ? 'done' : 'failed'}`, ok ? undefined : 'danger');
    return { port: ok ? 'done' : 'failed', join: shape.join, transitions };
  }

  /**
   * Run a node onni executes itself (phase 1c) and return the port it leaves by — or
   * `'finished'` when the user pressed Finish while it waited. Never throws: every failure is a
   * note on the rail plus the node's failure port.
   */
export async function runSystemNode(context: GraphContext,
    runId: string,
    state: GraphActiveRun,
    node: Exclude<ExecutableNode, { type: 'agent' | 'check' | 'fork' | 'join' }>,
    outputs: Map<string, Record<string, string | number>>,
    task: string,
    emit: (event: { type: string; stepId?: string; [k: string]: unknown }) => void,
    /** Persist `outputs` now (a node that waits records what a restart must not redo). */
    onOutputs: () => void = () => undefined,
    /** The walk is RESUMING at this node after a restart: a child it already dispatched is
     *  awaited, not sent again. False on every ordinary visit — a loop coming back through a
     *  dispatch is a new round, and its earlier child's result is not this round's. */
    resuming = false,
  ): Promise<string | 'finished'> {
    const render = (text: string) => context.applyTemplate(renderNodeRefs(text, outputs), task);
    const note = (message: string, tone?: 'danger') =>
      emit({ type: 'note', stepId: node.id, message, ...(tone ? { tone } : {}) });
    const record = () => context.store.getRun(runId);
    const prNumber = (): number | undefined => {
      const run = record();
      const ref = run?.prRefs?.find((r) => r.origin === 'created') ?? run?.prRefs?.[0];
      if (ref) return ref.number;
      const m = run?.pullRequestUrl ? /\/pull\/(\d+)/.exec(run.pullRequestUrl) : null;
      return m ? Number(m[1]) : undefined;
    };

    switch (node.type) {
      case 'gate.human': {
        const header = node.name ?? 'Approval';
        const outcome = await parkForUser(context, runId, state, node.id, [
          { header, question: render(node.message), options: [{ label: 'Approve' }, { label: 'Reject' }] },
        ], node.timeoutMs);
        if (outcome.kind !== 'answer') return outcome.kind === 'timeout' ? 'timeout' : 'finished';
        const reply = context.cardReply(outcome.text, header);
        const approved = /^\s*approve\b/i.test(reply);
        outputs.set(node.id, { comment: reply });
        return approved ? 'approve' : 'reject';
      }
      case 'ask-user': {
        const header = node.name ?? 'Question';
        const outcome = await parkForUser(context, runId, state, node.id, [
          {
            header,
            question: render(node.question),
            options: (node.options ?? []).map((label) => ({ label })),
          },
        ], node.timeoutMs);
        if (outcome.kind !== 'answer') return outcome.kind === 'timeout' ? 'timeout' : 'finished';
        outputs.set(node.id, { answer: context.cardReply(outcome.text, header) });
        return 'answered';
      }
      case 'dispatch': {
        // Resumed after a restart: wait for the child this node already dispatched, never a second.
        const earlier = resuming ? outputs.get(node.id)?.runId : undefined;
        const existing = typeof earlier === 'string' ? context.store.getRun(earlier) : undefined;
        const spawned = existing ? { id: existing.id } : context.dispatch(runId, {
          objective: render(node.prompt).slice(0, 4_000),
          ...(node.name ? { title: node.name } : {}),
          ...(node.runner ? { runner: node.runner } : {}),
          ...(node.model ? { model: node.model } : {}),
          ...(node.budgetUsd ? { max_cost: node.budgetUsd } : {}),
        });
        if ('refused' in spawned) {
          note(`dispatch refused — ${spawned.refused}`, 'danger');
          return 'failed';
        }
        if (existing) note(`still waiting for subtask ${spawned.id}`);
        else note(`dispatched subtask ${spawned.id}`);
        outputs.set(node.id, { runId: spawned.id });
        onOutputs();
        // It may even have settled while onni was down.
        const settledWhileDown = existing && isTerminalStatus(existing.status) ? existing.status : undefined;
        if (settledWhileDown) {
          outputs.set(node.id, { runId: spawned.id, status: settledWhileDown, summary: '' });
          return settledWhileDown === 'done' || settledWhileDown === 'review' ? 'done' : 'failed';
        }
        const waited = await context.awaitChildren(runId, state, node.id, [spawned.id], 'all');
        if (waited === 'finished') return 'finished';
        const child = waited.get(spawned.id);
        outputs.set(node.id, { runId: spawned.id, status: child?.status ?? '', summary: child?.summary ?? '' });
        return child && childSucceeded(child.status) ? 'done' : 'failed';
      }
      case 'git.commit': {
        const res = await commitAll(state.cwd, render(node.message));
        if (res.result === 'committed') {
          outputs.set(node.id, { sha: res.sha });
          note(`committed ${res.sha.slice(0, 8)}`);
          return 'done';
        }
        if (res.result === 'nothing') {
          note('nothing to commit');
          return 'nothing';
        }
        note(res.error, 'danger');
        return 'failed';
      }
      case 'github.draft-pr': {
        const run = record();
        if (!run) return 'failed';
        // One PR per task: a PR this run already opened (a resumed walk, or a loop back through
        // this node) is reported, never opened twice.
        if (run.pullRequestUrl) {
          const n = /\/pull\/(\d+)/.exec(run.pullRequestUrl)?.[1];
          outputs.set(node.id, { url: run.pullRequestUrl, number: n ? Number(n) : '' });
          note(`draft PR already open: ${run.pullRequestUrl}`);
          return 'created';
        }
        const title = node.title ? render(node.title) : undefined;
        const outcome = await createDraftPr({
          repoRoot: context.repoRoot,
          run: title ? { ...run, title } : run,
          handoffText: readHandoff(context.dataDir, runId),
        });
        if (!outcome.ok) {
          note(`draft PR failed — ${outcome.error}`, 'danger');
          return 'failed';
        }
        context.store.updateRun(runId, { pullRequestUrl: outcome.url });
        const number = /\/pull\/(\d+)/.exec(outcome.url)?.[1];
        if (number) context.store.recordPrRef(runId, { number: Number(number), url: outcome.url, origin: 'created' });
        outputs.set(node.id, { url: outcome.url, number: number ? Number(number) : '' });
        note(`draft PR opened: ${outcome.url}`);
        return 'created';
      }
      case 'github.pr-comment': {
        const number = prNumber();
        if (number === undefined) {
          note('no PR on this task to comment on', 'danger');
          return 'failed';
        }
        const res = await commentOnPr(context.repoRoot, number, render(node.body));
        if (!res.ok) {
          note(`PR comment failed — ${res.error}`, 'danger');
          return 'failed';
        }
        note(`commented on PR #${number}`);
        return 'done';
      }
      case 'workflow': {
        const earlier = resuming ? outputs.get(node.id)?.runId : undefined;
        const existing = typeof earlier === 'string' ? context.store.getRun(earlier) : undefined;
        let childId = existing?.id;
        if (!childId) {
          const def = await context.findWorkflow(node.workflow);
          if (!def) {
            note(`no workflow named "${node.workflow}"`, 'danger');
            return 'failed';
          }
          const spawned = context.dispatch(
            runId,
            {
              objective: render(node.prompt ?? '{{task}}').slice(0, 4_000),
              title: `${node.name ?? node.workflow}`,
              ...(node.runner ? { runner: node.runner } : {}),
              ...(node.budgetUsd ? { max_cost: node.budgetUsd } : {}),
            },
            { workflow: def },
          );
          if ('refused' in spawned) {
            note(`sub-workflow refused — ${spawned.refused}`, 'danger');
            return 'failed';
          }
          childId = spawned.id;
          note(`started sub-workflow "${node.workflow}" as ${childId}`);
          outputs.set(node.id, { runId: childId });
          onOutputs();
        }
        const waited = await context.awaitChildren(runId, state, node.id, [childId], 'all');
        if (waited === 'finished') return 'finished';
        const child = waited.get(childId);
        outputs.set(node.id, { runId: childId, status: child?.status ?? '', summary: child?.summary ?? '' });
        return child && childSucceeded(child.status) ? 'done' : 'failed';
      }
      case 'if': {
        const { result, value } = await evaluateCondition(context, runId, state, node.condition, outputs);
        outputs.set(node.id, { result: result ? 'true' : 'false', value });
        note(`if — ${describeCondition(node.condition)}: ${value} → ${result}`);
        return result ? 'true' : 'false';
      }
      case 'git.push': {
        const run = record();
        if (!run?.branch) {
          note('this task has no branch of its own to push (it runs in the repository working tree)', 'danger');
          return 'failed';
        }
        const refusal = pushRefusal(run.branch, [run.baseBranch]);
        if (refusal) {
          note(refusal, 'danger');
          return 'failed';
        }
        await autosaveCommit(state.cwd, 'pre-PR');
        const res = await pushBranch(state.cwd, run.branch);
        if (!res.ok) {
          note(`push failed — ${res.error}`, 'danger');
          return 'failed';
        }
        note(`pushed ${run.branch}`);
        return 'done';
      }
      case 'git.sync-base': {
        const base = record()?.baseBranch;
        if (!base) {
          note('no base branch recorded for this task', 'danger');
          return 'failed';
        }
        await autosaveCommit(state.cwd, 'pre-PR');
        const res = await syncWithBase(state.cwd, base);
        if (res.result === 'done') {
          note(`merged the latest ${base}`);
          return 'done';
        }
        if (res.result === 'conflict') {
          outputs.set(node.id, { conflicts: res.files.join('\n') });
          note(`merge conflict with ${base} in ${res.files.length} file(s) — left in progress for the next step`, 'danger');
          return 'conflict';
        }
        note(`sync failed — ${res.error}`, 'danger');
        return 'failed';
      }
      case 'github.pr-update': {
        const number = prNumber();
        if (number === undefined) {
          note('no PR on this task to update', 'danger');
          return 'failed';
        }
        const res = await updatePr(context.repoRoot, number, {
          ...(node.ready ? { ready: true } : {}),
          ...(node.addLabels?.length ? { addLabels: node.addLabels } : {}),
          ...(node.reviewers?.length ? { reviewers: node.reviewers } : {}),
        });
        if (!res.ok) {
          note(`PR update failed — ${res.error}`, 'danger');
          return 'failed';
        }
        note(`updated PR #${number}`);
        return 'done';
      }
      case 'github.issue-comment': {
        const run = record();
        const fromUrl = run?.referencedIssueUrl ? /\/issues\/(\d+)/.exec(run.referencedIssueUrl)?.[1] : undefined;
        const issue = node.issue ?? run?.markerRefs?.issue ?? (fromUrl ? Number(fromUrl) : undefined);
        if (issue === undefined) {
          note('no issue on this task to comment on (set one on the node)', 'danger');
          return 'failed';
        }
        const res = await commentOnIssue(context.repoRoot, issue, render(node.body));
        if (!res.ok) {
          note(`issue comment failed — ${res.error}`, 'danger');
          return 'failed';
        }
        outputs.set(node.id, { issue });
        note(`commented on issue #${issue}`);
        return 'done';
      }
      case 'notify.webhook': {
        // A network call to an arbitrary URL widens exposure, so it is opt-in (AGENTS.md § Zero
        // config): with the flag off the node refuses loudly instead of calling out.
        if (process.env.ONNI_WORKFLOW_WEBHOOKS !== '1') {
          note('webhooks are off — set ONNI_WORKFLOW_WEBHOOKS=1 to let workflows POST to URLs', 'danger');
          return 'failed';
        }
        if (process.env.ONNI_DRY_RUN === '1') {
          outputs.set(node.id, { status: 200 });
          note(`dry run — webhook to ${node.url} not sent`);
          return 'done';
        }
        const run = record();
        try {
          const res = await fetch(node.url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              text: render(node.body ?? 'onni: {{task}}'),
              run: { id: runId, title: run?.title, status: run?.status, pullRequestUrl: run?.pullRequestUrl },
              node: node.id,
            }),
            signal: AbortSignal.timeout(15_000),
          });
          outputs.set(node.id, { status: res.status });
          if (!res.ok) {
            note(`webhook answered ${res.status}`, 'danger');
            return 'failed';
          }
          note(`webhook sent (${res.status})`);
          return 'done';
        } catch (err) {
          note(`webhook failed — ${err instanceof Error ? err.message : String(err)}`, 'danger');
          return 'failed';
        }
      }
      case 'github.wait-ci': {
        const number = prNumber();
        if (number === undefined) {
          // Not `red`: red is CI that ran and failed, which a graph answers with a fixer. A task
          // with no PR has nothing to fix, and looping an agent on it only burns rounds.
          note('no PR on this task — nothing to wait for', 'danger');
          outputs.set(node.id, { status: 'no-pr' });
          return 'failed';
        }
        if (process.env.ONNI_DRY_RUN === '1') {
          note(`dry run — CI on PR #${number} reported green`);
          outputs.set(node.id, { status: 'passing' });
          return 'green';
        }
        note(`waiting for CI on PR #${number} (up to ${Math.round(node.timeoutMs / 60_000)} min)`);
        let glyph = 'pending';
        const outcome = await parkGraphNode(context, runId, state, node.id, { activity: 'monitoring', timeoutMs: node.timeoutMs }, (resolve) => {
          let stopped = false;
          const poll = async () => {
            if (stopped) return;
            const data = await fetchGithubChecks(context.repoRoot, [number]);
            // Unavailable (offline, gh logged out) is not a verdict: keep polling until the timeout.
            const g = data.available ? data.checks[number] : null;
            if (g === 'passing' || g === 'failing') {
              glyph = g;
              resolve({ kind: 'answer', text: g });
              return;
            }
            if (!stopped) timer = setTimeout(() => void poll(), node.pollMs);
          };
          let timer: NodeJS.Timeout | undefined = setTimeout(() => void poll(), 0);
          return () => {
            stopped = true;
            if (timer) clearTimeout(timer);
          };
        });
        if (outcome.kind === 'finished') return 'finished';
        outputs.set(node.id, { status: outcome.kind === 'timeout' ? 'timeout' : glyph });
        if (outcome.kind === 'timeout') return 'timeout';
        return glyph === 'passing' ? 'green' : 'red';
      }
    }
  }

  /**
   * Park until the given child runs settle — every one (`all`), or the first that succeeds
   * (`any`, which then cancels the rest: their work is no longer wanted, their budget is). A
   * child that already settled (a resumed walk) counts at once. Returns each settled child's
   * status + report, or `'finished'` when the user pressed Finish.
   */
export async function awaitChildren(context: GraphContext,
    runId: string,
    state: GraphActiveRun,
    nodeId: string,
    childIds: string[],
    mode: 'all' | 'any',
  ): Promise<Map<string, { status: string; summary: string }> | 'finished'> {
    const settled = new Map<string, { status: string; summary: string }>();
    for (const id of childIds) {
      const rec = context.store.getRun(id);
      if (!rec) {
        settled.set(id, { status: 'failed', summary: '' });
        continue;
      }
      if (isTerminalStatus(rec.status)) {
        // The child may have settled before this wait was registered (e.g. across a restart) and
        // so never reached `reportSettledChildToParent`'s waiter hand-off — rebuild the same report
        // text here rather than losing it to an empty summary.
        const resumeNotes = handoffSectionExcerpt(readHandoff(context.dataDir, id), '## Resume notes');
        const { text } = childSettleReport(rec, { resumeNotes });
        settled.set(id, { status: rec.status, summary: text });
      }
    }
    const done = () =>
      mode === 'any'
        ? [...settled.values()].some((c) => childSucceeded(c.status)) || settled.size === childIds.length
        : settled.size === childIds.length;
    if (!done()) {
      const outcome = await parkGraphNode(context, runId, state, nodeId, { activity: 'monitoring' }, (resolve) => {
        const waits = (state.graphChildWaits ??= new Map<string, (child: { status: string; summary: string }) => void>());
        for (const id of childIds) {
          if (settled.has(id)) continue;
          waits.set(id, (c: { status: string; summary: string }) => {
            settled.set(id, c);
            waits.delete(id);
            if (done()) resolve({ kind: 'answer', text: 'settled' });
          });
        }
        return () => {
          for (const id of childIds) state.graphChildWaits?.delete(id);
        };
      });
      if (outcome.kind === 'finished') return 'finished';
      if (outcome.kind === 'cancelled') return settled;
    }
    if (mode === 'any') {
      for (const id of childIds) if (!settled.has(id)) context.cancel(id);
    }
    return settled;
  }

  /** A catalog workflow by name (the repo's files, then built-ins) — for sub-workflow nodes. */
export async function findWorkflow(context: GraphContext, name: string): Promise<WorkflowDef | undefined> {
    const { workflows } = await loadWorkflows(context.repoRoot);
    return workflows.find((w) => w.name === name);
  }

  /** Evaluate an `if` node against this run: its diff (the #751 anchor), its outputs, its base. */
export async function evaluateCondition(context: GraphContext,
    runId: string,
    state: GraphActiveRun,
    condition: Condition,
    outputs: ReadonlyMap<string, Record<string, string | number>>,
  ): Promise<{ result: boolean; value: string | number }> {
    const run = context.store.getRun(runId);
    const base = run?.baseBranch ?? 'HEAD';
    const anchor = { taskBranch: run?.branch, runStartedAt: run?.startedAt };
    switch (condition.kind) {
      case 'diff-lines':
      case 'diff-files': {
        const stat = await worktreeShortstat(state.cwd, base, anchor);
        const value = stat ? (condition.kind === 'diff-lines' ? stat.adds + stat.dels : stat.files) : 0;
        return { result: compareValues(value, condition.op, condition.value), value };
      }
      case 'paths-changed': {
        const files = (await worktreeChangedFiles(state.cwd, base, anchor)) ?? [];
        const hits = files.filter((f) => globMatch(condition.glob, f));
        return { result: hits.length > 0, value: hits.length ? hits.slice(0, 5).join(', ') : 'no match' };
      }
      case 'output': {
        const [nodeRef, field] = condition.ref.split('.') as [string, string];
        const value = outputs.get(nodeRef)?.[field] ?? '';
        return { result: compareValues(value, condition.op, condition.value), value };
      }
      case 'branch': {
        const branch = run?.baseBranch ?? '';
        const result = condition.op === 'equals' ? branch === condition.value : globMatch(condition.value, branch);
        return { result, value: branch || '(none)' };
      }
    }
  }

  /** Ask the user through an ask card and park until they answer (see `parkGraphNode`). */
export function parkForUser(context: GraphContext,
    runId: string,
    state: GraphActiveRun,
    nodeId: string,
    questions: { header: string; question: string; options: { label: string }[] }[],
    timeoutMs?: number,
  ): Promise<GraphParkOutcome> {
    const requestId = randomUUID();
    context.makeUiSink(runId, nodeId).handle({ type: 'ask.requested', requestId, questions, source: 'workflow' });
    const attentionRequest = context.recordAttention(requestId, questions);
    return parkGraphNode(context, runId, state, nodeId, { askParked: true, attentionRequest, timeoutMs }, (resolve) => {
      state.graphAnswer = (text) => resolve({ kind: 'answer', text });
      return () => {
        state.graphAnswer = undefined;
      };
    });
  }

  /**
   * Hold a graph node with NO agent session until `arm` resolves it, the optional timeout fires,
   * the user presses Finish, or the run is cancelled. While it waits the run gives its
   * `maxParallel` slot back (the `acquireRepoRoot` pattern). Exits, all on by default:
   * `arm`'s own event, cancel (`state.interrupt`), Finish (`state.graphFinish`), the timeout,
   * and a restart — `recover()` settles an `askParked` waiting run as `failed` + Continue and an
   * interrupted running one like any interrupted run.
   */
export async function parkGraphNode(context: GraphContext,
    runId: string,
    state: GraphActiveRun,
    nodeId: string,
    opts: { askParked?: boolean; attentionRequest?: WebhookAttentionRequest; activity?: 'monitoring'; timeoutMs?: number },
    arm: (resolve: (o: GraphParkOutcome) => void) => () => void,
  ): Promise<GraphParkOutcome> {
    if (state.cancelled) return { kind: 'cancelled' };
    context.store.updateRun(runId, opts.askParked
      ? { status: 'waiting', askParked: true, attentionRequest: opts.attentionRequest }
      : { status: 'running', activity: opts.activity });
    context.store.updateStep(runId, nodeId, { status: 'waiting' });
    context.waiting.add(runId);
    context.releaseSlot();
    // An in-place dispatch run hands the working tree back while it waits, as an agent park does.
    context.parkRepoRoot(runId, state);
    const previousInterrupt = state.interrupt;
    let disarm: () => void = () => undefined;
    let timer: NodeJS.Timeout | undefined;
    let outcome: GraphParkOutcome;
    try {
      outcome = await new Promise<GraphParkOutcome>((resolve) => {
        let settled = false;
        const once = (o: GraphParkOutcome) => {
          if (settled) return;
          settled = true;
          resolve(o);
        };
        state.interrupt = () => {
          previousInterrupt();
          once({ kind: 'cancelled' });
        };
        state.graphFinish = () => once({ kind: 'finished' });
        if (opts.timeoutMs) {
          timer = setTimeout(() => once({ kind: 'timeout' }), opts.timeoutMs);
          timer.unref?.();
        }
        disarm = arm(once);
      });
    } finally {
      disarm();
      if (timer) clearTimeout(timer);
      state.interrupt = previousInterrupt;
      state.graphFinish = undefined;
      context.waiting.delete(runId);
      if (!state.cancelled && context.active.get(runId) === state) {
        context.store.updateRun(runId, { status: 'running', askParked: undefined, activity: undefined });
        context.store.updateStep(runId, nodeId, { status: 'running' });
      }
    }
    // Take the working tree back before the graph goes on (the `deliverMessage` twin).
    if (outcome.kind !== 'cancelled' && state.repoRootParked && !(state.repoRootResume === undefined && context.claimFreeRepoRoot(state))) {
      const acquired = await (state.repoRootResume ??= context.resumeRepoRoot(runId, state));
      if (!acquired) return { kind: 'cancelled' };
    }
    return outcome;
  }

  /**
   * The session an agent node reopens for `session: continue <node>` (D6), or undefined for a
   * fresh one. Degrades to fresh — with a note, never an error — when the target has no session
   * yet on this path, ran on another backend, or its backend cannot resume.
   */
export function graphResumeSession(context: GraphContext,
    runId: string,
    node: Extract<GraphNode, { type: 'agent' }>,
    backend: RunnerId,
    emit: (event: { type: string; stepId?: string; [k: string]: unknown }) => void,
  ): string | undefined {
    const target = node.session?.continue;
    if (!target) return undefined;
    const rec = context.store.getRun(runId)?.steps.find((s) => s.id === target);
    let why: string | undefined;
    if (!rec?.sessionId) why = `"${target}" has no session yet`;
    else if ((rec.backend ?? backend) !== backend) why = `"${target}" ran on ${rec.backend}, this node on ${backend}`;
    else if (!context.resumableBackends.has(backend)) why = `${backend} cannot resume a session`;
    if (why) {
      emit({ type: 'note', stepId: node.id, message: `session.continue: starting fresh — ${why}` });
      return undefined;
    }
    return rec!.sessionId;
  }

  /**
   * Install the named skills and every companion they name into the run's cwd (skills-provision.ts).
   * Once a named skill is known, waits (bounded) for the team-skill load before collecting companions.
   * Refreshes `state.skills` so expansion sees the same catalog. Never throws.
   */
export async function provisionTaskSkills(context: GraphContext,
    state: GraphActiveRun,
    wantedSkills: { stepSkill?: string; slash?: string },
  ): Promise<string[]> {
    const stepSkill = wantedSkills.stepSkill?.trim() || undefined;
    const wanted = [stepSkill, wantedSkills.slash].filter((name): name is string => Boolean(name));
    if (!wanted.length) return [];
    try {
      // Companions resolve against the ungated team list too: curating a skill out of the
      // picker must not break a skill that runs it.
      const catalogOf = (skills: readonly Skill[]): Skill[] => {
        const catalog = [...skills];
        const seen = new Set(catalog.map((s) => s.name));
        for (const skill of getTeamSkillsCached(context.repoRoot)) if (!seen.has(skill.name)) catalog.push(skill);
        return catalog;
      };
      const rootsIn = (catalog: readonly Skill[]) => wanted.flatMap((name) => catalog.filter((s) => s.name === name));
      state.skills = await discoverSkills(context.repoRoot);
      let catalog = catalogOf(state.skills);
      let roots = rootsIn(catalog);
      // An unknown `/name` is most likely a backend's own command (`/compact`): never stall it.
      // A selected step skill may still arrive with the team load, so that one waits.
      if (!roots.length && !stepSkill) return [];
      const inPlace = resolvePath(state.cwd) === resolvePath(context.repoRoot);
      if (!inPlace || !roots.length) {
        // A companion (or the step skill itself) often lives only in the team repo: wait, bounded.
        let timer: NodeJS.Timeout | undefined;
        await Promise.race([
          waitForTeamSkills(context.repoRoot).catch(() => []),
          new Promise((resolve) => {
            timer = setTimeout(resolve, TEAM_SKILLS_WAIT_MS);
            timer.unref?.();
          }),
        ]);
        clearTimeout(timer);
        state.skills = await discoverSkills(context.repoRoot);
        catalog = catalogOf(state.skills);
        roots = rootsIn(catalog);
      }
      // Only a selected step skill can be missing: a leading `/name` that is no skill is a
      // backend's own command (`/compact`), not a miss.
      let installed: string[];
      if (inPlace) {
        // In place, the cwd is the user's checkout: its skill dirs are what `discoverSkills` reads
        // first, so a written-out copy would shadow the real skill for good. Keep the pre-provision
        // behavior there — only the selected team skill, refreshed on every run.
        installed = [];
        for (const skill of roots) {
          if (skill.source !== 'team' || !skill.team?.dir) continue;
          if (await materializeSkillDir(state.cwd, skill).catch(() => false)) installed.push(skill.name);
        }
      } else {
        installed = await provisionSkills(state.cwd, roots, catalog);
      }
      return installed;
    } catch {
      return [];
    }
  }
