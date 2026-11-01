import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { expect, it } from 'vitest';
import { TrackerConnections } from './connections.ts';

it('does not follow a symlinked tracker credential file', async () => {
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(join(parent, 'onni-tracker-link-'));
  try {
    const home = join(root, 'home');
    const project = join(root, 'project');
    await mkdir(project);
    const store = new TrackerConnections({ ONNI_HOME: home });
    expect(await store.write(project, { kind: 'linear', key: 'synthetic-test-key' })).not.toBeNull();
    const id = createHash('sha256').update(await realpath(project)).digest('hex');
    const file = join(home, 'tracker-connections', `${id}.env`);
    const target = join(root, 'outside-tracker-directory.env');
    await writeFile(target, await readFile(file));
    await rm(file);
    try {
      await symlink(target, file, 'file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
      throw error;
    }
    expect(await store.read(project)).toBeNull();
    expect((await store.inspect(project)).error).toBeTruthy();
  } finally {
    const actual = await realpath(root);
    if (!actual.startsWith(parent + sep)) throw new Error('Refusing cleanup outside the temporary directory');
    await rm(actual, { recursive: true, force: true });
  }
}, 20_000);
