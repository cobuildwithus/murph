# 2026-03-25 Parallel Security Remediations

## Goal

Land eight parallel security/data-integrity remediations requested in one turn, with clean worker ownership, no unsafe overlap, full required verification, and a single integrating commit.

## Constraints

- Follow the repo coordination-ledger hard gate before any code changes.
- Do not print or persist secret values from tracked `.env` files.
- Preserve unrelated in-flight edits already present in the worktree.
- Keep worker write scopes disjoint unless the coordinator explicitly integrates a shared file.
- Run completion workflow audits plus required repo checks before handoff.

## Lane Split

1. Hosted secret leak cleanup and rotation follow-up
   - Owns `apps/web/.env` removal from version control, hosted-control-plane secret follow-up docs, and any app-local secret handling notes/tests/config updates needed for this remediation.
   - Must not own shared repo cleanliness checks for tracked `.env` / `.next`; lane 8 owns those.
2. Hosted browser auth boundary hardening
   - Owns hosted auth/origin enforcement and related tests/docs.
3. Hosted agent session expiry and rotation
   - Owns Prisma schema/migration, session TTL enforcement, route behavior, tests, and hosted docs.
4. Canonical raw import manifest provenance integrity
   - Owns `packages/core` provenance handling and regression tests.
5. Inbox/assistant artifact path safety
   - Owns capture-id validation, safe vault path helpers/writers, rebuild/quarantine behavior, and tests.
6. Foreground inbox/assistant terminal log redaction
   - Owns default-safe logging behavior, optional unsafe preview gating if needed, and tests.
7. Local control-plane credential handling
   - Owns launcher-state token persistence changes, local-only base-URL enforcement, caller updates, and tests/docs.
8. Tracked `.next` cleanup and repo cleanliness guardrails
   - Owns removal of tracked `.next` residue and shared guardrails/checks for tracked `.env`, `.next`, and similar generated/private artifacts.

## Shared Invariants

- Hosted/browser routes must fail closed on untrusted auth/origin input.
- Bearer/session credentials need bounded lifetime or locality constraints.
- Canonical manifest fields remain authoritative over caller metadata.
- Assistant/inbox artifact writes must stay inside the vault boundary.
- Default foreground logs must not leak human identifiers or message content.
- Guardrail checks should prevent committed local/private/generated artifacts from recurring.

## Integration Notes

- Lane 1 and lane 8 both affect repo hygiene; lane 1 handles secret-leak remediation details, lane 8 handles shared tracked-artifact checks.
- Lane 2 and lane 3 both touch hosted device-sync docs/tests; coordinator merges if adjacent edits collide.
- Lane 7 overlaps the pre-existing device-sync trust-boundary area; preserve adjacent edits and keep scope on launcher-state token handling plus local-base-url enforcement.

## Verification Plan

1. Integrate worker changes and fill any coordinator-owned gaps.
2. Run simplify audit and apply behavior-preserving simplifications.
3. Run coverage audit and add any missing high-value tests.
4. Run final completion audit and resolve high-severity findings.
5. Run `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`.
6. Commit exact touched files with `scripts/committer`.

## Outcome

- Landed all eight requested remediation lanes plus coordinator-owned CI hygiene wiring and hosted agent route regression coverage.
- Current branch already no longer tracks `apps/web/.env` or `.next` artifacts; this change set documents the rotation/re-encryption follow-up and adds stronger guardrails against regressions.
- Simplify / coverage / finish-review passes found no further high-impact changes beyond the tests and coordinator wiring already applied.

## Verification Results

- Passed: `pnpm --dir apps/web test`
- Passed: `pnpm --dir packages/core test`
- Passed: `pnpm --dir packages/inboxd test`
- Passed: `pnpm --dir packages/web test`
- Passed: `pnpm exec vitest run packages/runtime-state/test/ulid.test.ts --no-coverage --maxWorkers 1`
- Passed: `pnpm exec vitest run packages/cli/test/device-daemon.test.ts --no-coverage --maxWorkers 1`
- Passed: `pnpm exec vitest run packages/cli/test/device-sync-client.test.ts --no-coverage --maxWorkers 1`
- Passed: `pnpm exec vitest run packages/cli/test/inbox-model-harness.test.ts --no-coverage --maxWorkers 1`
- Passed: `pnpm exec vitest run packages/cli/test/inbox-cli.test.ts --no-coverage --maxWorkers 1`
- Passed: `pnpm typecheck`
- Failed, unrelated: `pnpm test`
  - blocked immediately in `pnpm no-js` by a large pre-existing set of tracked/generated `.js` and `.d.ts` artifacts under multiple `packages/*/src` trees
- Failed, unrelated: `pnpm test:coverage`
  - blocked immediately in `pnpm no-js` by the same pre-existing tracked/generated source artifacts
Status: completed
Updated: 2026-03-25
Completed: 2026-03-25
