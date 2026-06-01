# Prioritize Junction WHOOP connect target

Status: completed
Created: 2026-06-01
Updated: 2026-06-01

## Goal

- When Junction is configured for WHOOP, the public `whoop` connect target should resolve to Junction by default instead of direct WHOOP OAuth.
- Preserve direct WHOOP availability for reconnect/fallback surfaces that intentionally list every configured route.

## Success criteria

- `device connect whoop` and hosted connect-by-source lookup resolve to `provider: "junction"` with `sourceProviderSlug: "whoop"` when both Junction WHOOP and direct WHOOP credentials are configured.
- Direct WHOOP still appears in reconnect targets where duplicate source IDs are allowed.
- Existing Oura/Strava/direct-provider behavior is unchanged.
- Focused regression tests plus required repo verification pass or have a documented unrelated blocker.

## Scope

- In scope: device-sync connect target collection/resolution and focused tests.
- Out of scope: provider import logic, webhook ingestion, Junction resource mapping, database schema, UI copy.

## Constraints

- Technical constraints: keep the change at the existing connect-target routing layer; do not add a new provider abstraction.
- Product/process constraints: preserve unrelated dirty work; avoid exposing personal identifiers in code, docs, logs, or commit text.

## Risks and mitigations

1. Risk: A broad route-order change could unintentionally move Oura or Strava from direct OAuth to Junction.
   Mitigation: Make the Junction preference source-specific for WHOOP.
2. Risk: Removing direct WHOOP entirely would reduce recovery options.
   Mitigation: Keep direct WHOOP in reconnect targets by only applying the preference to source-ID-deduped connect target lists.

## Tasks

1. Trace connect target collection and relevant tests.
2. Add a narrow Junction-preferred WHOOP rule in the existing collector.
3. Add regression coverage for public connect target resolution and reconnect fallback.
4. Run focused and required verification.
5. Run completion audits and commit the scoped change.

## Decisions

- Prefer Junction over direct WHOOP only when the public target list dedupes by `connectSourceId`; reconnect target listings should still include both configured routes.
- After security/privacy audit, add explicit negative coverage proving direct WHOOP stays direct when Junction is configured but its provider filter excludes WHOOP.

## Verification

- Passed: `pnpm --dir packages/device-syncd test -- connect-targets.test.ts config.test.ts`.
- Passed: `pnpm typecheck`.
- Passed: `pnpm test:smoke`.
- Passed: `bash scripts/workspace-verify.sh test:diff packages/device-syncd/src/config/connect-targets.ts packages/device-syncd/test/connect-targets.test.ts`.
- Security/privacy audit: no findings; negative WHOOP-filter coverage added for the residual test gap.
- Coverage-write audit: no edits; coverage sufficient; audit reran scoped diff verification successfully.
- Task-finish review: pending.
Completed: 2026-06-01
