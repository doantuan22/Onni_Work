import { describe, expect, it } from 'vitest';
import { createWebhookSchema, updateWebhookSchema } from '@onni/contract';
import { dropLegacyChatReceivers } from './endpoints.ts';
describe('removed chat formats', () => {
  it('preserves the old custom default', () => {
    expect(createWebhookSchema.parse({ name: 'Old', url: 'http://localhost/hook' }).format).toBe('onni.json.v1');
  });
  it.each(['slack.v1', 'discord.v1'])('rejects %s on create and update', format => {
    expect(createWebhookSchema.safeParse({ name: 'Chat', format, url: 'https://example.com/hook' }).success).toBe(false);
    expect(updateWebhookSchema.safeParse({ name: 'Chat', format, expectedRevision: 1 }).success).toBe(false);
  });
  it('drops stored slack/discord receivers on read and leaves a history row for each', () => {
    const custom = { id: 'c', name: 'Custom', format: 'onni.json.v1' };
    const state = { version: 1, receivers: [{ id: 's', name: 'Slack', format: 'slack.v1' }, custom, { id: 'd', name: 'Discord', format: 'discord.v1' }], history: [], changeSequence: 3 };
    const next = dropLegacyChatReceivers(state) as typeof state & { history: Array<{ kind: string; id: string; name: string }> };
    expect(next.receivers).toEqual([custom]);
    expect(next.history.map(({ kind, id, name }) => ({ kind, id, name }))).toEqual([{ kind: 'history', id: 's', name: 'Slack' }, { kind: 'history', id: 'd', name: 'Discord' }]);
    expect(dropLegacyChatReceivers({ ...state, receivers: [custom] })).toEqual({ ...state, receivers: [custom] });
  });
});
