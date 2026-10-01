# Approval Wake And Flat Generated-Delivery Cleanup

Status: completed
Updated: 2026-08-25

## Goal

Resume an approved generated-file delivery during the already-active hosted
invocation without waiting for another conversation message, and prevent
legacy nested staging residue from blocking cleanup of independent direct
generated files.

## Evidence

- Metadata-only production timing shows an approval-only system mailbox item
  was imported by an active turn, but its pending effect remained deferred
  until a later conversation message arrived.
- The later message caused the already-approved attachment to dispatch, proving
  that Web admission, Temporal signaling, provider upload, and delivery were
  healthy while active-turn post-import reconciliation was missing.
- The first post-deploy checkpoint reported the closed
  `staging_not_flat` cleanup code and pruned no direct generated files.
- A portable support export contains no runtime subtree or nested ZIP payload;
  the large disposable archives therefore remain runtime-only and outside
  canonical vault ownership.

## Product UX Patch

- Person and path: An existing private-chat member approves a prepared file
  while the runner remains active. The runtime delivers it without requiring a
  typed confirmation or starting a companion model reply.
- Recovery state: A legacy nested entry remains untouched, while trusted direct
  terminal or orphan generated files are reclaimed and active direct files are
  retained.
- Privacy: Tests and release notes use synthetic identities and content only.
  Diagnostics remain bounded metadata with no paths, filenames, hashes, message
  content, or account identifiers.

## Constraints

- Keep conversation work as the only foreground-yield signal; a system-only
  approval reconciliation must not start or steer the model.
- Preserve current-inbound reply authority and do not silently consume an
  unrelated user message.
- Automatic deletion authority remains limited to direct regular files under
  the exact generated-delivery runtime root. Nested entries, symlinks, special
  entries, unsafe names, and untrusted outbox inventories remain retained.
- Reuse the existing mailbox post-checkpoint effect owner, residue pruner,
  checkpoint diagnostics, and hosted-local harness. Add no queue, scheduler, or
  persisted state owner.

## Plan

1. Add a focused runner regression proving a system-only active-turn import
   executes its already-owned post-checkpoint effect before the active phase
   finishes, without flipping foreground conversation yield.
2. Run prompt-preparation effects for active-turn imports whenever such effects
   exist, while preserving conversation-only notification and preemption.
3. Change generated-delivery inventory planning so legacy nested directories
   are counted and retained instead of aborting direct-file cleanup; preserve
   every other fail-closed structural check.
4. Add residue and snapshot regressions for nested-retained plus direct-pruned
   behavior and bounded metadata-only diagnostics.
5. Extend the hosted-local approval scenario to cover approval during an active
   invocation with no follow-up conversation message and no provider restart.
6. Update the owning runtime/security contracts and public changelog, then run
   focused tests, typechecks, exact-head reviews, and required CI.

## Verification

- Pre-fix runner regression timed out waiting for the imported system effect
  during the active phase; the cleanup regression failed with the closed
  flat-staging error before the correction.
- `pnpm exec vitest run --config vitest.config.ts --no-coverage
  test/assistant-runtime-residue.test.ts` passed 33 tests.
- The two active system-import runner tests passed with 116 unrelated tests
  skipped, and the snapshot cleanup target passed with 53 unrelated tests
  skipped.
- Assistant engine, assistant runtime, Cloudflare, and hosted Web typechecks
  passed. The changelog page target passed all 9 tests.
- A clean hosted runner bundle build passed its CLI and runner size budgets.
- The production-shaped `vault-file-approval-resume` hosted-local E2E passed
  with a real Temporal worker and schedule. It proved one approved attachment,
  no follow-up conversation message, no extra provider request, and no
  container restart while the original invocation remained active.
- `git diff --check` passed.

## Review

- Parent candidate inspection: Ready. The change reuses the existing effect
  owner, preserves conversation-only yield signaling, keeps every structural
  cleanup guard except the obsolete whole-pass nested-directory veto, and does
  not broaden deletion into nested or canonical vault state.
- Exact-head preliminary specialist and final cross-cutting ReviewGPT gates,
  plus required GitHub checks, remain PR completion gates after this plan is
  archived and the candidate is pushed.

## Product UX Walkthrough

- Ready. A member can approve while the original hosted invocation is active;
  the attachment arrives from the existing approval without a typed nudge or
  companion model response.
- Ready. Active direct deliveries remain, completed direct copies are pruned,
  and legacy nested entries remain untouched with a metadata-only count for
  diagnosis.
- Ready. Saved vault files, unsafe entries, symlinks, special entries, and
  untrusted outbox state remain outside automatic deletion authority.
Completed: 2026-08-25
