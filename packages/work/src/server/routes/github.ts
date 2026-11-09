import { Hono } from 'hono';
import { z } from 'zod';
import { githubListQuerySchema } from '@onni/contract';
import { getRepoInfo } from '../git.ts';
import { resolveForge } from '../forge/index.ts';
import {
  fetchGithub, fetchGithubChecks, fetchGithubComments, fetchGithubPrDiff,
  fetchGithubRefStatus, forgetRefStatus, searchGithubItems, GithubPrNotFoundError,
  GH_CHECKS_MAX, GH_SEARCH_MAX, GH_REF_STATUS_MAX,
} from '../github.ts';
import type { ProjectContext } from '../project-context.ts';
import { jsonZodValidator, paramZodValidator, queryZodValidator } from '../validators.ts';

type ProjectApiEnv = { Variables: { project: ProjectContext } };
type QueryValue = z.ZodType<string | undefined, string | string[] | undefined>;
type RefreshQuery = z.ZodType<{ refresh?: string | undefined }, any>;

export function createGithubRoutes<QueryValueType extends QueryValue, RefreshQueryType extends RefreshQuery>(deps: {
  queryValue: QueryValueType;
  refreshQuery: RefreshQueryType;
}) {
  const { queryValue, refreshQuery } = deps;
  const mergeNumberParams = z.object({ number: z.coerce.number().int().positive() });
  /** A ref-status list: `null` means malformed (the caller answers 400), `[]` means "not asked
   *  for". Absent and empty are the same request — neither names a number. */
  const parseRefNumbers = (raw: string | undefined): number[] | null => {
    const parts = (raw ?? '').split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length > GH_REF_STATUS_MAX) return null;
    const numbers: number[] = [];
    for (const part of parts) {
      const n = Number(part);
      if (!Number.isInteger(n) || n <= 0 || String(n) !== part) return null;
      numbers.push(n);
    }
    return numbers;
  };
  const prChangesParams = z.object({ number: z.coerce.number().int().positive().safe() });
  const prChangesQuery: RefreshQuery = z.object({ refresh: queryValue.refine((v) => v === undefined || v === '1') });
  // The full comment thread for one issue/PR (#499). Additive sibling of /api/github — lazy
  // (fetched only while a detail view is open), zod-validated params, 400 on garbage, and the
  // same in-payload availability degrade (gh missing / offline / 404 all render as a hint).
  const commentsParams = z.object({
    kind: z.enum(['issue', 'pr']),
    number: z.coerce.number().int().positive(),
  });
  const mergeBodySchema = z.object({
    method: z.enum(['merge', 'squash', 'rebase']),
    expectedHeadSha: z.string().regex(/^[0-9a-f]{40}$/),
    overrideRules: z.boolean().optional().default(false),
  }).strict();

  return new Hono<ProjectApiEnv>()
    .get(
      '/github',
      // `limit` stays a bare string: the handler's `Number.parseInt`/`Number.isFinite` fallback to
      // 30 already accepts `?limit=banana`, and a numeric schema would 400 it instead.
      queryZodValidator(githubListQuerySchema),
      async (c) => {
        const { root: repoRoot } = c.get('project');
        const query = c.req.valid('query');
        const limit = Number.parseInt(query.limit ?? '', 10);
        return c.json(await fetchGithub(repoRoot, query.refresh === '1', Number.isFinite(limit) ? limit : 50, {
          issuesCursor: query.issuesCursor,
          prsCursor: query.prsCursor,
        }));
      },
    )

    .get('/github/comments/:kind/:number', queryZodValidator(refreshQuery), async (c) => {
      const { root: repoRoot } = c.get('project');
      const parsed = commentsParams.safeParse({
        kind: c.req.param('kind'),
        number: c.req.param('number'),
      });
      if (!parsed.success) return c.json({ error: 'invalid kind or number' }, 400);
      return c.json(
        await fetchGithubComments(repoRoot, parsed.data.kind, parsed.data.number, c.req.valid('query').refresh === '1'),
      );
    })

    // Lazy checks glyphs for on-screen PR rows (#664). Additive sibling of /api/github — the list
    // call dropped `statusCheckRollup` (the dominant cost), so the glyph is hydrated here per
    // visible row. `prs` is a comma-separated list of positive integers, capped at GH_CHECKS_MAX;
    // anything malformed is a 400. Same in-payload availability degrade as the list (never a 5xx).
    // `prs` is the one genuinely REQUIRED query key on this server, so it is the one validated
    // strictly — `.min(1)` because `?prs=` answered `missing prs query` before it answered
    // `invalid prs query`, and both spellings must keep their own words.
    .get('/github/checks', queryZodValidator(z.object({ prs: z.string().min(1) }), { message: 'missing prs query' }), async (c) => {
      const { root: repoRoot } = c.get('project');
      const raw = c.req.valid('query').prs;
      const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
      if (parts.length === 0 || parts.length > GH_CHECKS_MAX) return c.json({ error: 'invalid prs query' }, 400);
      const numbers: number[] = [];
      for (const part of parts) {
        const n = Number(part);
        if (!Number.isInteger(n) || n <= 0 || String(n) !== part) return c.json({ error: 'invalid prs query' }, 400);
        numbers.push(n);
      }
      return c.json(await fetchGithubChecks(repoRoot, numbers));
    })

    // Search across ALL states (#730). Additive sibling of `/github`, which lists the OPEN set
    // only (`gh issue/pr list` defaults to `--state open`) — so the tab's in-memory filter can
    // never match a closed or merged item, and this is the path it falls back to. Same in-payload
    // availability degrade as the list (never a 5xx); malformed params are a 400. Deliberately
    // uncached: it is typed-into, not polled, and the driver's own cap bounds the work.
    .get(
      '/github/search',
      queryZodValidator(
        z.object({
          kind: z.enum(['issue', 'pr']),
          q: z.string().trim().min(1).max(256),
          limit: z.coerce.number().int().positive().max(GH_SEARCH_MAX).optional(),
        }),
        { message: 'invalid search query' },
      ),
      async (c) => {
        const { root: repoRoot } = c.get('project');
        const { kind, q, limit } = c.req.valid('query');
        return c.json(await searchGithubItems(repoRoot, kind, q, limit));
      },
    )

    // Batched status for the PR/issue chips a task table paints. Additive sibling of
    // /github/checks and shaped like it: comma-separated positive integers, capped at
    // GH_REF_STATUS_MAX per kind, malformed input is a 400, and an unreachable forge degrades in
    // the payload. Unlike /github/checks BOTH keys are optional — a table may hold only issues —
    // but at least one must name something, or the request asks for nothing.
    .get(
      '/github/ref-status',
      queryZodValidator(z.object({ prs: z.string().optional(), issues: z.string().optional() })),
      async (c) => {
        const { root: repoRoot } = c.get('project');
        const { prs, issues } = c.req.valid('query');
        const parsedPrs = parseRefNumbers(prs);
        const parsedIssues = parseRefNumbers(issues);
        if (parsedPrs === null || parsedIssues === null) return c.json({ error: 'invalid ref-status query' }, 400);
        if (parsedPrs.length === 0 && parsedIssues.length === 0) {
          return c.json({ error: 'missing prs or issues query' }, 400);
        }
        return c.json(await fetchGithubRefStatus(repoRoot, { prs: parsedPrs, issues: parsedIssues }));
      },
    )

    .get(
      '/github/prs/:number/merge-state',
      paramZodValidator(mergeNumberParams, { message: 'invalid pull request number' }),
      queryZodValidator(refreshQuery),
      async (c) => {
        const { root: repoRoot } = c.get('project');
        const parsed = { data: c.req.valid('param') };
        const forge = resolveForge(await getRepoInfo(repoRoot));
        if (!forge?.prMergeState) return c.json({ available: false, reason: 'GitHub merge state is unavailable' });
        return c.json(await forge.prMergeState(parsed.data.number, { refresh: c.req.valid('query').refresh === '1' }));
      },
    )

    .post(
      '/github/prs/:number/merge',
      paramZodValidator(mergeNumberParams, { message: 'invalid pull request number' }),
      jsonZodValidator(() => mergeBodySchema, { message: 'invalid merge request' }),
      async (c) => {
        const { root: repoRoot } = c.get('project');
        const parsedNumber = { data: c.req.valid('param') };
        const body = { data: c.req.valid('json') };
        const forge = resolveForge(await getRepoInfo(repoRoot));
        if (!forge?.mergePR) return c.json({ error: 'GitHub merge is unavailable' }, 409);
        const result = await forge.mergePR(parsedNumber.data.number, body.data);
        if (result.merged) {
          // We just changed this pull request, so what the ref-status cache holds about it is now
          // known-stale — and its TTL would keep every chip showing the PRE-merge status for up to
          // a minute after the user watched this server merge it. Forget it; the next reader asks
          // the forge, gets `merged`, and then stops polling it at all.
          forgetRefStatus(repoRoot, parsedNumber.data.number);
          return c.json(result);
        }
        return c.json(
          {
            error: result.error,
            ...(result.code ? { code: result.code } : {}),
            ...(result.current ? { current: result.current } : {}),
          },
          result.status,
        );
      },
    )

    .get(
      '/github/prs/:number/changes',
      // Split out of one `safeParse` over both inputs, because a path param and the query string
      // are separate validation targets to Hono and only a split makes each visible to the route
      // type. Both keep the single 400 sentence the combined parse answered. `refresh` stays
      // STRICT here (`?refresh=true` is a 400 today, unlike everywhere else on this server).
      paramZodValidator(prChangesParams, { message: 'invalid pull request number or refresh flag' }),
      queryZodValidator(prChangesQuery, { message: 'invalid pull request number or refresh flag' }),
      async (c) => {
        const { root: repoRoot } = c.get('project');
        const parsed = { data: c.req.valid('param') };
        try {
          return c.json(
            await fetchGithubPrDiff(repoRoot, parsed.data.number, c.req.valid('query').refresh === '1'),
          );
        } catch (err) {
          if (err instanceof GithubPrNotFoundError) return c.json({ error: err.message }, 404);
          throw err;
        }
      },
    );
}
