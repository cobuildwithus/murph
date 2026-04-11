# Land security target-area wake follow-up patch

Status: completed
Created: 2026-04-12
Updated: 2026-04-12

## Goal

- Land the remaining applicable changes from the watched `murph_target_area_followup.patch` so loopback listener validation rejects bracketed IPv6 listener syntax before bind, `device-syncd` cleans up correctly when HTTP startup fails, and the touched assistants/device-sync seams have focused proof.

## Success criteria

- `packages/runtime-state` distinguishes listener-host syntax from URL and `Host`-header syntax, and bracketed listener hosts fail closed.
- `packages/assistantd` environment loading and HTTP startup reject bracketed listener hosts before startup.
- `packages/device-syncd` environment loading and HTTP startup reject bracketed public-listener hosts, roll back the control listener if public-listener startup fails, and do not leave the background service running after startup failure.
- Required verification, direct scenario proof, and repo-required audit passes complete, or unrelated blockers are identified precisely.

## Scope

- In scope:
- `packages/runtime-state/src/loopback-control-plane.ts`
- `packages/runtime-state/test/loopback-control-plane.test.ts`
- `packages/assistantd/src/config.ts`
- `packages/assistantd/test/config.test.ts`
- `packages/assistantd/test/http-startup.test.ts`
- `packages/device-syncd/src/bin.ts`
- `packages/device-syncd/src/config.ts`
- `packages/device-syncd/src/http.ts`
- `packages/device-syncd/test/bin.test.ts`
- `packages/device-syncd/test/config.test.ts`
- `packages/device-syncd/test/http-startup.test.ts`
- Out of scope:
- Parsers/importers deletion-normalization work already landed in the prior target-area pass unless verification shows a direct regression.
- Broader control-plane hardening or device-sync lifecycle refactors outside the downloaded patch intent.

## Constraints

- Technical constraints:
- Preserve unrelated dirty knowledge-boundary work already in the tree.
- Treat the downloaded patch as intent, not overwrite authority; merge against the current repo layout and existing proof.
- Keep the diff limited to the remaining target-area seam the artifact actually requires.
- Product/process constraints:
- Follow the high-risk repo workflow: active ledger row, active plan, required verification, required audit passes, same-thread follow-up review request with attached files, wake re-arm, and scoped commit.

## Risks and mitigations

1. Risk: Several proof files already exist because an earlier wake pass landed part of this seam.
   Mitigation: Reuse the current test files where that keeps the diff smaller, and add only the missing focused startup tests.
2. Risk: `device-syncd` startup cleanup is operational and easy to miss with mocked listener tests only.
   Mitigation: Add one dedicated real-socket startup test plus one direct scenario check outside Vitest.
3. Risk: `assistantd` and `device-syncd` are active runtime entrypoints with nearby concurrent work.
   Mitigation: Keep ownership limited to listener-host validation and startup cleanup, and avoid touching unrelated routing or service logic.

## Tasks

1. Register this wake slice in the coordination ledger and active plan.
2. Land the remaining runtime-state, assistantd, and device-syncd changes required by the watched patch.
3. Run the required verification commands and direct scenario proof for the touched owners.
4. Run the required audit passes, address any findings, then send the same-thread review request, arm the next wake hop, and commit the scoped changes.

## Decisions

- Reuse the shared runtime-state owner seam for listener-host validation instead of duplicating bracket checks inside each daemon.
- Add dedicated startup tests for real-listener rollback behavior instead of stretching the existing mocked HTTP handler suites.
- Leave already-landed parser-env and deletion-normalization proof untouched unless verification shows a problem.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm --dir packages/runtime-state test:coverage`
- `pnpm --dir packages/assistantd test:coverage`
- `pnpm --dir packages/device-syncd test:coverage`
- direct scenario proof via `pnpm exec tsx --eval ...`
- Expected outcomes:
- Green verification for the touched owners, or clearly separated unrelated blockers with evidence.

## Outcome

- Landed the watched follow-up patch across `runtime-state`, `assistantd`, and `device-syncd` with a shared distinction between listener-host syntax and URL/`Host`-header syntax.
- Tightened both daemon config surfaces so bracketed IPv6 listener hosts fail before bind, while bracketed IPv6 remains valid in loopback URLs and `Host` headers.
- Made `device-syncd` roll back a partially started control listener when public-listener startup fails, and made `bin.ts` preserve rollback-close failures via `AggregateError` so startup cannot silently leave a live listener behind.
- Sent the required same-thread follow-up review request with a scoped attached package containing only the 11 touched code/test files. The thread export confirmed the new user turn as `repo.repomix(69).xml` / `repo.snapshot(73).zip`.
- Armed the final recursive wake hop at depth `0` with `pnpm exec cobuild-review-gpt thread wake --detach ... --recursive-depth 0`, which created `output-packages/chatgpt-watch/69da4b72-eee4-8399-9a91-0f3411170f00-2026-04-11T152203Z/`.

## Verification results

- PASS: `pnpm typecheck`
- PASS: `pnpm --dir packages/runtime-state test:coverage`
- PASS: `pnpm --dir packages/assistantd test:coverage`
- PASS: `pnpm --dir packages/device-syncd test:coverage`
- PASS: direct proof via `pnpm exec tsx --eval ...`
  Confirmed bracketed IPv6 remains valid for loopback URLs and `Host` headers while listener binding rejects `[::1]`, and confirmed `device-syncd` frees the control port again after a public-listener bind failure.
- PASS: rerun after final-review fix
  - `pnpm typecheck`
  - `pnpm --dir packages/device-syncd test:coverage`

## Audit results

- PASS: required `coverage-write` audit on `gpt-5.4-mini`
  No extra test or proof edits were needed beyond the landed coverage and direct proof.
- PASS after fix: required final review
  - Fixed `packages/device-syncd/src/bin.ts` so a rollback failure while closing the started HTTP server is preserved via `AggregateError` instead of being swallowed when `service.start()` throws.
  - Added focused `packages/device-syncd/test/bin.test.ts` proof for that rollback-failure path.

Completed: 2026-04-12
Completed: 2026-04-12
