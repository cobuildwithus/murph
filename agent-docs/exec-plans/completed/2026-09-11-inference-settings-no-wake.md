# Apply inference settings on real work without waking runners

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Outcome and invariant

Saving inference settings writes Postgres without scheduling runtime work. The next real turn uses the saved route; already-admitted turns may finish. Pending work survives an incompatible invocation handoff.

## Ownership and evidence

Settings currently call runtime_wake_requested, which can ensure processing with no pending work and start a container. Delete these producers and their scheduling helpers. Keep the protocol reader for existing Temporal histories and operational callers.

The current mailbox fetch already carries the managed provider. Extend that same response with the selected custom connection revision so selection, replacement, and removal are observed without another settings resolver call or notification owner. Reuse the revision-derived model alias and existing runtime handoff flag.

## Scope and simplicity

No new endpoint, queue, retry policy, dependency, persisted configuration, or runner status probe. Postgres remains authoritative. Reuse the existing member projection and mailbox read. Preserve authentication, CSRF, verification, revision conflict checks, and accepted input ownership.

## Product UX

Outcome: settings save without starting or interrupting a runner.
Reaches: managed provider switches; custom selection, replacement, and deletion; sleeping and active invocations; unchanged settings and failed saves.
Proof: route regressions for zero scheduled work, mailbox projection/parser proof, and composed runtime handoff tests including changed custom revisions and preserved pending work. No prompt or presentation changes; model output quality is not changed by this lifecycle boundary.

## Deployment and failure

Deploy Web mailbox projection before the updated runtime. Existing runtimes ignore the optional revision field. Preserve the managed provider field and Temporal signal reader for mixed versions and histories. A missed observation waits for the next normal fetch; no settings retry creates work. Unavailable ordinary mailbox reads retain their current retry behavior.

## Tasks

1. Remove settings wake producers and helpers; update route regressions.
2. Carry selected custom revision on the existing mailbox response and compare invocation identity at its current owner.
3. Prove settings persistence, no scheduled work, provider/revision handoff, and unchanged-route execution.
4. Update current owner docs; run focused tests, typechecks, complexity review; inspect and commit the scoped change.

## Verification and outcome

- `pnpm --dir apps/web test:prepared test/settings-assistant-model-route.test.ts test/settings-assistant-route.test.ts test/settings-inference-connection-route.test.ts`: 21 passed. Each route proves no scheduled after-task and no runtime wake signal, including successful persistence and rejected requests.
- `pnpm --dir apps/web test:prepared test/hosted-runtime-internal-routes.test.ts`: 98 passed. Empty mailbox responses preserve selected revision and managed deselection; the current member projection is read once.
- `pnpm --dir packages/hosted-execution test test/hosted-runtime-control.test.ts`: 41 passed. Revision validation, explicit managed null, and legacy field omission remain supported.
- `pnpm --dir packages/assistant-runtime test test/hosted-runtime-workspace-entrypoint-scheduling.test.ts test/hosted-runtime-workspace-entrypoint-causal-input.test.ts test/hosted-runtime-codex-config.test.ts`: 143 passed, 7 existing skips. Real runtime orchestration with synthetic provider effects covers managed switches, custom selection, replacement/reselection, deletion, missing revision during skew, matching custom identity despite a different dormant managed provider, and checkpoint handoff before another wake.
- `pnpm --dir packages/operator-config test test/hosted-assistant-venice.test.ts test/hosted-assistant-bootstrap.test.ts`: 8 passed. Composed custom tests exposed a pre-existing omission of the already-registered custom provider from the hosted seed allowlist. Adding its existing constant, reusing the same exported allowlist in Codex preparation, and deleting redundant managed-only runtime validation removes the divergent lists.
- `pnpm --dir apps/web typecheck`, and package `typecheck` for assistant-runtime, hosted-execution, and operator-config: passed.
- Final allowlist consolidation rerun: 96 runtime/config tests passed, 12 skipped by the focused selection or existing skip declarations; assistant-runtime typecheck passed.
- `bash scripts/check-agent-docs-drift.sh`: required an index description update for changed owner docs; updated the existing spec entry and the guard passed.
- `pnpm complexity:diff`: passed; existing runtime complexity debt decreased by one. No new function exceeds the threshold. Existing unrelated hotspots do not justify a refactor in this task.
- Parent review: settings remain authenticated, revision-fenced, and verified before replacement. No credentials or endpoint URLs enter the mailbox projection. The only additional selected relation is the bounded singular inference connection with selected/revision fields; no additional application resolver, transaction, provider request, or notification is added to the hot path.
- Product UX: Ready for the tested lifecycle boundaries. Existing next-turn contract remains; already-admitted turns may finish. No prompt, model-visible input, tool contract, presentation, or model-quality behavior changed, so a stochastic live-model test would not prove the changed lifecycle invariant.
- Changelog: not applicable; internal execution lifecycle and configuration consistency preserve the existing next-turn settings contract.
- No new repository tooling friction was encountered; existing fresh-worktree installation warnings did not block verification.
- Delivery scope: local scoped commit. No push, PR, external ReviewGPT, production mutation, or deployment performed. A future PR requires the normal hosted-execution review and exact-head CI gates.
Completed: 2026-09-11
