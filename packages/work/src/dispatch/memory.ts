/**
 * Project memory (plan v2 §8): lessons a manager leaves for later tasks in this repository, in
 * `<dataDir>/manager-memory.md`. One ceiling — `MANAGER_MEMORY_MAX_BYTES` — for BOTH writing and
 * the prompt, so nothing can be written that the prompt would later have to drop. A file edited
 * by hand past the ceiling is read from its newest lines only; that is a defence, not a policy.
 */
import { Buffer } from 'node:buffer';
import { join } from 'node:path';
import { MANAGER_MEMORY_MAX_BYTES, type ManagerMemoryPut, type ManagerMemoryRead } from '@onni/contract';
import { readStateFile, revisionOf, withPathLock, writeAtomic } from './state-file.ts';

export function managerMemoryPath(dataDir: string): string {
  return join(dataDir, 'manager-memory.md');
}

/** UTF-8 bytes, never `length`: a Vietnamese lesson costs more bytes than characters. */
export function memoryBytes(content: string): number {
  return Buffer.byteLength(content, 'utf8');
}

export function memoryReadOf(content: string): ManagerMemoryRead {
  return { content, bytes: memoryBytes(content), maxBytes: MANAGER_MEMORY_MAX_BYTES, revision: revisionOf(content) };
}

/**
 * Memory is where untrusted text (a worker's output, a pasted log) can ride into every later
 * prompt, so an entry is flattened to one line, stripped of markdown markers it could use to
 * pose as the brief's own headings, and redacted. Markers are only stripped when they stand as
 * markers (`# `, `- `, `> `, a fence) — `#123 is broken` keeps its issue reference.
 */
export function sanitizeMemoryEntry(raw: string, redact: (text: string) => string = (text) => text): string {
  const unmarked = raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^(?:\s*(?:(?:#{1,6}|[-*+]|>)(?=\s|$)|`{3,}\S*)\s*)+/, ''))
    .join(' ');
  const flattened = unmarked.replace(/[\u0000-\u001f\u007f]+/g, ' ');
  return redact(flattened).replace(/\s+/g, ' ').trim();
}

/** `- <lesson> (task <id8>, <YYYY-MM-DD>)` — the provenance Settings shows and a manager can cite. */
export function memoryEntryLine(entry: string, runId: string, now = new Date()): string {
  return `- ${entry} (task ${runId.slice(0, 8)}, ${now.toISOString().slice(0, 10)})`;
}

/** The newest whole lines that fit — used only when a hand-edited file is already over the cap. */
export function clampMemoryToTail(content: string, maxBytes = MANAGER_MEMORY_MAX_BYTES): string {
  if (memoryBytes(content) <= maxBytes) return content;
  const lines = content.split('\n');
  const kept: string[] = [];
  let bytes = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? '';
    const cost = memoryBytes(line) + (kept.length > 0 ? 1 : 0);
    if (bytes + cost > maxBytes) break;
    kept.unshift(line);
    bytes += cost;
  }
  return kept.join('\n');
}

export async function readManagerMemory(dataDir: string): Promise<ManagerMemoryRead> {
  const read = await readStateFile(managerMemoryPath(dataDir));
  return memoryReadOf(read.content ?? '');
}

export type MemoryWriteResult =
  | { ok: true; memory: ManagerMemoryRead }
  | { ok: false; status: 400 | 409; error: string; current?: ManagerMemoryRead };

/** `PUT /manager-memory` (Settings). Refuses rather than truncates; a stale `revision` is 409
 *  with the current file so the section can reload instead of silently dropping another edit. */
export function writeManagerMemory(dataDir: string, input: ManagerMemoryPut): Promise<MemoryWriteResult> {
  const path = managerMemoryPath(dataDir);
  return withPathLock<MemoryWriteResult>(path, async (): Promise<MemoryWriteResult> => {
    const current = (await readStateFile(path)).content ?? '';
    if (input.revision !== revisionOf(current)) {
      return { ok: false, status: 409, error: 'memory changed in another window', current: memoryReadOf(current) };
    }
    const bytes = memoryBytes(input.content);
    if (bytes > MANAGER_MEMORY_MAX_BYTES) {
      return { ok: false, status: 400, error: `memory is ${bytes} bytes; the limit is ${MANAGER_MEMORY_MAX_BYTES}` };
    }
    await writeAtomic(path, input.content);
    return { ok: true, memory: memoryReadOf(input.content) };
  });
}

export type MemoryAppendResult =
  | { ok: true; memory: ManagerMemoryRead; entry: string }
  | { ok: false; status: 400 | 409; error: string };

/**
 * `POST /runs/:id/memory` — append one lesson. The whole read-modify-write runs under the path
 * lock, so two managers finishing at the same moment cannot lose each other's line.
 */
export function appendManagerMemory(
  dataDir: string,
  rawEntry: string,
  runId: string,
  redact: (text: string) => string = (text) => text,
): Promise<MemoryAppendResult> {
  const path = managerMemoryPath(dataDir);
  return withPathLock<MemoryAppendResult>(path, async (): Promise<MemoryAppendResult> => {
    const entry = sanitizeMemoryEntry(rawEntry, redact);
    if (!entry) return { ok: false, status: 400, error: 'the lesson is empty after cleaning' };
    const current = (await readStateFile(path)).content ?? '';
    const glue = current && !current.endsWith('\n') ? '\n' : '';
    const next = `${current}${glue}${memoryEntryLine(entry, runId)}\n`;
    if (memoryBytes(next) > MANAGER_MEMORY_MAX_BYTES) {
      return { ok: false, status: 409, error: 'memory is full — ask the user to prune it in Settings' };
    }
    await writeAtomic(path, next);
    return { ok: true, memory: memoryReadOf(next), entry };
  });
}
