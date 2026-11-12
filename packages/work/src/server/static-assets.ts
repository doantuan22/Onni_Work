/**
 * The `/assets/:file` route's read cache and compression.
 *
 * Vite fingerprints every filename under `assets/`, so the bytes behind a URL never change: each
 * file is read once per process instead of once per request (a cold cockpit load asks for ~50 of
 * them, and the largest — the Vietnamese dictionary chunk — was 499 KB re-read every time).
 * `gzip` is negotiated and cached beside the raw bytes; formats that are already compressed and
 * files under a kilobyte are served as-is, where gzip would only add bytes and CPU.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { ASSET_CACHE_CONTROL, assetContentType, isSafeAssetFilename } from './static-ui.ts';

const GZIP_MIN_BYTES = 1_024;
const COMPRESSIBLE = new Set(['js', 'css', 'svg', 'json', 'map']);

/** True when the request's `Accept-Encoding` allows gzip — `gzip;q=0` does not. */
export function wantsGzip(acceptEncoding: string | undefined): boolean {
  if (!acceptEncoding) return false;
  for (const part of acceptEncoding.split(',')) {
    const [coding = '', ...params] = part.split(';').map((piece) => piece.trim());
    if (coding.toLowerCase() !== 'gzip' && coding !== '*') continue;
    const q = params.find((param) => param.startsWith('q='));
    if (q && Number(q.slice(2)) === 0) continue;
    return true;
  }
  return false;
}

/** Whether gzip is worth its bytes for this file. */
export function compressible(file: string, size: number): boolean {
  return size >= GZIP_MIN_BYTES && COMPRESSIBLE.has(file.split('.').pop()?.toLowerCase() ?? '');
}

export interface AssetResponsePlan {
  body: Uint8Array;
  headers: Record<string, string>;
}

export class AssetCache {
  private readonly files = new Map<string, { body: Uint8Array; gzip?: Uint8Array }>();

  constructor(private readonly dir: string) {}

  /** `undefined` means "not a file we ship" — the route answers 404, and the miss is not cached
   *  so a build that lands later is picked up without a restart. */
  respond(file: string, acceptEncoding?: string): AssetResponsePlan | undefined {
    if (!isSafeAssetFilename(file)) return undefined;
    let entry = this.files.get(file);
    if (!entry) {
      const path = join(this.dir, file);
      if (!existsSync(path) || !statSync(path).isFile()) return undefined;
      entry = { body: readFileSync(path) };
      this.files.set(file, entry);
    }
    const headers: Record<string, string> = {
      'content-type': assetContentType(file),
      'cache-control': ASSET_CACHE_CONTROL,
      // The bytes differ by encoding, so a shared cache must key on the request header too.
      vary: 'accept-encoding',
    };
    if (!wantsGzip(acceptEncoding) || !compressible(file, entry.body.byteLength)) {
      return { body: entry.body, headers };
    }
    entry.gzip ??= gzipSync(entry.body);
    return { body: entry.gzip, headers: { ...headers, 'content-encoding': 'gzip' } };
  }
}
