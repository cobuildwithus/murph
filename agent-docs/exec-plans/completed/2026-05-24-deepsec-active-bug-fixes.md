# DeepSec active BUG fix batch

Status: completed
Created: 2026-05-24
Updated: 2026-05-24

## Goal

- Fix the first batch of active DeepSec `BUG` findings with small owner-local changes that preserve simple long-term architecture.

## Success criteria

- Hosted account deletion reliably removes account-bound webhook trace metadata and does not leave new traces accepted during deletion.
- WhatsApp consent reads fail closed on malformed document-version state and concurrent commands cannot overwrite newer consent state.
- Hosted billing plan upgrades fail closed on unsupported Stripe subscription items.
- Hosted AI allowance period recompute/accounting cannot silently drop concurrent spend.
- Assistant daemon transport errors do not expose query strings containing vault paths.
- Generated-artifact cleanup refuses to recursively delete through symlinked generated roots.
- Focused tests cover the changed behavior and the required repo verification/audit workflow runs or any blocker is documented.

## Scope

- In scope:
  - Active DeepSec `BUG` findings from the agreed fix-now batch.
  - Focused tests for the touched hosted web, assistant CLI, and cleanup-script surfaces.
- Out of scope:
  - `HIGH_BUG` findings.
  - Lower-priority UI/CLI polish findings from the active `BUG` list.
  - Broad rewrites of hosted billing, allowance, consent, or deletion architecture.

## Constraints

- Technical constraints:
  - Prefer existing owner-local primitives, Prisma transactions, existing lock patterns, and focused guards over new framework-level abstractions.
  - Do not introduce new persisted state unless existing columns/relations are insufficient.
- Product/process constraints:
  - Preserve privacy guardrails: no direct personal identifiers, local paths, secrets, raw provider payloads, or account-specific values in files, tests, logs, or handoff.
  - Preserve unrelated working-tree edits and active ledger rows.

## Risks and mitigations

1. Risk: Privacy/billing/concurrency fixes can grow into a broad subsystem refactor.
   Mitigation: Keep each fix local to the owner module and add narrow regression tests.
2. Risk: The dirty worktree contains unrelated active work.
   Mitigation: Touch only this plan, this ledger row, and the DeepSec batch files/tests; use scoped verification and commit paths.

## Tasks

1. Add focused tests that reproduce the active `BUG` findings where practical.
2. Implement webhook-trace deletion/acceptance hardening.
3. Implement WhatsApp consent fail-closed and stale-write hardening.
4. Implement Stripe subscription item fail-closed validation.
5. Implement allowance recompute/accounting serialization/fail-closed behavior.
6. Implement daemon error and generated-cleanup safety hardening.
7. Run focused verification, required audits, final review, and finish the scoped plan.

## Decisions

- Fix only the agreed active `BUG` batch first; defer lower-priority active `BUG` findings and all `HIGH_BUG` findings.
- Use existing blind-index, transaction, conditional-update, and route-label primitives instead of introducing new subsystem abstractions.
- Keep allowance hardening to row locks around period recompute/accounting plus fail-closed increment semantics.
- After security review, add a shared transaction-scoped advisory lock for webhook trace owners and require exact observed-row consent updates.

## Verification

- Passed:
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/device-sync-webhook-traces.test.ts apps/web/test/prisma-store-device-sync-signal.test.ts apps/web/test/hosted-account-data-service.test.ts apps/web/test/hosted-execution-usage-allowance.test.ts apps/web/test/hosted-onboarding-billing-plan-change-service.test.ts apps/web/test/hosted-onboarding-whatsapp-service.test.ts` (105 tests)
  - `pnpm --dir packages/assistant-cli exec vitest run --config vitest.config.ts --no-coverage test/assistant-daemon-client-more.test.ts`
  - `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/check-no-js.test.ts`
  - `bash scripts/workspace-verify.sh typecheck`
  - `bash scripts/workspace-verify.sh test:diff ...`
  - `pnpm --dir apps/web exec eslint ...` for touched web source/test files
  - `pnpm --dir packages/assistant-cli typecheck`
  - `pnpm exec tsc -p tsconfig.tools.json --pretty false`
  - `git diff --check`
- Audits:
  - `simplify`: found strict consent-version gap; fixed.
  - `security-privacy-review`: found webhook deletion/claim race and same-timestamp consent race; fixed.
  - Follow-up `security-privacy-review`: no findings.
  - `coverage-write`: added grant-create unique race coverage.
  - `task-finish-review`: found invalid-JSON daemon query-stripping test gap; fixed.
- Notes:
  - Raw `test:diff` expanded into unrelated pre-existing `packages/cli` dirty work and the full `apps/web verify` lane; it passed after pre-existing local setup warnings.
  - After post-audit fixes, `pnpm --dir apps/web typecheck:prepared` is blocked by unrelated dirty work in `apps/web/test/hosted-onboarding-member-service.test.ts`.
Completed: 2026-05-24
