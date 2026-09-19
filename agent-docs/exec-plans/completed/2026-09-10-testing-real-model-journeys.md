# Real-model canonical assistant journey gate

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

- Prove real model choices execute production assistant planning and canonical tools, with persisted readback and silence/privacy assertions.

## Success criteria

- Three focused live journeys cover canonical meal persistence across an assistant process restart, reminder authoring/execution/cancellation, and group privacy/quiet behavior.
- A protected-main-only, bounded provider lane fails closed on missing configuration, skipped cases, or incomplete execution receipts.
- Existing deterministic protocol tests remain intact; unknown internal fixture commands never claim success.

## Scope

- In scope: assistant-engine live journey composition, fixture fidelity, protected workflow and result verifier, relevant verification owners.
- Out of scope: production secrets/data, actual member delivery, managed Cloudflare lifecycle and deployment mutations.

## Constraints

- Technical constraints: reuse production service, CLI, canonical state and process lifecycle owners; no dependencies or substitute business logic.
- Product/process constraints: synthetic data only, local subscription for focused proof, separate protected test-provider credential for CI, parent owns PR readiness and ReviewGPT.

## Risks and mitigations

1. Stochastic failures and provider spending. Run only named journeys, fixed concurrency/time budgets and zero test retries; report every failure.
2. Green skipped tests or provider-secret exposure. Preflight selected inventory and validate executed assertions; publish metadata-only receipts and no raw child output.
3. Tests prescribing production outcomes. Use natural requests, production tool selection, actual CLI/canonical writes and independent state readback.

## Tasks

1. Implement canonical production-service live journeys and remove permissive internal fake success.
2. Implement protected workflow and fail-closed executed-journey verifier with deterministic regressions.
3. Run focused deterministic tests, typechecks and individual local live journeys; update owner docs and plan evidence.
4. Commit, push and open draft PR; hand exact SHA and proof gaps to the original completion owner.

## Decisions

- The first gate proves the production assistant service and canonical state, not managed Cloudflare or external delivery. Existing hosted E2E owners cover those deterministic boundaries separately.
- Use production Linq route resolution with synthetic external route metadata and acknowledgement for the reminder. Preserve the model-created canonical automation unchanged; do not patch its target to make it execute.
- Require the delivered recurring reminder to remain enabled with an advanced next occurrence before cancellation, so a one-time reminder cannot satisfy the lifecycle proof.
- Isolate the operator HOME and CLI PATH, reuse the chosen authentication home without copying auth, and pass production named permission definitions to the actual pinned Codex binary. A credential-free native configuration probe validates those definitions before live proof.

## Verification

- Focused scripts Vitest, assistant-engine deterministic fixture contracts, assistant-engine typecheck, scripts typecheck where provided, and each selected `pnpm test:assistant:live` journey.
- Expected outcomes: actual canonical records/readback, exact reminder effects, no private content or unauthorized effects, nonzero exact executed-journey receipts.

## Evidence and handoff

- Frozen install, generated catalogs and `pnpm build:test-runtime` passed.
- Reconciled against main `d8b6cfcdbb2ce02f8646085146ebdfab2ac425b6`, preserving upstream reminder behavior and the local-daemon retirement. Reran the build, focused contracts, typechecks, actionlint and complexity guard successfully.
- Three focused deterministic fixture/configuration cases passed, including native permission configuration, actual CLI readback, and unknown-command rejection.
- `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/run-assistant-real-model-gate.test.ts scripts/run-assistant-real-codex-e2e.test.ts --maxWorkers=1` passed 41 tests. This includes real Vitest skipped-report rejection and checked-in workflow shell admission/result cases.
- Assistant Engine typecheck and repository tools typecheck passed. Actionlint passed. Complexity guard passed for the new runner, maximum 16 and no function above 20.
- After main reconciliation, each focused live case passed using `pnpm test:assistant:live -- --codex-home <AUTHENTICATED_SUBSCRIPTION_HOME> --test <EXACT_CASE_NAME>`, with `gpt-5.6-terra`. Meal save plus fresh-conversation restored-vault readback passed with two actual model turns. Reminder create/fire/cancel passed with three actual model turns, one delivered outbox record, a still-enabled next occurrence before cancel and no enabled reminder after cancel. Group privacy/quiet passed with two actual model turns and no unauthorized canonical/outbox effects. Synthetic replies reviewed: Ready; concise, truthful and matched actual effects.
- Earlier pre-model authentication attempts failed on unavailable local homes; one authenticated alternate passed and was retained for the behavioral proof. Fixture development also exposed missing audience and named-permission setup, resolved at the fixture/configuration boundary. The cron defaults issue is recorded in the task's Frog entry.
- Protected provider execution remains an external setup step: configure the main-only `assistant-real-model-sandbox` Environment and its dedicated test-project provider key. Local subscription proof does not certify the configured provider transport or private Worker egress.
- Implementation, local seven-turn proof and parent candidate review are complete. Required CI and final ReviewGPT remain pending under the original completion owner, who also owns PR readiness. The protected provider Environment remains unconfigured. No production deployment or real member delivery was performed.
Completed: 2026-09-10
