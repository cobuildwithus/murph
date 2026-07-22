# PR 859 direct-route authority retrospective and remediation

Status: completed
Created: 2026-07-22
Updated: 2026-07-22

## Goal

- Preserve the automatic meal closeout outcome while making the existing Web
  member-routing state the only mutable recipient authority from capture
  admission through scheduled execution and provider entry.
- Remove copied direct-route state that can become stale in the mailbox wake,
  managed automation, cron authorization, or outbox.

## ReviewGPT retrospective

- Original requirement: the first accepted automatic meal capture installs one
  private 9pm-local closeout, summarizes the day's supported nutrition, removes
  eligible automatic meal photos only after analysis, and delivers to the
  member's current private Murph conversation.
- First-reviewed shape: capture admission and automation creation selected a
  saved route without authoritative private-route proof.
- Round-2 shape: the remediation copied a Web-validated direct route through
  the wake, automation creation, cron target, outbox authority, and provider
  payload. That added 225 authored source lines but left the durable automation
  unable to follow a later route change and let direct Telegram automation
  dispatch skip the final provider-entry assertion.
- Decision: redesign by deletion. Web-owned member routing remains the single
  mutable authority. Capture admission requires that owner to have a direct
  route but does not serialize the route into the wake. Import and scheduled
  execution resolve the current route from that owner. The automation route is
  only a scheduler locator. Direct automated Telegram delivery rechecks the
  same owner at provider entry and fails closed before any provider call when
  the channel or target changed.
- Rejected expansion: no new durable route owner, route reconciliation loop,
  compatibility state machine, scheduler, queue, migration, or repair pass.

## Success criteria

- A capture accepted on route A can be followed by a route change to B; the
  existing closeout runs once and targets only B.
- A direct Telegram route change or access revocation after outbox persistence
  causes zero provider calls to A for text, image, reaction, and voice paths.
- Photo analysis/removal remains exactly once and is not coupled to copied
  route state.
- Explicit one-seed managed automation application still cannot reconcile
  onboarding.
- The remediation removes redundant route representations and yields a simpler
  source shape than round 2.

## Tasks

1. Record this retrospective in the PR intent contract.
2. Add a read-only current-direct-route resolver over existing Web member
   routing and expose it through the hosted effects boundary.
3. Remove direct-route snapshots from meal-photo wakes and direct authority
   fields from generic external-thread authority.
4. Resolve the closeout target live before model/tool work and recheck it before
   tool, commit, and delivery boundaries.
5. Recheck direct automated Telegram target authority at provider entry for
   every supported Telegram transport.
6. Add route-change, stale-outbox, access-revocation, photo-cleanup, and
   onboarding-isolation regression proof.
7. Run focused checks, canonical diff/acceptance verification, final-head CI,
   and ReviewGPT round 3 before merge.

## Verification

- Focused Web route/capture/mailbox tests passed: 82 tests.
- Focused Cloudflare web-control tests passed: 340 tests.
- Hosted execution passed: 382 tests.
- Focused assistant-engine cron/outbox/managed-automation tests passed: 261
  tests, including current-route delivery and pre-effect route change.
- Focused assistant-runtime import/workspace/callback tests passed: 454 tests,
  including zero provider calls for stale direct Telegram text, image,
  reaction, and voice delivery plus access revocation and exact-route success.
- Touched-owner typechecks passed for Web, Cloudflare, hosted execution,
  assistant engine, and assistant runtime.
- Canonical `pnpm test:diff` passed all architecture guards, affected
  typechecks, 12 affected package suites, and the package-boundary build. Its
  app lane could not acquire the exclusive shared-host slot because a
  separately owned acceptance process retained it; the waiting command was
  cancelled without signaling that process. Focused Web and Cloudflare app
  suites passed as the next-best validation.
- Exact pushed-head CI and ReviewGPT round 3 remain required before merge.
Completed: 2026-07-22
