/**
 * Spell a native path with `/` so a test can assert a POSIX-shaped suffix on every host.
 *
 * The product returns host-native paths (`join`, `resolve`, git's own output), and `\` is not a
 * legal character in a Windows filename, so the rewrite is lossless. Assert the shape the
 * product promises (which directory a file landed in, which relative suffix names it), not the
 * separator the host happens to use.
 */
export function posixPath(path: string): string {
  return path.replace(/\\/g, '/');
}
