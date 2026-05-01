# Junction Webhook Final Cleanup

Status: active
Created: 2026-05-01
Updated: 2026-05-01

## Goal

Land the reviewed Junction webhook cleanup patch on the current checkout.

Success criteria:

- Junction webhook parsing accepts documented top-level and nested user ids.
- Junction source-provider extraction accepts documented `source.provider` and related camel/snake/provider shapes.
- Svix signature parsing handles comma-delimited v1 signatures, multiple signatures, URL-safe base64, and missing padding without adding dependencies.
- Junction importer source-origin extraction uses one shared source-provider path list.
- Libre/Abbott floating timestamps are not silently normalized as UTC sample times.
- Focused Junction tests, typecheck, and repo-required reviews/checks are run or any unrelated blockers are recorded.

## Scope

In scope:

- `packages/device-syncd/src/providers/junction.ts`
- `packages/importers/src/device-providers/junction.ts`
- Focused tests under `packages/device-syncd/test/**` and `packages/importers/test/**` if coverage is missing.
- A device-syncd webhook-trace test fixture date may be hardened if the required package test suite is blocked by the May 2026 retention cutoff.

Out of scope:

- New providers or pseudo-providers.
- Inline webhook data import.
- Source-aware query policy, SDK-only Junction sources, or broader CGM policy.
- Account storage, hosted settings UI, or app/web runtime changes unless required by a compile/test failure caused by this cleanup.

## Decisions

- Treat the supplied patch as behavioral intent because the patch file is malformed for `git apply`.
- Preserve the greenfield Junction architecture: provider `junction`, provider-config auth, external-link connection flow, source provenance in `DeviceDataOrigin`, and webhooks as freshness/job triggers.
- Keep source-provider parsing explicit and bounded to known Junction/provider shapes.
- For source providers whose Junction timestamps are documented as floating, preserve floating semantics and avoid using a reconcile window end as a fake observed sample time.

## Verification Plan

Minimum checks:

```txt
pnpm typecheck
pnpm --dir packages/device-syncd test
pnpm --dir packages/importers test
pnpm verify:acceptance
git diff --check
```

Focused coverage should include:

```txt
source.provider
data.provider
comma-delimited svix-signature
top-level plus nested user_id
Libre/Freestyle floating timestamps
```

## Current State

- Active Junction primitive/polling/source plans already exist and must be preserved.
- The current worktree has unrelated active dirty files outside this cleanup.
- The two target Junction files are clean before this plan starts.
- `pnpm --dir packages/device-syncd test` exposed a date-sensitive unrelated store test that used `2026-04-01`, which now falls outside the 30-day processed-webhook retention window; the fixture date was moved forward without changing production store behavior.
