# Return supplement label payloads from hosted lookup

Status: completed
Created: 2026-06-05
Updated: 2026-06-05

## Goal

- Hosted supplement label lookup should return useful label content by default:
  search and exact lookup responses preserve the stored label payload, default to
  five results, and keep the existing caller-customizable limit capped at 50.

## Success criteria

- `apps/web` `/api/supplements` search responses include the stored `label`
  JSON for each match.
- `packages/cli` supplement label helpers preserve `label` through parsing for
  search, batch search, and exact lookup responses.
- Default result limit is 5 for the web route and CLI helpers/command schemas;
  explicit `limit` still works and remains capped at 50.
- Focused web, CLI, Cloudflare, and hosted-local harness tests/typechecks pass,
  with a live hosted-local route probe proving the default result count and
  payload presence without printing full label contents.

## Scope

- In scope: `ARCHITECTURE.md`, `apps/web` supplement lookup library/route tests,
  `packages/cli` supplement label schemas/commands/generated schema/tests, and
  already-started hosted-local data API fix files from this task thread.
- Out of scope: assistant prompt changes, new supplement database schema, new
  hosted topology abstractions, and unrelated active hosted-local E2E work.

## Constraints

- Technical constraints: keep the data API key Worker-owned, avoid new package
  coupling, preserve the narrow `/api/supplements` internal route, and do not
  introduce test-only production branches.
- Product/process constraints: do not edit prompt files; preserve unrelated
  dirty worktree changes and secret/privacy guardrails.

## Risks and mitigations

1. Risk: returning full labels makes default payloads larger.
   Mitigation: lower the default limit to 5 while preserving explicit caller
   control and the existing max cap.
2. Risk: exact lookup still appears metadata-only to assistants.
   Mitigation: update the CLI schema so Zod preserves the existing `label`
   field instead of stripping it.

## Tasks

1. Done: Update web supplement query response shape and route default limit.
2. Done: Update CLI parser schemas, helper default limit, command schema
   examples, and generated command metadata.
3. Done: Update focused tests for label payload preservation and limit defaults.
4. Done: Run focused verification, live hosted-local route proof, and required
   audits. Scoped diff verification passed; full `test:diff` is blocked by
   unrelated dirty `packages/vault-usecases` package-shape work.

## Decisions

- Keep the full stored label JSON under `label` instead of designing a second
  normalized facts schema in this task. That is the simplest durable contract
  because the supplement database already owns the source-shaped label payload.

## Verification

- Passed:
  - `pnpm --dir packages/cli exec vitest run --config vitest.config.ts test/supplement-labels.test.ts test/supplement-wearables-coverage.test.ts test/incur-smoke.test.ts --no-coverage`
  - `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/supplements-lib.test.ts apps/web/test/supplements-route.test.ts --no-coverage`
  - `pnpm --dir apps/web typecheck`
  - `pnpm --dir packages/cli typecheck`
  - `pnpm --dir apps/cloudflare typecheck`
  - `pnpm --dir packages/hosted-local-harness typecheck`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/runner-egress-intercept.test.ts --no-coverage`
  - `pnpm --dir packages/hosted-local-harness exec vitest run --config vitest.config.ts test/dev-hosted-local/environment.test.ts --no-coverage`
  - `pnpm --dir apps/web lint`
  - `pnpm docs:drift`
  - `pnpm --dir packages/cli gen:config-schema`
  - `pnpm --dir packages/cli verify:package-shape`
  - `git diff --check`
- Live local route proof: direct authenticated `/api/supplements?q=creatine`
  returned HTTP 200 with five default search items and object `label` payloads;
  exact lookup by returned id also returned HTTP 200 with an object `label`.
- Blocked/unrelated: `bash scripts/workspace-verify.sh test:diff <scoped files>`
  fails on unrelated dirty `packages/vault-usecases` package-shape changes that
  export `./testing`; the scoped supplement diff did not introduce that owner
  change.
- Audits: security/privacy, coverage-write, deep-review, and final task-finish
  review reported no remaining scoped findings. They noted the bounded payload
  size residual risk for explicit high limits and the same unrelated
  `test:diff` blocker.
Completed: 2026-06-05
