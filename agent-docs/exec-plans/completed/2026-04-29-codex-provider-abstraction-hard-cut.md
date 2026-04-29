# Codex Provider Abstraction Hard Cut

Status: completed
Owner: Codex
Started: 2026-04-29

## Goal

Collapse vestigial assistant provider registry/route internals onto Codex-specific execution, capability, model-catalog, and thread-route helpers.

Success criteria:

- Assistant execution internals call Codex-specific helpers instead of generic provider-definition lookup.
- `AssistantProviderDefinition`, `ASSISTANT_PROVIDER_DEFINITIONS`, provider-list helpers, and generic provider-route builders are removed from live internal code.
- No compatibility aliases are kept unless a required internal package boundary proves they are still necessary.
- Existing Codex App Server behavior, resume behavior, usage extraction, route identity, and rich-content routing semantics are preserved.
- Provider-turn planning carries one Codex route and one attempt; fallback route
  arrays and attempted-route tracking are removed.
- Focused assistant-engine verification covers the hard cut.

## Scope

In scope:

- `packages/assistant-engine/src/assistant-provider.ts`
- `packages/assistant-engine/src/assistant-provider-catalog.ts`
- `packages/assistant-engine/src/assistant/provider-catalog.ts`
- `packages/assistant-engine/src/assistant/providers/**`
- `packages/assistant-engine/src/assistant/provider-registry.ts`
- `packages/assistant-engine/src/assistant/provider-route.ts`
- `packages/assistant-engine/src/assistant/execution-plan.ts`
- `packages/assistant-engine/src/assistant/service-turn-routes.ts`
- `packages/assistant-engine/src/assistant/provider-turn-runner.ts`
- `packages/assistant-engine/src/assistant/provider-turn/planning.ts`
- Directly coupled assistant-engine tests.

Out of scope:

- Hosted runtime active-turn, liveness, and mailbox work owned by other active rows.
- CLI/provider setup UX copy unless type or wrapper-export changes force it.
- Operator-config target-runtime hard cuts already completed or owned by separate rows.

## Constraints

- Preserve unrelated dirty work in the shared checkout.
- Do not write local usernames, home paths, legal names, or direct personal identifiers into files, logs, prompts, tests, or handoff.
- Hard cut: no provider plugin architecture and no compatibility aliases unless a current package boundary forces them.

## Plan

1. Trace provider registry, route, catalog, execution-plan, and test callers.
2. Replace public provider facade/catalog dispatch with Codex-specific helpers while preserving the UI-facing model-catalog module path.
3. Remove route-array and attempted-route planning from the provider-turn path.
4. Rename route construction to a Codex thread identity/route shape while preserving existing stable fields where still consumed.
5. Update focused tests and wrapper export assertions to the new hard-cut surface.
6. Run focused verification, required audits, privacy scan, and scoped commit if safe.

## Verification Log

- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-service-runtime.test.ts test/assistant-local-service-runtime.test.ts test/assistant-notification-turn-runtime.test.ts test/assistant-product-small-seams.test.ts test/provider-seams.test.ts test/turn-finalizer.test.ts` passed: 6 files, 97 tests.
- After simplify-review fixes, the same focused Vitest command passed again: 6 files, 97 tests.
- After coverage-write added the rich-content egress proof, `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-provider-final-coverage.test.ts test/assistant-service-runtime.test.ts test/assistant-local-service-runtime.test.ts test/assistant-notification-turn-runtime.test.ts test/assistant-product-small-seams.test.ts test/provider-seams.test.ts test/turn-finalizer.test.ts` passed: 7 files, 103 tests.
- `pnpm --filter @murphai/assistant-engine typecheck` passed.
- `git diff --check -- <route-fallback-slice paths>` passed.
- After simplify-review fixes, `git diff --check -- <route-fallback-slice paths>` passed again.
- After coverage-write, `git diff --check -- <route-fallback-slice paths>` passed again.
- `pnpm typecheck` failed after assistant-engine passed, at `packages/setup-cli/test/setup-services-coverage.test.ts:1115` on an unrelated stale `cursor` fixture field.
- `bash scripts/workspace-verify.sh test:diff <route-fallback-slice paths>` failed in reverse-dependent `packages/cli` typecheck on unrelated setup-cli public subpath/type drift and stale approval-policy fixtures.
- `pnpm --dir packages/assistant-engine test:coverage` ran 80/81 files and 709/710 tests successfully but failed on unrelated `test/assistant-status.test.ts` stale `autoReply.cursor` fixture shape.
- Latest facade/catalog pass: `pnpm --dir packages/assistant-engine test -- --run provider-registry-helpers.test.ts assistant-provider-final-coverage.test.ts assistant-wrapper-exports.test.ts` passed; the package-local Vitest wrapper executed the full assistant-engine suite.
- Latest facade/catalog pass: `pnpm --dir packages/assistant-engine typecheck` passed.
- Latest facade/catalog pass: `pnpm --dir packages/assistant-engine test:coverage` passed.
- Latest facade/catalog pass: `pnpm typecheck` failed after assistant-engine passed, in unrelated `packages/cli/test/assistant-codex.test.ts` approval-policy fixture drift (`"on-request"` no longer assignable to `"never"`); this task did not touch that file.
- Latest facade/catalog pass: `git diff --check` passed for the scoped provider-catalog/facade files and tests.
- Final hard-cut pass: `pnpm --dir packages/assistant-cli typecheck` passed.
- Final hard-cut pass: `pnpm exec vitest run --config vitest.config.ts --no-coverage test/provider-registry-helpers.test.ts test/assistant-provider-final-coverage.test.ts test/assistant-wrapper-exports.test.ts test/assistant-service-runtime.test.ts` from `packages/assistant-engine` passed: 4 files, 55 tests.
- Final hard-cut pass: `pnpm exec vitest run --config vitest.config.ts --no-coverage test/assistant-ui-runtime.test.ts test/assistant-ui-rendering.test.ts` from `packages/assistant-cli` passed: 2 files, 15 tests.
- Final hard-cut pass: scoped `git diff --check` passed.
- Final hard-cut pass: residue scans for provider-definition/list/get helpers, generic route-builder names, and old assistant catalog aliases passed on touched assistant-engine/assistant-cli source and tests.
- Final hard-cut pass: `pnpm --dir packages/assistant-engine typecheck` still fails only on unrelated dirty auto-reply cursor fixture/type drift in assistant-engine tests.
- Final hard-cut pass: `pnpm typecheck` still fails after assistant-engine passes, at `packages/setup-cli/test/setup-services-coverage.test.ts` on the same unrelated auto-reply cursor fixture/type drift.
- Required `coverage-write` pass completed with no test changes needed.
- Required `security-privacy-review` pass found no findings.
- Required `task-finish-review` pass found no findings.
- No scoped commit was created because overlapping pre-existing dirty edits in shared assistant-engine files would make whole-path staging include unrelated active-row work.
- Public facade pass: `pnpm --dir packages/assistant-engine typecheck` passed after sanitizing public progress/trace types.
- Public facade pass: `pnpm --dir packages/assistant-cli typecheck` passed.
- Public facade pass: `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/provider-registry-helpers.test.ts test/assistant-provider-final-coverage.test.ts test/assistant-wrapper-exports.test.ts test/provider-seams.test.ts` passed: 4 files, 37 tests.
- Public facade pass: `pnpm --dir packages/assistant-engine test:coverage` failed on unrelated concurrent auto-reply/status state-shape fixture drift in `test/assistant-status.test.ts` (`cursor` fixture vs `enabledAt`/`eligibleAfter` schema); provider-focused tests passed.
- Public facade pass: `pnpm typecheck` failed after `packages/assistant-engine` passed, in unrelated `packages/setup-cli/test/setup-services-coverage.test.ts` on the same auto-reply state-shape fixture drift.
- Public facade pass: required `coverage-write` reported no additional tests needed; required `security-privacy-review` findings were addressed by removing public raw progress/trace event exposure and keeping Codex-named catalog exports; final task-finish review pending.
- Public facade final-review fixes removed the remaining raw provider execution/usage type exports from `assistant-provider.ts`, removed the generic `AssistantCatalogModel` catalog export, and added a wrapper-export source guard for raw facade leaks.
- Public facade final-review fixes: `pnpm --dir packages/assistant-engine typecheck` passed.
- Public facade final-review fixes: `pnpm --dir packages/assistant-cli typecheck` passed.
- Public facade final-review fixes: `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/provider-registry-helpers.test.ts test/assistant-provider-final-coverage.test.ts test/assistant-wrapper-exports.test.ts test/provider-seams.test.ts` passed: 4 files, 38 tests.
- Public facade final-review fixes: `pnpm --dir packages/assistant-engine build` passed.
- Public facade final-review fixes: scoped `git diff --check` passed.
- Public facade final-review fixes: repo `pnpm typecheck` failed outside this task in `apps/web/test/hosted-execution-handoff.test.ts` because the `CloudflareHostedControlClient` test double is missing the newer `deleteUserData` method.
- Public facade final-review fixes: `pnpm --dir packages/assistant-engine test:coverage` still failed on unrelated concurrent auto-reply/status state-shape fixture drift in `test/assistant-status.test.ts` (`cursor` fixture vs `enabledAt`/`eligibleAfter` schema); 80/81 files and 710/711 tests passed before that failure.
Updated: 2026-04-29
Completed: 2026-04-29
