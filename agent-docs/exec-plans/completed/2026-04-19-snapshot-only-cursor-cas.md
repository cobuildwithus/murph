## Title

Allow hosted cursor CAS commits that keep `committedSeq` fixed while writing a newer `snapshotRef`.

## Goal

Make the web-owned hosted cursor fence match the greenfield cutover guide by allowing snapshot-only residue commits to succeed when `expectedVersion` still matches, even when `committedSeq` does not advance.

## Scope

- `apps/web/src/lib/hosted-wake/store.ts`
- focused hosted wake store tests proving snapshot-only CAS success and stale-version rejection
- any narrow hosted-wake test helpers that currently hard-code the old "must advance seq" behavior

## Constraints

- Treat this as the intended greenfield cursor contract, not a compatibility shim.
- Keep terminal receipt requirements on seq-advancing commits only; snapshot-only residue CAS must not require a wake receipt.
- Preserve fail-closed behavior for backward commits, skipped seqs, and stale `expectedVersion`.
- Avoid unrelated hosted wake, onboarding, or Cloudflare runtime changes.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-wake/store.ts apps/web/test/hosted-wake-store.test.ts apps/cloudflare/test/workers/test-hosted-wake-control.ts`

## Notes

- The exact proof needed is: same `committedSeq` + changed `snapshotRef` + matching `expectedVersion` commits and increments `version`; the same attempt with a stale `expectedVersion` fails; snapshot-only residue CAS does not require a terminal receipt.
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
