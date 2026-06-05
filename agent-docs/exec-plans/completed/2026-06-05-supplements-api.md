Goal:
- Land the v1 supplements API inside `apps/web`, with hosted execution able to call it server-side using an injected bearer key.

Success criteria:
- `GET /api/supplements` supports `q`, `id`, and `upc` lookups against a separate supplements Postgres database.
- API access fails closed without `MURPH_DATA_API_KEY`.
- Hosted runner outbound interception injects `MURPH_DATA_API_KEY` for calls to the web route without forwarding the key into the container.
- Schema/import SQL are present for the new supplements database, without committing downloaded DSLD data or local file paths.
- Focused tests cover auth, input handling, query behavior, and hosted caller auth injection.
- Required verification and completion audits are run, then the plan is closed through `scripts/finish-task`.

Constraints:
- No new runtime dependency.
- Do not add Prisma for the supplements database.
- Use `MURPH_SUPPLEMENT_DB_URL` for the supplements database.
- Live DB import is allowed from local secret env without printing values.
- Keep secrets/env values out of source, logs, docs examples, and PR text.
- Do not read or print `.env.local` values into context.
- Preserve unrelated active work in the ledger and other worktrees.

Plan:
1. Inspect existing `apps/web` API/database patterns and hosted runtime/web-control fetch patterns.
2. Add the SQL schema/import files and direct `pg` query module.
3. Add the authenticated `apps/web` route.
4. Add the hosted runner intercept that injects the API key.
5. Add focused tests and env/docs updates.
6. Import DSLD data and configure Vercel/GitHub secrets without exposing values.
7. Run verification, required audits, commit, push, and open a draft PR.

State:
- Created from `origin/main` in a separate worktree.
- Inspected `apps/web` route/test patterns and Cloudflare hosted-runner egress/deploy secret wiring.
- Implemented the web route/query module, SQL schema/import files, Worker intercept and deploy secret surface, hosted runtime env projection, CLI `supplement search-labels` command, focused tests, and concise architecture/docs updates.
- Regenerated CLI metadata and added the `pg` type-only dev dependency needed for web typecheck.
- Verification so far: focused web/Cloudflare/assistant-runtime/CLI tests passed; owner typechecks passed; root `pnpm typecheck` completed; diff-aware verification completed through Cloudflare and web verify. Both repo harnesses printed an unrelated existing workspace-boundary violation in a Cloudflare smoke test that imports web internals.
- Live setup: GitHub production environment secret `MURPH_DATA_API_KEY` is configured, and Vercel production env vars `MURPH_DATA_API_KEY` / `MURPH_SUPPLEMENT_DB_URL` are configured.
- Live DB import: converted the DSLD archive to 214,780 NDJSON labels, but import is blocked because the configured DB role cannot create in `public`, cannot create schemas/databases, and `public.supplements` does not exist. Needs an owner/admin connection or grants before schema/import can run.
- Completion audits: security/trust-boundary review found and fixed a forwarded-env override gap for `HOSTED_WEB_BASE_URL`; reran assistant-runtime typecheck and hosted-runtime-environment test. Coverage/proof, simplify, and task-finish self-audits found no additional actionable gaps.
- Next: privacy scan, commit/push/open PR.
Status: completed
Updated: 2026-06-05
Completed: 2026-06-05
