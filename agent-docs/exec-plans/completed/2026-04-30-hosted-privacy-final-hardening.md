# Hosted Privacy Final Hardening

Status: completed
Created: 2026-04-30
Updated: 2026-04-30

## Goal

- Fix the remaining hosted account export/delete security review findings after the final-fixes patch landed.

## Success criteria

- Client/server destructive delete confirmation keeps the user-typed phrase authoritative.
- Hosted account deletion commits Prisma deletion before best-effort Cloudflare cleanup.
- Cloudflare user-data deletion preflights Durable Object ownership before R2 deletion and preserves the root-key envelope unless scoped cleanup is possible.
- Hosted data export uses bounded queries and minimized projections instead of raw spreads or arbitrary decoded mailbox payloads.
- Small JSON confirmation bodies are size-limited on the web and Cloudflare privacy/control routes.
- Stale export builder/schema and unused UI error state are removed.
- Focused tests cover wrong phrase rejection, deletion ordering, export minimization/bounds, R2/DO failure ordering, and renamed internal route paths.

## Scope

- In scope:
  - `apps/web` hosted privacy/export routes, account-data service, settings privacy UI, and focused tests.
  - `apps/cloudflare` hosted user-data deletion route/body parsing, Durable Object cleanup ordering, and focused tests.
  - `packages/cloudflare-hosted-control` route suffix/client tests for the clearer internal delete path.
- Out of scope:
  - New Privy step-up authentication flow unless an existing narrow server-side primitive is already available.
  - Unrelated dirty Health Commons, assistant-runtime, hosted-local, and experiment-detail rows.

## Constraints

- Preserve unrelated working-tree edits and active ledger rows.
- Do not expose secrets, raw credentials, local user identifiers, or personal data in files, logs, docs, tests, commit messages, or handoff.
- Do not weaken hosted auth or crypto fail-closed behavior to satisfy tests.
- Keep the export MVP bounded and explicitly partial instead of claiming full DSAR completeness.

## Risks and mitigations

1. Risk: The deletion flow can create unrecoverable partial states.
   Mitigation: Move Cloudflare cleanup after the Prisma transaction and prove transaction failure does not call Cloudflare.
2. Risk: Export projections can leak provider/internal details.
   Mitigation: Replace raw spreads and arbitrary mailbox payload export with allowlisted metadata and omission flags.
3. Risk: The dirty checkout can make broad verification noisy.
   Mitigation: Use focused checks first, then run the required app/package verification lanes and document unrelated blockers precisely.

## Tasks

1. Done: Refresh repo workflow/security/frontend/verification guidance and inspect current code.
2. Done: Implement bounded export/deletion hardening and focused tests.
3. Done: Run required audits and verification.
4. Now: Close plan and create a scoped commit.

## Decisions

- Keep privacy export as a bounded MVP with truncation metadata rather than streaming in this pass.
- Omit decoded mailbox payloads entirely for MVP; typed per-kind allowlists can be added later.
- Do not implement fresh Privy step-up in this pass unless the current auth helper already exposes a reliable recent-auth timestamp.

## Audit outcomes

- Security/privacy review: completed. No high/medium findings; low runtime diagnostics minimization finding addressed by omitting diagnostic JSON and outbox intent refs from export.
- Simplify review: completed. Addressed findings by avoiding mailbox ciphertext/ref/dedupe materialization, omitting webhook trace counts from export, fixing stale schema fixture, and making the DO assertion return `void`.
- Frontend review: completed. Addressed delete dialog mobile/pending safeguards, phrase helper text, and polite deletion summary announcement.
- Coverage-write: completed with no additional test changes; focused web, Cloudflare, hosted-control tests and typecheck were rerun by the pass.
- Task-finish review: completed. Low internal row/correlation ID minimization finding addressed by replacing repeated export IDs with presence flags and adding omission assertions.

## Verification

- Passed: `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-account-data-service.test.ts apps/web/test/hosted-data-privacy-settings.test.ts apps/web/test/settings-data-export-route.test.ts apps/web/test/settings-privacy-delete-route.test.ts`.
- Passed: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/index.test.ts apps/cloudflare/test/user-runner-alarm.test.ts`.
- Passed: `pnpm exec vitest run --config vitest.config.ts --no-coverage test/routes.test.ts test/client.test.ts` from `packages/cloudflare-hosted-control`.
- Passed before final review fix: `pnpm typecheck`.
- Passed after final review fix: `pnpm --dir apps/web exec tsc -p tsconfig.json --pretty false`.
- Blocked after final review fix: `pnpm typecheck` fails in the `apps/web` health-commons generate pre-step on unrelated dirty Health Commons content validation (`summary` object where string expected).
- Partial scoped diff lane: `bash scripts/workspace-verify.sh test:diff <hosted privacy touched files>` passed through hosted-control and Cloudflare verify, then failed in `apps/web verify` dev-smoke setup on the same unrelated Health Commons content validation.
Completed: 2026-04-30
