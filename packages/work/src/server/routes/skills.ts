import { Hono } from 'hono';
import type { ZodType } from 'zod';
import type { discoverSkills as DiscoverSkills } from '../../skills.ts';
import type { gatedSkillsRepos as GatedSkillsRepos } from '../../config.ts';
import type {
  getTeamSkillsCached as GetTeamSkillsCached,
  refreshTeamSkills as RefreshTeamSkills,
  waitForTeamSkills as WaitForTeamSkills,
} from '../../skills-remote.ts';
import type { ProjectContext } from '../project-context.ts';
import { queryZodValidator } from '../validators.ts';

type ProjectApiEnv = { Variables: { project: ProjectContext } };

export function skillsRoutes<TWaitQuery extends ZodType<{ wait?: string | undefined }, any>>(deps: {
  waitQuery: TWaitQuery;
  discoverSkills: typeof DiscoverSkills;
  gatedSkillsRepos: typeof GatedSkillsRepos;
  getTeamSkillsCached: typeof GetTeamSkillsCached;
  refreshTeamSkills: typeof RefreshTeamSkills;
  waitForTeamSkills: typeof WaitForTeamSkills;
}) {
  return new Hono<ProjectApiEnv>()
    .get('/skills', queryZodValidator(deps.waitQuery), async (c) => {
      const repoRoot = c.get('project').root;
      // The default read stays fast and starts the team load in the background.
      // The cockpit follows it with `wait=1`, off the render path, so a cold
      // cache converges without polling or a manual reload (spec 005 / #555).
      if (c.req.valid('query').wait === '1') await deps.waitForTeamSkills(repoRoot);
      return c.json(await deps.discoverSkills(repoRoot));
    })

    // Every skill a *default* skills repo offers, regardless of enabled state, so the Skills
    // catalog can list and preview disabled entries. OnniCode ships no default source, so this
    // answers [] unless a fork configures one; it also empties once a repo sets its own
    // `skillsRepos` (nothing is gated then). `wait=1` lets the page wait out a cold team-skill
    // cache, same as `GET /skills` (spec 005).
    .get('/skills/importable', queryZodValidator(deps.waitQuery), async (c) => {
      const repoRoot = c.get('project').root;
      const gated = await deps.gatedSkillsRepos(repoRoot);
      if (gated.size === 0) return c.json([]);
      if (c.req.valid('query').wait === '1') await deps.waitForTeamSkills(repoRoot);
      const importable = deps.getTeamSkillsCached(repoRoot).filter((skill) => skill.team && gated.has(skill.team.repo));
      return c.json(importable);
    })

    // Refresh team skills (spec 005): clone/fetch the configured skills repos,
    // then return the merged catalog. Degrades quietly — offline just means the
    // team entries stay as they were (or absent).
    .post('/skills/refresh', async (c) => {
      const { root: repoRoot } = c.get('project');
      await deps.refreshTeamSkills(repoRoot);
      return c.json(await deps.discoverSkills(repoRoot));
    });
}
