# Recover foreground runtime startup without the stale retry grace

Status: completed
Created: 2026-09-04
Updated: 2026-09-04

## Goal

- Start the existing trusted Web-direct runtime hint as soon as a foreground
  mailbox append has committed, while retaining Temporal as the durable wake
  owner and preserving the current write-fence convergence contract.

## Success criteria

- Assistant Ask request and completion handoffs dispatch the Web-direct hint
  before waiting for Temporal signal acceptance.
- The handoff still waits for and surfaces Temporal signal failure, so durable
  recovery ownership is unchanged.
- The direct hint remains payload-free, best-effort, bounded, and unable to
  create mailbox or processing authority on its own.
- The private Temporal worker consumes the released hosted-execution timeout
  default that gives container readiness the intended startup budget.
- Focused Web and private worker tests pass, exact-head CI is green, and the
  required ReviewGPT gates are resolved.

## Scope

- In scope: Web mailbox-wake ordering, focused ordering/failure tests, owning
  reliability and runtime docs, and the linked private dependency upgrade.
- Out of scope: new queues or schedulers, new persisted state, changing the
  Cloudflare write-fence grace, changing standby capacity, or guaranteeing
  that every cold start meets a latency SLO.

## Evidence

- The delayed production attempt gave the callback-signed Temporal request the
  fresh fence first. Its stale 10-second command timeout left about eight
  seconds for container readiness after the existing response and outer-guard
  margins, then preserved the unsettled startup fence for the 30-second grace.
- The Web-direct hint was not dispatched until after Temporal signaling and
  consequently converged behind that fence instead of receiving the existing
  trusted foreground standby admission.
- The released hosted-execution package already raises the shared command
  timeout default to 20 seconds; the private worker remains pinned to the prior
  release.

## Architecture

- Authority remains explicit: the committed mailbox row is durable work,
  Temporal owns durable retry, and Web-direct remains only a latency hint.
- Reorder the two existing post-commit operations; add no owner, state, or
  protocol shape.
- Keep the direct promise attached to Next.js `after()` so the response
  lifecycle does not truncate it, while still awaiting the bounded Temporal
  signal before the handoff returns.
- Upgrade the private worker's exact shared package version rather than copying
  the timeout into another repository.

## Product UX

- Classification: Product UX Patch.
- Affected people: a member sending the first foreground message after the
  hosted runtime has gone cold, plus a member whose durable Temporal signal is
  temporarily unavailable.
- Expected result: the foreground latency hint begins immediately; durable
  signal errors remain visible to the caller and replay behavior is unchanged.
- Walkthrough proof: deterministic ordering, unsettled-signal, rejection, and
  no-wait tests; no visual representation changes.

## Deployment compatibility

- The Web ordering change and the private package upgrade are independently
  backward compatible with the current Cloudflare Worker request shape.
- Safe order: either linked PR may deploy first; full protection requires both.
- Rollback: either change can be reverted independently because neither writes
  a new state or protocol shape.
- Post-deploy proof: one bounded foreground cold-start trace should show the
  direct attempt dispatched before the Temporal ensure and no startup-grace
  stall; aggregate typed timing fields only.

## Tasks

1. Add the focused Web regression before changing implementation.
2. Reorder the existing post-commit operations and update owner comments/docs.
3. Upgrade the private exact dependency and lockfile with a focused default
   timeout regression.
4. Run focused tests, typechecks, Product UX walkthrough, diff/complexity and
   privacy review.
5. Commit exact allowlists, open linked draft PRs, push the exact candidates,
   and start CI plus required ReviewGPT gates concurrently.

## Verification

- Public: focused hosted-mailbox-wake tests, relevant Web typecheck, docs/readback,
  `git diff --check`, complexity diff, exact-head CI, final ReviewGPT.
- Private: focused timeout/Temporal environment tests, `pnpm verify`, lockfile
  integrity, exact-head CI, preliminary completion review, final ReviewGPT.
- Local public evidence: 61 focused Web tests pass; the prepared Web typecheck
  and changed-file ESLint pass; `git diff --check`, privacy review, and
  `pnpm complexity:diff` pass with no changed hotspot above 20.
- Product UX walkthrough: the authorized foreground direct hint starts before
  an unsettled Temporal signal, the caller still waits for durable signaling,
  Temporal rejection remains visible, and inactive or wrong-owner access starts
  no direct hint.
- Stop condition: both PRs are open at reviewed exact heads with required gates
  green, or a concrete external blocker is reported.
Completed: 2026-09-04
