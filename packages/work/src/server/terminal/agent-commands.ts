import type { RunnerId } from '../../core/agent-runner.ts';

/**
 * What a project terminal types to start each agent CLI.
 *
 * Fixed here and chosen by runner id, so a request can never decide what is typed into a shell
 * (the same rule `shells.ts` applies to the executable). A bare name, resolved by the user's own
 * shell and PATH — the tab behaves exactly like running the CLI by hand. cursor and antigravity
 * ship binaries named differently from their runner ids.
 */
export const AGENT_COMMAND: Record<RunnerId, string> = {
  claude: 'claude',
  codex: 'codex',
  opencode: 'opencode',
  cursor: 'cursor-agent',
  pi: 'pi',
  junie: 'junie',
  copilot: 'copilot',
  cline: 'cline',
  antigravity: 'agy',
};
