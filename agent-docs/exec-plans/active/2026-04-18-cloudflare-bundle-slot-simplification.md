## Title

Investigate and simplify the remaining Cloudflare runner bundle cache/version pair.

## Goal

Determine whether the remaining local `bundle_ref_json` / `bundle_version` state on `runner_meta` is still correctness-bearing after the direct final-bundle happy path landed, and implement the smallest safe simplification if it is not.

## Constraints

- Stay within `apps/cloudflare/src/user-runner/runner-state-schema.ts`, `apps/cloudflare/src/user-runner/runner-state-store.ts`, `apps/cloudflare/src/user-runner/runner-bundle-sync.ts`, and focused `apps/cloudflare/test/**`.
- Do not disturb the already-verified happy path that writes the final bundle directly.
- Prefer deleting Cloudflare-owned compatibility state in this greenfield hosted environment.
- Preserve unrelated work and nearby Cloudflare stateless-executor lanes.

## Investigation Questions

1. Which reads of `bundle_ref_json` and `bundle_version` are still on the runtime correctness path versus only latency/repair optimization?
2. Can either field be downgraded to explicit cache-only semantics without broadening this slice into commit-recovery or wake-processor changes?
3. Which stale multi-slot assumptions are still hanging around in tests or local helper semantics, even though the table is already hard-cut?

## Planned Verification

- `pnpm typecheck`
- truthful scoped Cloudflare tests for the touched owner, likely via `bash scripts/workspace-verify.sh test:diff ...` or focused Vitest coverage if diff-aware coverage is not truthful

## Notes

- If no safe simplification exists inside the allowed files, stop at precise blocker analysis with file references instead of forcing a broader refactor.
- Conclusion after the stateless-executor cutover: keep `bundle_ref_json` / `bundle_version` as the single local bundle cache and swap fence. The old multi-slot recovery layer is already gone, and deleting this last pair would require a broader restore-from-web refactor without improving correctness for the greenfield cutover.
