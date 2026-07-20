# Proactive group challenge diagnostics

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Make group challenge standings truthful and useful when some members are
  missing data: preserve available standings, name each omitted member's
  authorized missing-data reason, and give the smallest accurate next action.
- Let group Murph see only the consented, bounded connection-health facts needed
  to distinguish missing metric sharing, missing diagnostic consent, proven
  coarse connection problems, and otherwise-unverified data gaps.

## Success criteria

- A challenge update never presents a partial leaderboard as if it were complete.
- Each challenge participant recorded as `in` is represented as ranked,
  awaiting a missing Murph sharing grant, missing diagnostic consent, in a
  proven coarse connection state, or unverified. Group membership alone never
  creates a challenge participant or a missing-data callout.
- Group Murph can create the existing server-owned additive like-to-consent offer
  for missing challenge and connection-health scopes without inventing a join.
- Device/source labels and freshness are disclosed only through a new explicit
  group sharing scope; raw provider identifiers, tokens, payloads, and private
  device diagnostics never enter the group vault or prompt.
- Apple Health guidance distinguishes the OS permission handoff from the need to
  reopen Murph for a foreground sync, and never claims Murph can grant HealthKit
  permission by reacting in chat.
- Focused and full required verification, direct scenario proof, specialist
  audits, green PR CI, and the exact-head ReviewGPT gate complete with no
  unresolved accepted finding.

## Scope

- In scope: group vault-share projection contracts and labels, Web-owned
  projection derivation, group challenge/read-model completeness, group-chat
  assistant guidance, focused fixtures/tests, and matching product/security/
  architecture docs.
- Out of scope: changing provider ingestion, inventing a device scheduler,
  granting HealthKit permission from chat, exposing raw account metadata,
  repairing individual production accounts, or redesigning challenge scoring.

## Constraints

- Use existing grant, projection-delivery, group-reader, and route-bound
  like-to-consent primitives; add no new queue, scheduler, table, or assistant
  runtime state owner unless evidence proves those owners cannot express the
  requirement.
- Treat a grant as permission only. Source availability, last successful sync,
  projection delivery, and current challenge data remain distinct facts.
- Preserve the existing thread-context prompt lane by putting group-specific
  behavior in the group-chat skill unless inspection proves a stable system
  prompt change is required.
- Work only in the isolated task worktree on
  `codex/group-challenge-diagnostics`; preserve unrelated active lanes.

## Risks and mitigations

1. Risk: device status can expose private health-context metadata to a group.
   Mitigation: require a dedicated explicit scope, project only public source
   labels plus coarse connection/freshness state, and enforce member/grant/share
   identity at the existing projection owner.
2. Risk: a stale projection can be mistaken for current Web-owned connection
   truth.
   Mitigation: include observed-at/source-freshness semantics in the bounded
   projection, label uncertainty, and never turn absence into a guessed cause.
3. Risk: a reaction could be described as granting an OS-level Steps permission.
   Mitigation: reactions grant only disclosed Murph group sharing scopes;
   HealthKit authorization remains an iOS-owned handoff with explicit copy.
4. Risk: partial standings can still hide unranked members.
   Mitigation: make challenge output enumerate the current consented roster and
   attach typed availability states before editorial prompt behavior.

## Tasks

1. Trace current challenge summaries, group projections, join/requested scopes,
   device connection authority, and group-chat prompt behavior.
2. Define the smallest consented connection-health projection and challenge
   member availability contract in a durable product spec.
3. Implement owner-aligned contracts/readers/projection delivery and proactive
   group guidance with focused regression tests.
4. Run required verification, direct scenario proof, coverage audit, prompt
   review for the prompt surface, and the selected cross-cutting PR gate.
5. Close the plan with a scoped commit, push, open the PR, and finish CI plus
   ReviewGPT concurrently.

## Decisions

- Challenge completeness starts from the knowledge-page roster entries whose
  participation is `in`. Current group membership and grants are reconciled
  against that roster; neither membership nor a data grant implies challenge
  buy-in.
- Add one explicit selectable fixed projection, `device-sync-status.v0`. It
  carries only public source labels, coarse status, a bounded observation time,
  and honestly named connection sync-job completion time. It excludes account
  and device identifiers, provider errors, credentials, scopes, metadata,
  resource payloads, and health values.
- Derive and transport the diagnostic record through the existing member-owned
  device snapshot and Vault Share ports. Use one fixed replacement key and a
  UTC-day observation bucket to bound unchanged delivery revisions; treat an
  old observation as unknown rather than forever-current state.
- Give scheduled background turns a best-effort narrow snapshot of current
  member ids and exact projection-scope/share authority. Keep permission-offer
  posting route-bound and interactive; scheduled challenge turns must not
  manufacture authority to post a reaction offer.
- Treat delayed revoke delivery as cleanup rather than authorization. Before
  every hosted assistant pass with landed group projections, read Web's current
  active shares and atomically reconcile by exact member, scope key, and share
  id; fail before model access if that authority cannot be verified.
- A reaction grants only the disclosed Murph group-sharing scopes. Apple does
  not reveal HealthKit read authorization, and current backend state cannot
  prove that a member failed to open the app. Recovery copy may recommend
  opening Murph and checking Health access without claiming either as the
  established cause.
- Prompt review proved that the stable hosted-group capability list must name
  the new closed scope to avoid contradicting the challenge skill. Keep that
  change to the existing single list entry; do not alter the active
  thread-context layering or ownership work.

## Verification

- `pnpm verify:acceptance` passed end to end in serialized mode with an 8 GB
  Node heap. The larger heap was required only for coverage instrumentation in
  one existing Assistant Engine test file; the default parallel run exhausted
  the local 4 GB worker heap.
- Focused proof passed for the 229-case hosted workspace entrypoint suite, the
  227-case assistant phase suite, the 70-case Vault Share projector suite, the
  48-case Web group-store suite, and the exact detached-ask authority cases.
- Touched-package typechecks passed for Hosted Execution, Assistant Runtime,
  Assistant Engine, CLI, and Web.
- Coverage review, prompt review, consent/frontend review, simplify review, and
  security/privacy review completed with no unresolved accepted finding.
- `git diff --check` plus diff-only private-identifier, secret-literal, and
  prohibited-cast scans passed.
- PR CI, exact-head ReviewGPT, and final merge-tree proof remain post-push gates.
Completed: 2026-07-16
