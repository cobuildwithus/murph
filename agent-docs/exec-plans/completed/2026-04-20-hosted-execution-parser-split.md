## Title

Split hosted-execution cursor, ingress-control, and run-control parsers into focused owner modules while keeping `parsers.ts` as the public compatibility surface.

## Goal

Land the safe hosted-execution parser extraction that moves cursor/bundle parsing, ingress append/control parsing, and hosted-run control parsing out of the giant `packages/hosted-execution/src/parsers.ts` file without changing the current run-drain protocol or public exports.

## Scope

- `packages/hosted-execution/src/parsers.ts`
- `packages/hosted-execution/src/parsers/assertions.ts`
- `packages/hosted-execution/src/parsers/cursor.ts`
- `packages/hosted-execution/src/parsers/ingress-control.ts`
- `packages/hosted-execution/src/parsers/run-control.ts`
- focused hosted-execution parser tests only if the rebased split needs direct coverage updates

## Constraints

- Preserve the current run-drain and hosted-run recovery semantics already present in the repo.
- Keep `packages/hosted-execution/src/parsers.ts` as the stable public compatibility/export surface.
- Preserve unrelated dirty-tree edits and work carefully around adjacent hosted-wake rows that also mention hosted-execution parsers.
- Do not broaden into the larger `assistant/cron.ts`, `apps/cloudflare/src/user-runner.ts`, or `runner-wake-processor.ts` follow-up refactors.

## Verification

- passed: `pnpm --dir packages/hosted-execution typecheck`
- passed: `pnpm test:smoke`
- passed: `git diff --check`
- failed for unrelated pre-existing workspace issues: `pnpm typecheck`
  - `apps/web` still has existing type errors in hosted onboarding/settings components (`hosted-phone-auth-controller.ts`, multiple `hosted-*-settings-sections.tsx` files with `"md"` button-size usage)
- failed for unrelated pre-existing workspace issues after hosted-execution and dependent package checks passed: `bash scripts/workspace-verify.sh test:diff packages/hosted-execution/src/parsers.ts packages/hosted-execution/src/parsers/assertions.ts packages/hosted-execution/src/parsers/cursor.ts packages/hosted-execution/src/parsers/ingress-control.ts packages/hosted-execution/src/parsers/run-control.ts packages/hosted-execution/test`
  - `packages/assistant-runtime`, `packages/cli`, `packages/cloudflare-hosted-control`, and `packages/hosted-execution` typecheck/test slices passed
  - the lane later failed in `apps/cloudflare verify` on existing test typing around legacy `assistant.cron.tick` wakes being assigned to `HostedIngressEnvelope`
- failed for unrelated pre-existing package threshold drift: `pnpm --dir packages/hosted-execution test:coverage`
  - the extracted `run-control.ts` now clears its branch threshold (`71.01%`)
  - the remaining failure is the pre-existing `packages/hosted-execution/src/parsers/device-sync.ts` coverage deficit

## Notes

- The supplied patch no longer applies cleanly because `packages/hosted-execution/src/parsers.ts` has drifted to the newer run-drain surface, but the extraction remains structurally safe.
- `requireBigIntString` and nullable bigint parsing still belong in shared parser assertions after the split so cursor and run-control modules can share them directly.
Status: completed
Updated: 2026-04-20
Completed: 2026-04-20
