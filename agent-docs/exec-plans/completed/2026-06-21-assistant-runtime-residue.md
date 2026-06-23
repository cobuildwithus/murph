# Assistant Runtime Residue Pruning

Status: completed
Created: 2026-06-21
Updated: 2026-06-21

## Goal

- Land the supplied assistant-runtime residue pruning patch on an isolated
  branch, keep it conservative around hosted continuity state, and publish a
  PR after local verification, completion audits, and the external ReviewGPT
  loop.

## Success criteria

- Old settled assistant runtime residue is pruned by bounded age/count rules
  without deleting pending input, active outbox, incomplete evidence, provider
  cleanup, or receipt-backed continuity that may still be needed.
- Hosted v2 snapshot creation prunes safe assistant residue before archive
  planning and logs only aggregate counts.
- Runtime-state descriptors and legacy hot-state bundling cover the real
  `state/accepted-turn-inputs` path; tests keep direct v2 snapshot behavior
  aligned with the broad assistant-runtime continuity policy.
- Required package verification, completion audits, and ReviewGPT PR review
  finish with no unresolved accepted findings.

## Scope

- In scope: `packages/assistant-engine`, `packages/assistant-runtime`,
  `packages/runtime-state`, focused tests, and this execution plan.
- Out of scope: new persisted state owners, schema migrations, new hosted
  schedulers, snapshot format changes, or broad runtime-state refactors.

## Constraints

- Technical constraints: assistant runtime state is high-sensitivity execution
  residue, not product truth; hosted snapshots must keep durable continuity and
  exclude secrets, caches, projections, locks, temp files, and process-local
  residue.
- Product/process constraints: preserve unrelated worktree changes, run the
  repo-required verification/audit flow, close this plan through
  `scripts/finish-task`, and run ReviewGPT against the pushed PR head.

## Risks and mitigations

1. Risk: cleanup deletes input/evidence/receipt state that is still needed for
   reply replay, provider cleanup, or hosted recovery.
   Mitigation: require complete/trusted inventories, preserve pending input,
   active turn/outbox, incomplete evidence groups, and provider cleanup
   obligations; add focused tests for those cases.
2. Risk: hosted snapshot pruning adds latency or leaks sensitive details.
   Mitigation: run pruning during checkpoint cleanup only and emit aggregate
   counts, not paths, prompts, transcripts, or payloads.
3. Risk: runtime-state path correction breaks legacy fixture expectations.
   Mitigation: update tests to keep the real portable path and prove the old
   misplaced path is excluded.

## Tasks

1. Apply the supplied patch on a branch/worktree from the remote base.
2. Review and correct tests/fixtures for the actual runtime-state path.
3. Run focused package tests, typecheck, and required completion audits.
4. Commit through `scripts/finish-task`, push, and open a draft PR.
5. Run ReviewGPT PR rounds until there are zero accepted findings.

## Decisions

- Use the existing pending-input index as the hosted authority for inputs that
  must not be pruned during snapshot cleanup.
- Keep cleanup best-effort in the hosted snapshot path: log a warning on
  failure, then continue snapshot creation.
- Export residue cleanup through a narrow assistant-engine subpath instead of
  the broader assistant-runtime barrel so CLI startup imports stay small.
- Protect orphan input events referenced by active auto-reply receipt metadata,
  even when terminal evidence is absent or incomplete.

## Verification

- Passed:
  - `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-runtime-residue.test.ts`
  - `pnpm --dir packages/runtime-state exec vitest run --config vitest.config.ts --no-coverage test/hosted-bundle.test.ts`
  - `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-runtime-thresholds.test.ts`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/runtime-bridge-workspace.test.ts --no-coverage`
  - `pnpm --dir packages/assistant-cli exec vitest run --config vitest.config.ts test/assistant-command-startup-imports.test.ts --no-coverage`
  - `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-invocation-bridge.test.ts`
  - `pnpm test:diff $({ git diff --name-only --; git ls-files --others --exclude-standard; } | sort -u)`
  - `pnpm typecheck`
  - `pnpm test:smoke`
- Completion audits: local security/privacy, coverage/proof, and deep-review
  passes completed with no unresolved accepted findings. Coverage review found
  and fixed the missing checkpoint-continuation test for residue-prune failure;
  deep review found and fixed the active auto-reply metadata orphan-input guard.
- Remaining external proof: run ReviewGPT against the pushed PR until a
  zero-accepted-finding round, then ensure PR CI is green on that head.
Completed: 2026-06-21
