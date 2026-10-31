import type { AgentModelSettingsStrategy } from './types.ts';

/**
 * Antigravity (`agy`) keeps no model default Onni can read: its settings file
 * (`~/.gemini/antigravity-cli/settings.json`) carries none, and the model is chosen per run with
 * `--model` from `agy models`. So this reports "no native default" — the truthful answer, not a
 * stub — and the cockpit falls back to Onni's own preset exactly as it does for pi.
 */
export const antigravityModelSettingsStrategy: AgentModelSettingsStrategy = {
  runner: 'antigravity',
  async read() {
    return { model: undefined };
  },
};
