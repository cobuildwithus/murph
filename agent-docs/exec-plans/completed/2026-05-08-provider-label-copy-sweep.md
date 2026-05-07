# Remove Junction from browser-facing provider copy

Status: completed
Created: 2026-05-08
Updated: 2026-05-08

## Goal

- Remove user-facing "Junction" copy from hosted web wearable surfaces by resolving browser copy to the underlying connected source label (Oura, Garmin, Fitbit, etc.) while preserving `junction` as the backend provider identity.

## Success criteria

- `/connect`, `/home` sidebar status, device-sync completion, settings wearables, privacy/settings copy, and static public app copy do not show "Junction" to ordinary users.
- Account export and deletion response payloads expose browser-safe `providerLabel` values for wearable data instead of raw intermediary provider ids.
- Backend provider keys, routes, and tests may still use `junction` where they describe stored/provider identity.
- Focused tests prove a Junction-backed connected source displays the underlying source label and does not render a `Junction - ...` display name.

## Scope

- In scope:
- Hosted web presentation/copy in `apps/web`.
- Hosted web docs/env prose that describes browser-facing wearable behavior.
- Focused hosted-web tests for settings/source shaping and callback/completion copy.
- Out of scope:
- Renaming backend provider ids, routes, env vars, webhook paths, database fields, package internals, or historical docs.

## Constraints

- Technical constraints:
- Keep the architecture simple: one presentation-layer label resolver over existing connection-source data; no page-by-page source-specific branching.
- Preserve stored provider identity for auth, routing, webhooks, sync, and deletion.
- Product/process constraints:
- Avoid vendor/intermediary naming in user-facing copy when the user chose a specific wearable/source.
- Preserve privacy guardrails: no personal identifiers in code, docs, logs, or commits.

## Risks and mitigations

1. Risk: Hiding the internal provider label could obscure operational identity.
   Mitigation: Keep `source.provider` unchanged and only change browser-facing labels.
2. Risk: Multi-source connections do not have a single underlying provider.
   Mitigation: Use a neutral aggregate label such as "2 wearables" instead of the intermediary name.

## Tasks

1. Find remaining browser-facing `Junction` references in `apps/web`.
2. Add one settings-source label resolver that prefers connected upstream source labels.
3. Update static public/settings copy that names the intermediary.
4. Add focused regression coverage.
5. Run focused verification and stale-string checks.

## Decisions

- Use `providerLabel` as the browser-facing label in settings-source responses; `provider` remains the persisted provider key.
- Use the hosted web provider-label helper as the fallback boundary for intermediary provider labels so callback and messaging fallbacks stay browser-safe without duplicating page logic.
- Use sentence-specific copy (`your wearable source`) only in callback notices when the underlying source is missing.
- Reuse the same source-label resolver for settings and privacy export/deletion projection so source-specific labels are not duplicated page by page.

## Verification

- Commands to run:
- `pnpm exec vitest run apps/web/test/device-sync-settings-surface.test.ts apps/web/test/device-sync-connect-complete-page.test.* apps/web/test/connect-page.test.ts apps/web/test/dashboard-sidebar.test.ts apps/web/test/device-sync-settings-routes.test.ts apps/web/test/hosted-account-data-service.test.ts apps/web/test/hosted-data-privacy-settings.test.ts --config apps/web/vitest.workspace.ts --no-coverage`
- `pnpm --dir apps/web lint`
- `pnpm typecheck`
- `rg -n -S "Junction|junction" apps/web/app apps/web/src ...` focused stale-string scans for browser-facing code.
- Expected outcomes: focused tests, lint, and typecheck pass; stale-string scan shows only backend/internal identifiers or none in user-facing copy.
Completed: 2026-05-08
