# Device Feature Context

Status: completed
Created: 2026-07-09
Updated: 2026-07-09

## Goal

- Prevent product-discovery automations from pitching wearable connection to a recipient who already has an active device connection.
- Give hosted background assistant turns a minimal, current connected-device fact using the existing device-sync snapshot boundary.

## Success criteria

- Healthy active wearable connections appear in background dynamic context without exposing account identifiers, credentials, raw health values, or provider payloads.
- Existing reconnect-required guidance remains intact.
- Product discovery drops `connect-wearables` for active connections and drops any catalog item whose prior-use status cannot be established confidently.
- Focused tests cover healthy, reconnect-required, disconnected, and unavailable device context plus the managed prompt contract.

## Scope

- In scope: hosted device-sync background prompt rendering, managed product-note instructions, focused assistant-runtime and assistant-engine tests, directly matching durable runtime documentation if behavior changes materially.
- Out of scope: new persisted state, device-sync scheduling, provider API behavior, catalog schema changes, health-value reads, or broad feature eligibility infrastructure.

## Constraints

- Reuse existing device snapshot and CLI account-list boundaries.
- Keep context metadata-only and provider-label-level.
- Preserve foreground reply priority and bounded background status reads.
- Preserve reconnect command safety and provider identity rules.

## Risks and mitigations

1. Risk: broader background context could expose unnecessary device metadata.
   Mitigation: render only normalized product labels and coarse active/reconnect state.
2. Risk: unknown or unavailable device status could still become a false negative.
   Mitigation: require positive unused evidence; unknown prior-use status is ineligible for discovery.
3. Risk: web/runner deploy skew.
   Mitigation: no schema or API contract change; old and new web/runner combinations remain compatible.

## Tasks

1. Confirm current snapshot status semantics and prompt injection path.
2. Implement minimal active-device background context.
3. Tighten managed feature-discovery eligibility guidance.
4. Add focused regression coverage and direct scenario proof.
5. Run required verification and audits, finish the scoped commit, open a PR, and complete the PR review loop.

## Decisions

- Use the existing device-sync snapshot as the sole current connection source; do not derive active connectivity from historical wearable data.
- Read that snapshot once without credential material instead of issuing and merging one filtered request per configured provider.
- Project only product labels and coarse active, reconnect-required, or absent state; treat a failed read as unknown and emit no context.
- Do not add structured feature predicates or new persisted eligibility state for this single confirmed defect.

## Verification

- `pnpm test:diff packages/assistant-runtime/src/hosted-runtime/device-sync-status-prompt.ts packages/assistant-runtime/test/hosted-runtime-device-sync-status-prompt.test.ts packages/assistant-engine/src/assistant/managed-automations.ts packages/assistant-engine/test/managed-automations.test.ts packages/assistant-engine/test/managed-automations-core.test.ts`
- Focused assistant-runtime and assistant-engine tests during iteration.
- Focused result: 263 tests passed across the managed automation and hosted device-context paths.
- Full workspace `pnpm typecheck` passed across all packages and apps; `pnpm docs:drift` passed.
- Direct scenario passed: an active WHOOP connection reached the prompt without synthetic account/user/connection markers or reconnect guidance.
- Diff-aware verification reached all affected typechecks plus 128 assistant-cli, 1,993 assistant-engine, and 1,479-1,483 assistant-runtime passing tests, but changing unrelated timing and temporary-directory races in untouched hosted workspace runner/entrypoint tests blocked a clean full-runtime result. The runner file passed 79/79 in isolation; the entrypoint file passed 191/192 with only an unrelated elapsed-time threshold failure.
- Security/privacy audit: zero evidence-backed medium-or-higher findings.
- Coverage-write audit added source-less active-account and display-metadata privacy proof; no unresolved coverage gaps remain.
- Required security/privacy and coverage-write audits and parent final review completed; PR ReviewGPT and final PR CI remain.
Completed: 2026-07-09
