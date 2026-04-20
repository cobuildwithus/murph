# Verify and land hosted cleanup follow-ups

Status: completed
Created: 2026-04-20
Updated: 2026-04-20

## Goal

- Verify and land the smallest safe fixes for the reported hosted cleanup follow-ups across `apps/web`, `apps/cloudflare`, and `packages/assistant-runtime`.
- Remove dead route/proxy code, trim stale single-wake branches, narrow runner-secret authority, and deduplicate hosted key-store / env-category mapping where safe in the current dirty tree.

## Success criteria

- Dead device-sync connect-start helpers are removed if no live imports/tests depend on them.
- `apps/cloudflare/src/local-loopback-proxy.ts` keeps only live protocol helpers, and the duplicated hosted user key-store construction in the two shared helpers is replaced with one narrow owner helper.
- Hosted runtime request handling no longer carries unreachable missing-`runDrain` / legacy single-wake branches after parser validation, while preserving the current run-drain timer fallback.
- Runner-secret runtime read/decode surfaces are separated from unused writer/update helpers, and logging category maps are reused instead of repeated.
- Focused verification plus required completion-workflow audit passes run before handoff.

## Scope

- In scope:
- `apps/web/src/lib/device-sync/connect-start-route.ts`
- `apps/cloudflare/src/{local-loopback-proxy.ts,worker-routes/shared.ts,runner-outbound/shared.ts,user-key-store.ts,runner-secrets.ts,bundle-store.ts,hosted-env-policy.ts}`
- `apps/cloudflare/src/user-runner/{runner-secrets.ts,runner-run-processor.ts}`
- `packages/assistant-runtime/src/hosted-runtime{.ts,/models.ts,/utils.ts,/execution.ts}`
- Directly coupled tests only
- Out of scope:
- Broader hosted wake/run protocol changes already in flight
- Device-sync route behavior changes in the live settings route
- User-runner lifecycle or web/Postgres recovery contract changes beyond the listed cleanup seams

## Constraints

- Preserve overlapping dirty-tree work; do not revert or overwrite adjacent changes.
- Keep ownership boundaries intact: shared helpers stay in owner modules, and trust-boundary behavior must not change accidentally.
- Preserve parser-level `runDrain` validation and runtime-timer synthetic wake fallback.
- Keep runner-secret behavior read-only for the live runtime path unless an existing current writer is discovered.

## Risks and mitigations

1. Risk: The requested dead-code removal may still be referenced by hidden tests or in-flight refactors.
   Mitigation: Verify imports/usages first, and only delete when the tree proves the symbol is unused.

2. Risk: Cleanup in `packages/assistant-runtime` and `apps/cloudflare` overlaps active run-centric refactors.
   Mitigation: Keep the diff narrow, register the lane in the coordination ledger, and integrate carefully on top of existing edits.

3. Risk: Runner-secret cleanup could accidentally narrow a still-needed test/setup path.
   Mitigation: Split read/decode from management helpers first, inspect all usages, and keep removal limited to truly unused exports.

## Tasks

1. Verify current usages and current dirty-tree state for each reported issue.
2. Land the smallest safe code cleanup for the confirmed dead/duplicated paths.
3. Add or update only the focused tests needed to cover changed behavior.
4. Run scoped truthful verification, then required completion-workflow audit passes.
5. Finish with a scoped commit via `scripts/finish-task`.

## Decisions

- This lane will favor deletion and reuse over introducing new abstractions unless the dedup itself needs one narrow owner helper.
- The env-category follow-up will keep existing membership unchanged and only extract/reuse current maps.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:diff apps/web/src/lib/device-sync/connect-start-route.ts apps/cloudflare/src/local-loopback-proxy.ts apps/cloudflare/src/worker-routes/shared.ts apps/cloudflare/src/runner-outbound/shared.ts apps/cloudflare/src/user-key-store.ts apps/cloudflare/src/runner-secrets.ts apps/cloudflare/src/bundle-store.ts apps/cloudflare/src/hosted-env-policy.ts apps/cloudflare/src/user-runner/runner-secrets.ts apps/cloudflare/src/user-runner/runner-run-processor.ts packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/src/hosted-runtime/models.ts packages/assistant-runtime/src/hosted-runtime/utils.ts packages/assistant-runtime/src/hosted-runtime/execution.ts`
- Expected outcomes:
- Typecheck plus truthful diff-scoped coverage for the touched owners pass, or any unrelated pre-existing failures are documented precisely.
Completed: 2026-04-20
