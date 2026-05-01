# Hosted Local Final Fixes Patch

Goal (incl. success criteria):
- Land the supplied hosted-local final-fixes patch against the current checkout.
- Success means legacy root hosted-local dev and Cloudflare hosted-local E2E entrypoints delegate through `packages/hosted-local-harness`, generated harness artifacts are ignored, and focused repo-tool tests cover compatibility argument behavior.

Constraints/Assumptions:
- Preserve unrelated dirty work and active ledger rows.
- Do not print or persist secrets, raw contact identifiers, raw message payloads, or personal filesystem identifiers.
- Treat the patch as behavioral intent because it is stale against the current tree.
- Avoid manifest/dependency churn unless current repo state requires it.

Key decisions:
- Use the hosted-local harness package as the compatibility owner for old script entrypoints.
- Keep legacy Cloudflare E2E runner behavior compatible by defaulting bundle preparation off for that wrapper.
- Keep `@murphai/hosted-local-harness` as a Cloudflare dev dependency only so the production runner bundle closure does not include local-dev harness code.
- Redact sensitive command args plus identifier/payload-shaped state env values before writing hosted-local state files.

State:
- in_progress

Done:
- Read required repo workflow, architecture, verification, security, reliability, and testing docs.
- Confirmed the patch does not apply cleanly and must be ported.
- Ported compatibility wrappers, programmatic harness API, exports, ignore rule, and focused repo-tool tests.
- Addressed audit findings for state redaction, Cloudflare dependency scope, and the existing Cloudflare wrapper test.

Now:
- Rerun focused checks and close/commit the scoped patch if unrelated dirty-tree failures remain isolated.

Next:
- Run focused checks, required audits, and close/commit using the safest scoped path available in the dirty checkout.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether existing package exports already include equivalent harness surfaces under a different name.

Working set (files/ids/commands):
- `.gitignore`
- `apps/cloudflare/package.json`
- `apps/cloudflare/scripts/run-hosted-local-e2e.ts`
- `apps/cloudflare/test/run-hosted-local-e2e.test.ts`
- `apps/cloudflare/vitest.shared.ts`
- `packages/hosted-local-harness/README.md`
- `packages/hosted-local-harness/src/{compat,harness,index}.ts`
- `packages/hosted-local-harness/src/{e2e,state}.ts`
- `packages/hosted-local-harness/package.json`
- `pnpm-lock.yaml`
- `scripts/dev-hosted-local.ts`
- `scripts/hosted-local.test.ts`
- `tsconfig.base.json`
- `agent-docs/exec-plans/active/2026-05-01-hosted-local-final-fixes.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Status: completed
Updated: 2026-05-01
Completed: 2026-05-01
