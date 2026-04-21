# Verify acceptance speedup

Status: completed
Created: 2026-04-21
Updated: 2026-04-21

## Goal

- Land the downloaded rebased acceptance-speedup patch only where it still applies cleanly to the current verification harness.
- Keep the change scoped to acceptance and verification-tooling behavior without widening into unrelated runtime or app behavior.

## Success criteria

- `pnpm verify:acceptance` runs through the workspace verifier entrypoint instead of chaining two root scripts separately.
- Acceptance skips only duplicated work already proven by the immediately preceding root typecheck inside the same acceptance run.
- Standalone `pnpm test:coverage` and standalone app verification stay self-contained.
- Verification docs stay aligned with the actual harness behavior.
- Required verification for this tooling lane passes, or any unrelated blocker is reported precisely.
- A scoped commit includes only this task's files plus plan/ledger closeout.

## Scope

- In scope: root verification scripts, the Cloudflare verify wrapper, root script wiring in `package.json`, and directly coupled verification docs.
- Out of scope: broader test-lane redesign, package/app runtime behavior changes, unrelated typecheck-speed tweaks already landed, and non-verification product code.

## Constraints

- Treat the downloaded artifact as intent, not overwrite authority; keep only the net-new acceptance-speedup changes that fit current HEAD.
- Preserve unrelated worktree edits.
- Do not expose personal identifiers in docs, commits, or handoff.

## Tasks

1. [x] Register the work in the coordination ledger.
2. [x] Apply the acceptance-speedup changes that still fit current HEAD.
3. [x] Run the required verification for this tooling lane and direct file checks.
4. [ ] Perform the required final review path and create a scoped commit.

## Verification

- `pnpm verify:acceptance`
- `bash -n scripts/workspace-verify.sh apps/cloudflare/scripts/verify-fast.sh`
- `node -e "JSON.parse(require('node:fs').readFileSync('package.json','utf8'))"`

## Notes

- `pnpm verify:acceptance` reached the new acceptance flow successfully: one lock covered the full run, the coverage phase logged that repo acceptance guards were skipped after the completed typecheck, the contracts coverage lane reused the existing contracts build, and `apps/cloudflare verify` logged the acceptance-only typecheck skip.
- The acceptance command still failed on the unrelated pre-existing `apps/web/test/experiment-header.test.ts` expectation looking for `7-day baseline · 14-day protocol` on the Bryan Johnson sauna header markup.
Completed: 2026-04-21
