# PR 992 round-6 runtime dispatch remediation

Status: completed
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Make the two admitted external-completion notification families executable
  through the real foreground-causal mailbox and outbox path before the dirty
  idle checkpoint, without admitting generic notification work.

## Success criteria

- `phone-call-result` and `usage-referral-reward` notification items are
  selected by their exact durable dedupe-key families during a
  foreground-causal pass.
- An older generic notification cannot be selected ahead of either exact
  family.
- The selected notification uses the existing queue-only notification,
  checkpointed outbox, and post-checkpoint provider-drain owners.
- Fresh conversation input keeps pass-admission priority, and replay does not
  create a second provider effect.
- The canonical checkpoint invariant and PR affected-surface inventory state
  the bounded exception and its regression boundary.

## Scope

- In scope: system-mailbox selection, foreground-causal assistant phase,
  production-faithful focused tests, canonical invariant, runtime docs, and PR
  disclosure.
- Out of scope: generic notification admission, new queues or lifecycle state,
  referral reward policy, phone-call creation, provider routing, and checkpoint
  timing.

## Constraints

- Filter at the local system-mailbox selection owner; do not broadly allow all
  `dispatch-assistant-notification` actions or
  `assistant.notification.requested` wakes.
- Preserve runtime-control and Assistant Ask causal ordering.
- Keep foreground conversation admission ahead of system work.
- Preserve fixed destination, transport idempotency, checkpoint-before-send,
  and post-checkpoint provider cleanup.

## Tasks

1. [x] Add a selection predicate that can name the exact safe dedupe-key
   families.
2. [x] Add the exact notification fallback to the foreground-causal mailbox
   pass.
3. [x] Prove exact-family dispatch, generic exclusion, foreground priority, and
   replay idempotency through existing owners.
4. [x] Reconcile the canonical invariant and PR disclosure.
5. [x] Run focused and canonical verification, then commit and push.

## Verification

- The four directly affected assistant-runtime files pass together: 563 tests.
- `pnpm --dir packages/assistant-runtime typecheck` passes.
- Canonical affected-path `pnpm test:diff` passes repository guards and
  typechecks; Assistant Runtime reports 1,908 passed / 2 skipped, Cloudflare
  Node reports 1,989 passed, and Cloudflare Workers reports 2 passed.
- `pnpm verify:acceptance` passes across the full workspace, including package
  coverage, Web lint/dev smoke/production build, Cloudflare Node and Workers,
  built-package boundaries, artifact hygiene, and repository guards.
- `git diff origin/main --check` passes. The privacy scan finds no local account
  username, home-directory path, or personal email in the patch; the configured
  neutral commit name matches ordinary `Codex` ownership labels only.
Completed: 2026-07-27
