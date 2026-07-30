# Preserve callback privacy and established Junction siblings

Status: completed
Created: 2026-07-28
Updated: 2026-07-28

## Goal

- Keep provider authorization parameters out of hosted telemetry on both
  device-sync callback page families.
- Preserve established Junction-backed sibling sources when a member starts,
  abandons, retries, or completes another Junction-backed source.
- Keep only the unconfirmed target source inert before browser completion.

## ReviewGPT evidence to reproduce

- The callback confirmation pages render under the root telemetry component,
  while the existing analytics redaction owner does not suppress either
  callback pathname or remove its authorization query.
- Junction Link flows share one stable provider account per Murph member.
  Starting another source may reuse that row and overwrite its account-level
  setup phase to `pending_link`, causing the new account-wide pending gates to
  suspend established sibling sources.
- Retrying the abandoned addition may then route through whole-account
  disconnect/revoke and deregister established sibling providers.
- A webhook admitted just before the shared phase changes may currently be
  acknowledged without durable dirty work or a wake.

## Smallest durable correction

- Extend the existing telemetry suppression owner to suppress both callback
  page families before vendor components mount and in both vendor
  `beforeSend` guards.
- Prove the Junction account/source ownership path before editing. Preserve an
  established shared account and use existing source/OAuth-state ownership to
  gate and clean up only the unconfirmed target source. Reserve whole-account
  disconnect/revoke for explicit connection-wide disconnect.
- Do not add another durable account, queue, manager, or lifecycle.

## Tasks

1. [x] Reproduce callback telemetry mounting and URL forwarding for both path
   families.
2. [x] Reproduce the established-Garmin/add-Fitbit lifecycle through account
   reuse, pending admission, callback abandonment, and retry cleanup.
3. [x] Implement the smallest owner-aligned telemetry and Junction corrections.
4. [x] Add focused regression coverage for privacy, sibling continuity,
   source-scoped cleanup, races, and successful completion.
5. [x] Run focused verification, affected typechecks, canonical diff,
   acceptance, preliminary specialists if required, parent review, and close
   the plan for the next exact-head ReviewGPT correction and CI.

## Verification

- Focused Vercel telemetry component and redaction tests.
- Focused hosted callback/start/wake and device-sync ingress/service/store
  tests.
- Device-sync, Web, and Cloudflare typechecks as affected.
- `pnpm test:diff packages/device-syncd apps/web apps/cloudflare`
- `pnpm verify:acceptance`
- final exact-head ReviewGPT correction and PR CI

Completed local evidence:

- Device-sync: 44 files and 871 tests passed with coverage thresholds met.
- Web: 544 files and 6,974 tests passed; lint completed with zero errors; the
  production build completed with 219 routes.
- Cloudflare: 108 Node files and 2,016 tests passed; 2 Workers files and 2 tests
  passed.
- The canonical diff command and the clean acceptance rerun both passed.
- The existing preliminary specialist pass and the parent review are complete.
  The final exact-head ReviewGPT correction and PR CI follow the scoped commit.
Completed: 2026-07-28
