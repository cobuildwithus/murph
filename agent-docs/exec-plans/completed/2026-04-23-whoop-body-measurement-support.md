# Support WHOOP body measurements without overscoping

Status: completed
Created: 2026-04-23
Updated: 2026-04-24

## Goal

- Make WHOOP body-measurement support real and least-privilege: fetch the scoped body endpoint when available, normalize useful body observations, and stop forcing the scope back on when operators explicitly override scopes.

## Success criteria

- WHOOP scheduled imports fetch `/v2/user/measurement/body` only when the account has `read:body_measurement`.
- WHOOP snapshots normalize body-measurement payloads into canonical observations instead of only raw artifacts/provenance bits.
- WHOOP operator scope overrides may omit `read:body_measurement` without the runtime silently re-adding it.
- Descriptor, tests, and docs accurately reflect the supported WHOOP body-measurement behavior.
- Focused `packages/device-syncd` and `packages/importers` verification, required audits, and a scoped commit complete or any unrelated blocker is documented precisely.

## Scope

- In scope:
  - `packages/device-syncd/src/providers/whoop.ts`
  - `packages/device-syncd/test/{whoop-provider,provider-descriptor-integration}.test.ts`
  - `packages/importers/src/device-providers/{provider-descriptors,whoop}.ts`
  - `packages/importers/test/device-providers.test.ts`
  - `docs/device-provider-compatibility-matrix.md`
  - `agent-docs/exec-plans/active/{2026-04-23-whoop-body-measurement-support.md,COORDINATION_LEDGER.md}`
- Out of scope:
  - broader WHOOP webhook/event redesign
  - new canonical record kinds for device body imports
  - non-WHOOP provider scope-policy changes

## Constraints

- Technical constraints:
  - Work safely in the current dirty tree and avoid unrelated provider or hosted edits.
  - Keep WHOOP connect-time metadata shallow; support body sync through scheduled imports rather than persisting sensitive connect-time metadata.
  - Treat WHOOP body measurements as the current scoped endpoint documented by WHOOP rather than inventing historical body timelines the API does not provide.
- Product/process constraints:
  - This is a privacy/least-privilege fix as well as a normalization fix; do not keep requesting sensitive body scope without using it.
  - Follow the plan-bearing repo workflow, including required completion audits.

## Risks and mitigations

1. Risk: The WHOOP body endpoint is a current snapshot without a documented measurement timestamp, so naive normalization could create noisy duplicates.
   Mitigation: Normalize it as a daily body snapshot keyed to the import day with stable provider external refs and focused regression coverage.
2. Risk: Changing WHOOP scope composition could accidentally drop required defaults for existing installs.
   Mitigation: Keep defaults when no override is supplied, but treat explicit `config.scopes` as authoritative and add a regression test.

## Tasks

1. Register the task in the active plan and coordination ledger.
2. Update WHOOP scope handling so explicit overrides are authoritative while defaults still apply when no override is configured.
3. Fetch the WHOOP body-measurement endpoint during scheduled imports only when the account has the matching scope.
4. Normalize WHOOP body-measurement payloads into canonical body observations and preserve raw evidence/provenance.
5. Update focused tests/docs, run verification, complete required audits, and create a scoped commit when the dirty tree permits it.

## Decisions

- Keep WHOOP body-measurement support in place rather than removing the scope, because the repo already models body metrics and WHOOP documents a dedicated body-measurement endpoint.
- Treat explicit WHOOP scope configuration as authoritative so operators can disable sensitive access they do not want.
- Map WHOOP body measurements onto existing observation metrics instead of introducing a new device-specific canonical body record shape.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test:diff packages/device-syncd/src/providers/whoop.ts packages/device-syncd/test/whoop-provider.test.ts packages/device-syncd/test/provider-descriptor-integration.test.ts packages/importers/src/device-providers/provider-descriptors.ts packages/importers/src/device-providers/whoop.ts packages/importers/test/device-providers.test.ts docs/device-provider-compatibility-matrix.md`
- Direct proof:
  - Focused WHOOP provider tests proving the body endpoint is fetched only with `read:body_measurement`.
  - Focused importer tests proving WHOOP body measurements become normalized observations instead of raw-only retention.
- Expected outcomes:
  - Typecheck passes.
  - The truthful diff-aware verification lane covers both touched owner packages and the doc update.
  - WHOOP body sync and scope-override regressions pass.

## Outcome

- Implemented:
  - WHOOP window imports fetch `/v2/user/measurement/body` only when the account has `read:body_measurement`.
  - WHOOP snapshots normalize body observations for `weight`, `bmi`, and `max-heart-rate`.
  - Explicit WHOOP scope overrides may now omit sensitive scopes; an explicit empty override resolves to the required base scopes only.
  - WHOOP resource jobs now enforce the required granted scopes and skip unauthorized resource imports without issuing API requests.
  - Body-measurement normalization prefers true measurement timestamps over generic update timestamps.
- Focused proof completed:
  - `pnpm --filter @murphai/device-syncd exec vitest run --config vitest.config.ts test/whoop-provider.test.ts --no-coverage`
  - `pnpm --filter @murphai/device-syncd exec vitest run --config vitest.config.ts test/provider-descriptor-integration.test.ts -t "WHOOP" --no-coverage`
  - Direct scenario: explicit empty WHOOP scope override resolves to `["offline","read:profile"]`.
  - Direct scenario: importer body measurement timing uses `measured_at` ahead of `updated_at`.
- Blockers outside this task:
  - `pnpm typecheck` is currently blocked by unrelated merge-conflict markers in `packages/contracts/src/automation.ts`.
  - `pnpm test:diff ...` is blocked by the same unrelated contracts merge-conflict markers.
  - Full `packages/importers` vitest reruns became blocked for the same reason after those unrelated conflict markers appeared in the dirty tree.
- Landing status:
  - No scoped commit was created because the same WHOOP files and the shared coordination ledger already contain unrelated in-progress edits from other active lanes, so a path-level commit would absorb work outside this task.
Completed: 2026-04-24
