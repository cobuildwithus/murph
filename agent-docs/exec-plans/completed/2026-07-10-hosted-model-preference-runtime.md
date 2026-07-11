# Hosted Model Preference Runtime Repair

Status: completed
Updated: 2026-07-10

## Goal

Make an Edge member's saved Sol selection take effect on the next hosted
assistant invocation, and make the locked Sol option discoverable to Pulse
members with a clear Edge upgrade action.

## Constraints

- Treat the web-owned member preference as the only durable product truth.
- Do not require a new scheduler, cache, persisted state, or manual runtime
  restart when each invocation can consume the current signed workspace fact.
- Keep Sol billing-gated to Edge and preserve Terra as the default/fallback.
- Implement the user-facing `apps/web` change directly under the user's
  explicit override after the approved Fable routes proved unavailable.
- Preserve safe web/Worker/container deploy skew and document any coordinated
  rollout requirement.

## Evidence and implementation path

1. Trace settings mutation -> member preference persistence -> signed workspace
   read -> Cloudflare invocation config -> assistant execution target.
2. Prove the failing boundary with focused static and deployed-revision
   evidence before choosing the smallest fix.
3. Implement the settings-page locked Sol row and upgrade action directly,
   then review the resulting diff locally.
4. Run focused owner verification, required completion audits, direct scenario
   proof, and final parent review.
5. Close this plan with a scoped commit, push a PR branch, and complete the
   required PR ReviewGPT/CI gate unless an external service blocks it.

## Verification target

- An Edge member changing Terra -> Sol receives Sol on the next invocation
  after the current run closes, without an additional cache, snapshot-expiry,
  or manual-restart wait.
- A Pulse member sees Sol as locked, sees that Edge unlocks it, and can start
  the existing Edge upgrade flow.
- Existing Edge selection, downgrade, invalid-plan, and default Terra behavior
  remain covered.

## Root cause

Confirmed deployment skew, not a persistence or model-selection code defect.
The production web surface includes the Settings producer and saves the Sol
intent, while the latest successful Cloudflare hosted-execution deployment was
built from a revision that does not contain the optional workspace-response
consumer. The deployed runner therefore keeps the fleet Terra model.

## Deployment concerns

Redeploy Cloudflare hosted execution from a current revision containing the
Edge model consumer. The response field is additive, so web/Worker skew is
safe; after convergence, an already-active invocation may retain its previous
model snapshot through the bounded 180-second idle window, while the next new
invocation consumes the saved Sol preference. No new runtime code, state,
queue, or restart mechanism is justified.

## Frontend implementation route

The primary Claude profile reports exhausted Fable credits, and the secondary
approved profile's OAuth session is expired and cannot refresh. The user
explicitly authorized direct implementation after those routes proved
unavailable.
Completed: 2026-07-10
