# Goal

Simplify hosted run durable statuses so the contracts and web store expose only the states that the current run-centric flow actually persists.

# Scope

- `packages/hosted-execution/src/{contracts,parsers}.ts`
- `apps/web/src/lib/hosted-run/store.ts`
- focused hosted-run tests under `packages/hosted-execution/test/**`
- coordination artifacts for this cleanup lane only

# Constraints

- Preserve overlapping hosted-run migration work already in flight on the same owners.
- Treat this as durable state-machine cleanup only; do not broaden into runtime phase/log wording unless the status contract requires it.
- Remove `prepared` and `finalizing` unless a real durable writer is found.
- Remove `running` too unless a real `HostedRun.status = "running"` write exists in the current code path.

# Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/hosted-execution/src/contracts.ts packages/hosted-execution/src/parsers.ts apps/web/src/lib/hosted-run/store.ts packages/hosted-execution/test/hosted-execution.test.ts packages/hosted-execution/test/hosted-wake-parsers.test.ts packages/hosted-execution/test/hosted-run-drain-parsers-coverage.test.ts`
- `git diff --check`

# Notes

- Current inspection shows durable writes for `acquired`, `committed_needs_finalize`, `finalized`, `failed`, and `superseded` only.
- `prepared` and `finalizing` appear limited to enum/projection residue; `running` is also enum-only unless a hidden writer appears during implementation.
