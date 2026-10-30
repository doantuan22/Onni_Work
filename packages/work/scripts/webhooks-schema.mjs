// Run from the repository: node --import tsx packages/work/scripts/webhooks-schema.mjs
import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { webhookEventSchema } from '@onni/contract';
await writeFile(new URL('../docs/webhooks.schema.json', import.meta.url), JSON.stringify(z.toJSONSchema(webhookEventSchema), null, 2) + '\n');
