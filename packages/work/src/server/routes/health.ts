import { Hono } from 'hono';

export function createHealthRoutes<Payload extends Record<string, unknown>>(deps: { readHealth: () => Promise<Payload> }) {
  // Written as ONE chained expression rather than a loose `app.get(...)`
  // statement because Hono accumulates its route types through the chain: a
  // statement's return value is discarded, so `typeof app` would record nothing
  // and `hc<AppType>` would have no endpoint to offer. `createApp` mounts this
  // under both `/api` (the frozen legacy spelling) and `/api/v1`.
  return new Hono().get('/health', async (c) => c.json(await deps.readHealth()));
}
