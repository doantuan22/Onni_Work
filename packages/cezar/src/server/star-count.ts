/**
 * The cockpit's ⭐ ask, as a route that never asks GitHub anything.
 *
 * cezar read its own stargazer count here and the cockpit rendered a chip from it. Onni Work
 * does not make that request: the reader answers `{ available: false }` unconditionally, and the
 * sidebar chip, the toast and the star dialog already hide themselves on that answer. The route
 * and the payload shape stay in place so `starCountSchema` and BACKWARD_COMPATIBILITY.md keep
 * their promise — an unavailable count is a 200 with a well-formed body, never a 5xx.
 */

export const CEZAR_REPO_URL = 'https://github.com/doantuan22/Onni_Work';

export interface StarCount {
  /** Always `false` in Onni Work; the field stays for the contract. */
  available: boolean;
  /** Only present when `available`. */
  count?: number;
  url: string;
}

/** Frozen: `read()` hands this same object to every caller. */
const UNAVAILABLE: StarCount = Object.freeze({ available: false, url: CEZAR_REPO_URL });

export class StarCountReader {
  async read(): Promise<StarCount> {
    return UNAVAILABLE;
  }
}
