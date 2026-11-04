/**
 * Async line iterator over a readable stream of UTF-8 NDJSON — one trimmed,
 * non-empty line per yield. Shared by every stdout/stdin-JSONL runner
 * (the claude CLI's stream-json and codex app-server's JSON-RPC transport).
 *
 * Newlines are searched for in each NEW chunk only, and the unterminated head of a line is kept as
 * pieces. Appending chunks to one string and `indexOf`-ing it made V8 flatten the whole buffer on
 * every chunk, so a single long line (a big tool result) cost time quadratic in its size, all of it
 * on the event loop: 32 MB took ~2 s and 64 MB ~8 s.
 */
export async function* readNdjson(stream: NodeJS.ReadableStream): AsyncGenerator<string> {
  stream.setEncoding('utf8');
  const pending: string[] = [];
  for await (const chunk of stream as AsyncIterable<string>) {
    let start = 0;
    let idx: number;
    while ((idx = chunk.indexOf('\n', start)) >= 0) {
      pending.push(chunk.slice(start, idx));
      const line = pending.join('').trim();
      pending.length = 0;
      start = idx + 1;
      if (line) yield line;
    }
    if (start < chunk.length) pending.push(chunk.slice(start));
  }
  const tail = pending.join('').trim();
  if (tail) yield tail;
}

/**
 * A parsed line that is an object. `JSON.parse('null')`, `'42'` and `'true'` succeed, so "it parsed"
 * does not mean "it is a frame": a runner that read `.type` or `.method` off one of those threw and
 * failed the whole run over a stray line from a wrapper script, a profile or a hook.
 */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
