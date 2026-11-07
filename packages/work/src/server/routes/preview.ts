import { designProxyRequestSchema } from '@onni/contract';
import { Hono } from 'hono';
import type { DesignProxies } from '../preview/design-proxy.ts';
import { jsonZodValidator } from '../validators.ts';

export function createPreviewRoutes(deps: {
  capabilities: () => { designMode: boolean };
  designProxies: DesignProxies;
}) {
  return new Hono().post('/preview/design-proxy', jsonZodValidator(designProxyRequestSchema), async (c) => {
    if (!deps.capabilities().designMode) {
      return c.json({ error: 'Design Mode is not available on this cockpit' }, 409);
    }
    const host = c.req.header('host');
    const opened = await deps.designProxies.open({ ...c.req.valid('json'), forbidden: host ? [`http://${host}`] : [] });
    if (!opened.ok) return c.json({ error: opened.reason }, 400);
    return c.json({ origin: opened.origin });
  });
}
