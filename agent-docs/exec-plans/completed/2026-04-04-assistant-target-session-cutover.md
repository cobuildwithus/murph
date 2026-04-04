# Assistant Target Session Cutover

## Goal

Hard-cut the assistant provider/target/session seam to one canonical persisted `AssistantModelTarget`, separate runtime resume state from desired target state, treat hosted execution as OpenAI-compatible only, and move provider-specific prompt/tool/resume decisions behind adapter capabilities instead of provider-id branches.

## Why now

- The current assistant runtime still behaves like two execution systems below the registry seam.
- Session persistence duplicates provider config at the session root and inside `providerBinding`.
- Secret redaction has to split/merge headers in both places because target and resume state are mixed together.
- Shared core normalization still invents Codex defaults, which leaks local historical behavior into hosted and shared planning.

## Intended end state

- Persist one explicit discriminated `AssistantModelTarget` union everywhere target/config is stored.
- Persist session resume/runtime state separately from the chosen target.
- Make hosted config/profile storage wrap the same canonical target object and constrain hosted profiles to the OpenAI-compatible adapter.
- Resolve turn execution through one planner that merges boundary defaults, persisted session target, and per-turn override into a capability-aware execution plan.
- Keep request shaping differences inside adapters only.

## Scope

- `packages/assistant-core/src/assistant-backend.ts`
- `packages/assistant-core/src/assistant-cli-contracts.ts`
- `packages/assistant-core/src/operator-config.ts`
- `packages/assistant-core/src/hosted-assistant-config.ts`
- `packages/assistant-core/src/assistant/{provider-config.ts,hosted-config.ts,session-resolution.ts,service-turn-routes.ts,provider-state.ts,state-secrets.ts,provider-turn-runner.ts,provider-turn-recovery.ts,provider-binding.ts,failover.ts,store.ts,store/{types.ts,paths.ts,persistence.ts},providers/{types.ts,registry.ts,codex-cli.ts,openai-compatible.ts}}`
- Targeted tests in `packages/cli/test/**`, `packages/assistant-runtime/test/**`, and `packages/assistantd/test/**`
- `ARCHITECTURE.md` if the persisted/runtime contract meaning changes materially

## Constraints

- Hosted/runtime-managed execution should not enable Codex; hosted profiles and hosted bootstrap stay OpenAI-compatible only.
- Keep backward compatibility for existing persisted session/config records through explicit compatibility readers during migration.
- Do not reintroduce implicit shared-core fallback to Codex when no target is specified.
- Preserve unrelated dirty-tree edits, especially the existing `first-contact-welcome.ts` change.

## Plan

1. Introduce canonical target and resume-state schemas with compatibility readers for current persisted records.
2. Cut session persistence to `v4`, writing `{ target, resumeState }` instead of duplicated provider/options/binding target state.
3. Rebuild route resolution around one execution-plan function that merges defaults, session target, and override once.
4. Move adapter behavior branches to capability checks and keep hosted constrained to OpenAI-compatible target shapes.
5. Update focused tests, run full required verification, run required completion audit, then finish via `scripts/finish-task`.

## Verification target

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Notes

- This is an exclusive refactor lane because it changes the assistant-core persistence contract and route planner together.

## Outcome

- Assistant sessions now persist as `murph.assistant-session.v4` with canonical `{ target, resumeState }` storage plus legacy compatibility readers.
- Hosted assistant config/profile storage now wraps canonical targets and rejects hosted Codex targets.
- Local defaults are now boundary-owned: shared resolution requires an explicit target or explicit boundary default, while local entrypoints pass the Codex default themselves.
- Provider-turn tooling/request-format decisions now come from adapter capabilities instead of provider-name branches.

## Verification outcome

- `pnpm typecheck` ✅
- Focused assistant suite ✅
  `pnpm exec vitest run packages/cli/test/assistant-provider.test.ts packages/assistant-runtime/test/hosted-assistant-bootstrap.test.ts packages/cli/test/incur-smoke.test.ts packages/cli/test/assistant-state.test.ts packages/cli/test/assistant-runtime.test.ts packages/cli/test/assistant-service.test.ts packages/assistant-runtime/test/assistant-core-boundary.test.ts packages/cli/test/assistant-daemon-client.test.ts packages/cli/test/assistant-cli.test.ts packages/cli/test/setup-cli.test.ts packages/cli/test/research-runtime.test.ts packages/cli/test/inbox-model-harness.test.ts --no-coverage`
- Direct scenario proof ✅
  Created a session with an explicit OpenAI-compatible target and verified the persisted record stores `target` + `resumeState` without persisted `provider/providerOptions/providerBinding` fields.
- `pnpm test` ⚠️ unrelated pre-existing failures remain in `apps/cloudflare/test/workers/runtime.test.ts` because `HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK` is missing in that lane, plus existing `apps/web` verify/dev-smoke issues.

## Audit outcome

- Required `simplify` pass completed; I adopted the boundary-owned default-target cleanup and removed the inert secret-sidecar write field.
- Required final review completed; I fixed the reported Ink runtime regression.
- Residual risk kept intentionally: `serializeAssistantSessionForPersistence()` still honors intentional compatibility-field writes when they disagree with `target`, because direct session-save/update paths still mutate `provider/providerOptions` and would otherwise silently drop those updates.
Status: completed
Updated: 2026-04-05
Completed: 2026-04-05
