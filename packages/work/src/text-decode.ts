import { readFile } from 'node:fs/promises';

/**
 * The text of a file a person may have written by hand on Windows: PowerShell 5.1's `>` and
 * `Out-File` save UTF-16LE, `Set-Content -Encoding UTF8` and some editors add a UTF-8 BOM. A bare
 * `readFile(path, 'utf8')` keeps the BOM as U+FEFF (and turns UTF-16 into NULs), which `JSON.parse`
 * refuses — and every reader of a hand-written file swallows that, so the settings vanished silently.
 *
 * Total: never throws, whatever the bytes. Only for files people edit; the ones onni writes itself
 * are plain UTF-8.
 */
export function decodeText(bytes: Buffer): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString('utf16le');
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    // `swap16` needs an even length; a truncated last unit carries no character.
    const body = Buffer.from(bytes.subarray(2, bytes.length - ((bytes.length - 2) % 2)));
    return body.swap16().toString('utf16le');
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return bytes.subarray(3).toString('utf8');
  return bytes.toString('utf8');
}

/** `readFile(path, 'utf8')` for a hand-written file — see `decodeText`. */
export async function readTextFile(path: string): Promise<string> {
  return decodeText(await readFile(path));
}
