## Title

Hard-cut hosted-run commit semantics so partial acquired-prefix commits fail closed.

## Goal

Prevent `commitHostedRunTx` from accepting `outputCommittedSeq` values below the highest acquired sequence, so a run either commits every acquired ingress event or fails and releases them.

## Scope

- `apps/web/src/lib/hosted-run/store.ts`
- focused `apps/web` tests covering the hosted-run commit invariant
- verification and audit artifacts required by repo policy for this slice

## Constraints

- Keep this as a narrow hosted-run reliability fix only.
- Preserve unrelated dirty-tree edits and overlapping hosted-run / hosted-wake lanes.
- Do not add partial-prefix support or broaden the store API; fail closed instead.
- Zero-event runtime-timer runs must continue to commit successfully when `outputCommittedSeq === inputCommittedSeq`.

## Verification

- planned: `pnpm typecheck`
- planned: `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-run/store.ts apps/web/test/hosted-run-store.test.ts`
- planned: `git diff --check`

## Notes

- The existing commit path rejects regressions and out-of-range commits above the acquired ceiling, but still allows a smaller committed seq that strands remaining acquired wakes in `running`.
- The intended invariant is simple for greenfield: all acquired ingress rows commit together, otherwise the run closes without commit and the rows return to `pending`.
Status: completed
Updated: 2026-04-20
Completed: 2026-04-20
