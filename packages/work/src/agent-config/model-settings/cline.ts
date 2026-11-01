import type { AgentModelSettingsStrategy } from './types.ts';

/**
 * Cline CLI keeps no model default onni can read from a catalogued settings file: the chosen
 * model lives with the provider login in its own store (`~/.cline/data/settings`, written by
 * `cline auth`), whose shape is not documented and which also holds credentials, so it is not
 * parsed here. This reports "no native default" — the truthful answer — and the cockpit falls back
 * to onni's own handling exactly as it does for pi and Antigravity. Without a pinned model a run
 * simply keeps whatever Cline's own session starts with (`session/new`'s `currentModelId`).
 */
export const clineModelSettingsStrategy: AgentModelSettingsStrategy = {
  runner: 'cline',
  async read() {
    return { model: undefined };
  },
};
