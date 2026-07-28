# Close stolen device-authorization callback relay

Status: active
Created: 2026-07-28
Updated: 2026-07-28

## Goal

- Make a hosted wearable authorization URL insufficient to attach a provider
  account to a Murph member.
- Keep Junction-backed state inert until the legitimate browser callback is
  explicitly completed.
- Catch the implicit callback-host configuration mismatch during Web build
  validation instead of at the first member request.

## Evidence

- Final ReviewGPT round 1 proved that member-only callback binding still permits
  a completed provider callback URL to be relayed into the initiating member's
  signed-in browser.
- The callback GET currently exchanges provider credentials immediately, so a
  passive top-level navigation is the final mutation authority.
- Junction start persists an active `pending_link` connection. Webhook
  admission, hosted dirty persistence, local scheduling, and local job
  execution currently check active status without consistently requiring
  `source_confirmed`; successful work can promote pending setup.
- Web build validation returns early when the explicit callback override is
  absent even though runtime derives an effective callback URL from the hosted
  public URL precedence.

## Smallest durable correction

- Bind each hosted start to a short-lived, session- and state-bound browser
  proof cookie. The provider callback GET validates that proof but performs no
  provider exchange.
- Require one same-origin POST from a clear confirmation surface before state
  consumption or provider exchange. A callback without the proof consumes only
  the OAuth state and cannot be relayed later.
- Reuse Junction's existing setup phase as the only data-admission state:
  `pending_link` is ineligible for webhook persistence, scheduling, execution,
  or success promotion. Before a replacement Link URL is issued, reuse the
  existing disconnect/revoke owner to clear any non-established Junction
  linkage; a revoke warning blocks the new start.
- Validate the effective derived callback hostname during Web build. Keep
  Cloudflare preflight's guarantee explicitly scoped to its configured
  callback override.

## Tasks

1. [x] Add browser proof issuance, callback confirmation GET, same-origin
   completion POST, safe failure rendering, and route tests.
2. [x] Make non-established Junction connections inert across webhook, hosted
   dirty state, scheduler, worker, and success-state paths.
3. [x] Revoke or block stale/non-established Junction linkage before a new
   Link URL is issued.
4. [x] Validate the implicit Web callback hostname and align deploy/operator
   documentation.
5. [x] Add the production callback component to the design catalog and capture
   desktop and mobile browser proof.
6. [ ] Run focused tests, package/Web/Cloudflare typechecks, canonical diff and
   acceptance verification, preliminary specialists, parent review, final
   ReviewGPT correction, and exact-head CI.

## Verification

- Focused callback, hosted-start, public-ingress, worker/scheduler, hosted-wake,
  URL, Next-config, and deploy-preflight Vitest suites.
- `pnpm --dir packages/device-syncd typecheck`
- `pnpm --dir apps/web typecheck`
- `pnpm --dir apps/cloudflare typecheck`
- `pnpm test:diff packages/device-syncd apps/web apps/cloudflare`
- `pnpm verify:acceptance`
- design-catalog desktop and mobile browser proof
  (`audit-packages/pr-1059-design-proof/{desktop,mobile}-{confirmation,failure}.png`)
- preliminary `completion-specialists` ReviewGPT
- final exact-head ReviewGPT correction and PR CI
