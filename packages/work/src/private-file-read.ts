import { spawn, type ChildProcess } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Readable, Writable } from 'node:stream';

const WINDOWS_READER = resolve(dirname(fileURLToPath(import.meta.url)), '../scripts/windows-read-private-file.ps1');
const IDLE_SHUTDOWN_MS = 750;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_LINE = 1_500_000;

interface PendingRead {
  resolve: (value: string) => void;
  reject: (error: NodeJS.ErrnoException) => void;
  timeout: NodeJS.Timeout;
}

interface ReaderProcess {
  child: ChildProcess;
  input: Writable;
  output: Readable;
  pending: Map<number, PendingRead>;
  nextId: number;
  buffer: string;
  idleTimer?: NodeJS.Timeout;
  closed: boolean;
}

let reader: ReaderProcess | undefined;

function readError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error('Could not safely read the private file'), { code });
}

function rejectPending(worker: ReaderProcess, error: NodeJS.ErrnoException): void {
  for (const pending of worker.pending.values()) {
    clearTimeout(pending.timeout);
    pending.reject(error);
  }
  worker.pending.clear();
}

function stopWorker(worker: ReaderProcess, error?: NodeJS.ErrnoException): void {
  if (worker.closed) return;
  worker.closed = true;
  if (worker.idleTimer) clearTimeout(worker.idleTimer);
  if (reader === worker) reader = undefined;
  if (error) rejectPending(worker, error);
  worker.child.kill();
}

function failWorker(worker: ReaderProcess): void {
  stopWorker(worker, readError('EIO'));
}

function mapStatus(status: number): NodeJS.ErrnoException {
  return readError(status === 2 ? 'ENOENT' : status === 3 ? 'ELOOP' : status === 4 ? 'EFBIG' : 'EIO');
}

function parseResponse(worker: ReaderProcess, line: string): void {
  const match = /^(\d+)\t([0-4])\t([A-Za-z0-9+/]*={0,2})$/.exec(line);
  if (!match) return failWorker(worker);
  const id = Number(match[1]);
  const status = Number(match[2]);
  const pending = worker.pending.get(id);
  if (!pending) return failWorker(worker);
  worker.pending.delete(id);
  clearTimeout(pending.timeout);
  if (status !== 0) pending.reject(mapStatus(status));
  else pending.resolve(Buffer.from(match[3]!, 'base64').toString('utf8'));
  scheduleIdleShutdown(worker);
}

function scheduleIdleShutdown(worker: ReaderProcess): void {
  if (worker.closed || worker.pending.size !== 0) return;
  if (worker.idleTimer) clearTimeout(worker.idleTimer);
  worker.idleTimer = setTimeout(() => {
    if (worker.closed || worker.pending.size !== 0) return;
    worker.closed = true;
    if (reader === worker) reader = undefined;
    worker.input.end();
    const forceClose = setTimeout(() => worker.child.kill(), 500);
    forceClose.unref();
  }, IDLE_SHUTDOWN_MS);
}

function createWorker(): ReaderProcess {
  const root = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows';
  const powershell = join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const env: NodeJS.ProcessEnv = {};
  for (const name of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'PATH', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'COMSPEC', 'PROCESSOR_ARCHITECTURE']) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  const child = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', WINDOWS_READER], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const input = child.stdin!;
  const output = child.stdout!;
  const diagnostics = child.stderr!;
  output.setEncoding('utf8');
  diagnostics.resume();
  const worker: ReaderProcess = { child, input, output, pending: new Map(), nextId: 1, buffer: '', closed: false };
  output.on('data', (chunk: string | Buffer) => {
    if (worker.closed) return;
    worker.buffer += chunk.toString();
    if (worker.buffer.length > MAX_RESPONSE_LINE && !worker.buffer.includes('\n')) return failWorker(worker);
    let newline: number;
    while ((newline = worker.buffer.indexOf('\n')) >= 0) {
      const line = worker.buffer.slice(0, newline);
      worker.buffer = worker.buffer.slice(newline + 1);
      parseResponse(worker, line);
      if (worker.closed) break;
    }
  });
  input.on('error', () => failWorker(worker));
  output.on('error', () => failWorker(worker));
  child.on('error', () => failWorker(worker));
  child.on('close', () => {
    if (!worker.closed) stopWorker(worker, readError('EIO'));
  });
  reader = worker;
  return worker;
}

/** Open the final path component without following a Windows reparse point. */
export function readWindowsPrivateFile(path: string, maxBytes: number): Promise<string> {
  if (process.platform !== 'win32') return Promise.reject(readError('ENOTSUP'));
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > 1_048_576 || Buffer.byteLength(path, 'utf8') > 32_768) {
    return Promise.reject(readError('EINVAL'));
  }
  let worker = reader;
  if (!worker || worker.closed) worker = createWorker();
  if (worker.idleTimer) clearTimeout(worker.idleTimer);
  worker.idleTimer = undefined;
  const id = worker.nextId++;
  if (id > 2_000_000_000) {
    stopWorker(worker, readError('EIO'));
    return readWindowsPrivateFile(path, maxBytes);
  }
  return new Promise((resolveRead, reject) => {
    const timeout = setTimeout(() => failWorker(worker!), REQUEST_TIMEOUT_MS);
    worker!.pending.set(id, { resolve: resolveRead, reject, timeout });
    const request = `${id}\t${maxBytes}\t${Buffer.from(path, 'utf8').toString('base64')}\n`;
    worker!.input.write(request, 'ascii', (error?: Error | null) => {
      if (error) failWorker(worker!);
    });
  });
}
