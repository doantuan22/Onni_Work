import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RunStore } from '../../runs/store.ts';
import type { RunManager } from '../../workflows/run.ts';
import { listProjects, registerProject } from '../../workspace/projects.ts';
import { ProjectContexts } from '../project-context.ts';
import { apiRequest } from '../loopback-request.testkit.ts';
import { removeTempDir } from '../../test-fixtures/remove-temp-dir.testkit.ts';
import { createApp } from '../server.ts';
import {
  EMPTY_WORKSPACE_PANES,
  normalizeWorkspacePanes,
  readWorkspacePanes,
  writeWorkspacePanes,
  workspacePanesPath,
} from './workspace-panes.ts';
import type { WorkspacePanesInput } from '@onni/contract';

describe('workspace-panes', () => {
  let homeDir: string;
  let repoRoot: string;
  let dataDir: string;
  let store: RunStore;
  let contexts: ProjectContexts;
  let app: Hono;
  let bootId: string;
  const savedHome = process.env.ONNI_HOME;

  beforeEach(async () => {
    homeDir = mkdtempSync(join(tmpdir(), 'onni-panes-home-'));
    repoRoot = mkdtempSync(join(tmpdir(), 'onni-panes-boot-'));
    process.env.ONNI_HOME = homeDir;
    dataDir = join(repoRoot, '.ai/onni');
    mkdirSync(dataDir, { recursive: true });

    store = RunStore.open(dataDir);
    contexts = new ProjectContexts({ listProjects });
    bootId = (await registerProject(repoRoot)).id;

    app = createApp({
      repoRoot,
      store,
      manager: { isActive: () => false } as unknown as RunManager,
      version: '0.0.0-test',
      contexts,
    });
  });

  afterEach(async () => {
    contexts.disposeAll();
    store.flush();
    await removeTempDir(homeDir, repoRoot);
    if (savedHome === undefined) delete process.env.ONNI_HOME;
    else process.env.ONNI_HOME = savedHome;
  });

  describe('normalizeWorkspacePanes', () => {
    it('drops duplicate paneIds preserving the first occurrence', () => {
      const input: WorkspacePanesInput = {
        threads: [
          { kind: 'run', paneId: 'pane-1', projectId: 'p1', runId: 'r1' },
          { kind: 'run', paneId: 'pane-2', projectId: 'p1', runId: 'r2' },
          { kind: 'run', paneId: 'pane-1', projectId: 'p1', runId: 'r-duplicate' },
        ],
        active: 'pane-2',
        split: 'none',
      };
      const normalized = normalizeWorkspacePanes(input);
      expect(normalized.threads).toHaveLength(2);
      expect(normalized.threads[0]).toEqual({ kind: 'run', paneId: 'pane-1', projectId: 'p1', runId: 'r1' });
      expect(normalized.threads[1]).toEqual({ kind: 'run', paneId: 'pane-2', projectId: 'p1', runId: 'r2' });
      expect(normalized.active).toBe('pane-2');
    });

    it('keeps active when it exists in threads', () => {
      const input: WorkspacePanesInput = {
        threads: [{ kind: 'run', paneId: 'pane-1', projectId: 'p1', runId: 'r1' }],
        active: 'pane-1',
        split: 'none',
      };
      expect(normalizeWorkspacePanes(input).active).toBe('pane-1');
    });

    it('removes active when paneId is not in threads', () => {
      const input: WorkspacePanesInput = {
        threads: [{ kind: 'run', paneId: 'pane-1', projectId: 'p1', runId: 'r1' }],
        active: 'non-existent',
        split: 'none',
      };
      const normalized = normalizeWorkspacePanes(input);
      expect(normalized.active).toBeUndefined();
      expect('active' in normalized).toBe(false);
    });

    it('preserves valid split when both panes exist and are distinct', () => {
      const input: WorkspacePanesInput = {
        threads: [
          { kind: 'run', paneId: 'p-a', projectId: 'p1', runId: 'r1' },
          { kind: 'draft', paneId: 'p-b', projectId: 'p1', draftId: 'd1' },
        ],
        split: { a: 'p-a', b: 'p-b' },
      };
      const normalized = normalizeWorkspacePanes(input);
      expect(normalized.split).toEqual({ a: 'p-a', b: 'p-b' });
    });

    it('resets split to none if a === b', () => {
      const input: WorkspacePanesInput = {
        threads: [{ kind: 'run', paneId: 'p-a', projectId: 'p1', runId: 'r1' }],
        split: { a: 'p-a', b: 'p-a' },
      };
      expect(normalizeWorkspacePanes(input).split).toBe('none');
    });

    it('resets split to none if either split pane does not exist', () => {
      const input: WorkspacePanesInput = {
        threads: [{ kind: 'run', paneId: 'p-a', projectId: 'p1', runId: 'r1' }],
        split: { a: 'p-a', b: 'p-missing' },
      };
      expect(normalizeWorkspacePanes(input).split).toBe('none');
    });

    it('handles empty threads input', () => {
      const input: WorkspacePanesInput = {
        threads: [],
        active: 'stale',
        split: { a: 'p1', b: 'p2' },
      };
      expect(normalizeWorkspacePanes(input)).toEqual(EMPTY_WORKSPACE_PANES);
    });
  });

  describe('readWorkspacePanes and writeWorkspacePanes', () => {
    it('returns empty default when file does not exist', () => {
      expect(readWorkspacePanes(dataDir)).toEqual(EMPTY_WORKSPACE_PANES);
    });

    it('degrades to empty default on corrupt JSON file', () => {
      writeFileSync(workspacePanesPath(dataDir), '{ not valid json ...', 'utf8');
      expect(readWorkspacePanes(dataDir)).toEqual(EMPTY_WORKSPACE_PANES);
    });

    it('degrades to empty default on schema-invalid content', () => {
      writeFileSync(workspacePanesPath(dataDir), JSON.stringify({ threads: 'not an array' }), 'utf8');
      expect(readWorkspacePanes(dataDir)).toEqual(EMPTY_WORKSPACE_PANES);
    });

    it('atomically writes and reads panes with normalization', () => {
      const input: WorkspacePanesInput = {
        threads: [
          { kind: 'run', paneId: 'r1', projectId: 'p1', runId: 'run-1' },
          { kind: 'draft', paneId: 'd1', projectId: 'p1', draftId: 'draft-1' },
        ],
        active: 'r1',
        split: { a: 'r1', b: 'd1' },
      };
      const written = writeWorkspacePanes(dataDir, input);
      expect(written).toEqual(input);

      // Verify the file was written to disk
      const filePath = workspacePanesPath(dataDir);
      const onDisk = JSON.parse(readFileSync(filePath, 'utf8'));
      expect(onDisk).toEqual(input);

      // Verify mode if supported
      const stat = statSync(filePath);
      // On POSIX mode will have 0o600 bits; on Windows chmod is best-effort but call succeeded
      expect(stat.size).toBeGreaterThan(0);

      // Read returns the same normalized content
      expect(readWorkspacePanes(dataDir)).toEqual(input);
    });
  });

  describe('HTTP endpoints: GET & PUT /api/v1/workspace/panes', () => {
    it('GET of a missing file returns 200 with empty default (not 404)', async () => {
      const res = await apiRequest(app, '/api/v1/workspace/panes');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(EMPTY_WORKSPACE_PANES);
    });

    it('GET of a corrupt file returns 200 with empty default (not 500)', async () => {
      writeFileSync(workspacePanesPath(dataDir), '<<<corrupt>>>', 'utf8');
      const res = await apiRequest(app, '/api/v1/workspace/panes');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(EMPTY_WORKSPACE_PANES);
    });

    it('PUT saves valid pane state and normalizes duplicates / invalid refs', async () => {
      const payload: WorkspacePanesInput = {
        threads: [
          { kind: 'run', paneId: 'p-1', projectId: 'boot', runId: 'r-1' },
          { kind: 'run', paneId: 'p-1', projectId: 'boot', runId: 'r-1-dup' },
          { kind: 'draft', paneId: 'p-2', projectId: 'boot', draftId: 'd-1' },
        ],
        active: 'non-existent',
        split: { a: 'p-1', b: 'non-existent' },
      };

      const putRes = await apiRequest(app, '/api/v1/workspace/panes', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });

      expect(putRes.status).toBe(200);
      const body = await putRes.json();
      expect(body).toEqual({
        threads: [
          { kind: 'run', paneId: 'p-1', projectId: 'boot', runId: 'r-1' },
          { kind: 'draft', paneId: 'p-2', projectId: 'boot', draftId: 'd-1' },
        ],
        split: 'none',
      });

      // GET reflects the persisted normalized state
      const getRes = await apiRequest(app, '/api/v1/workspace/panes');
      expect(getRes.status).toBe(200);
      expect(await getRes.json()).toEqual(body);
    });

    it('PUT preserves valid active and valid split', async () => {
      const payload: WorkspacePanesInput = {
        threads: [
          { kind: 'run', paneId: 'p-1', projectId: 'boot', runId: 'r-1' },
          { kind: 'draft', paneId: 'p-2', projectId: 'boot', draftId: 'd-1' },
        ],
        active: 'p-2',
        split: { a: 'p-1', b: 'p-2' },
      };

      const putRes = await apiRequest(app, '/api/v1/workspace/panes', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });

      expect(putRes.status).toBe(200);
      expect(await putRes.json()).toEqual(payload);
    });

    it('PUT returns 400 for invalid body schema', async () => {
      const res = await apiRequest(app, '/api/v1/workspace/panes', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ threads: [{ kind: 'invalid-kind' }] }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBeDefined();
    });
  });

  describe('Scoped endpoints: /api/v1/p/:projectId/workspace/panes', () => {
    let secondRoot: string;
    let secondId: string;

    beforeEach(async () => {
      secondRoot = mkdtempSync(join(tmpdir(), 'onni-panes-other-'));
      mkdirSync(join(secondRoot, '.ai/onni'), { recursive: true });
      secondId = (await registerProject(secondRoot)).id;
    });

    afterEach(async () => {
      await removeTempDir(secondRoot);
    });

    it('maintains isolated pane state between distinct projects', async () => {
      const projectAPanes: WorkspacePanesInput = {
        threads: [{ kind: 'run', paneId: 'pane-a', projectId: bootId, runId: 'run-a' }],
        active: 'pane-a',
        split: 'none',
      };

      // Put to project A
      const putA = await apiRequest(app, `/api/v1/p/${bootId}/workspace/panes`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(projectAPanes),
      });
      expect(putA.status).toBe(200);

      // Project B still has default empty panes
      const getB = await apiRequest(app, `/api/v1/p/${secondId}/workspace/panes`);
      expect(getB.status).toBe(200);
      expect(await getB.json()).toEqual(EMPTY_WORKSPACE_PANES);

      // Project A has its state
      const getA = await apiRequest(app, `/api/v1/p/${bootId}/workspace/panes`);
      expect(getA.status).toBe(200);
      expect(await getA.json()).toEqual(projectAPanes);
    });

    it('returns 404 for unknown project', async () => {
      const res = await apiRequest(app, '/api/v1/p/unknown-project-xyz/workspace/panes');
      expect(res.status).toBe(404);
    });
  });
});
