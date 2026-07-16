# Preserve notification reply conversation continuity

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Make an authenticated inbound reply continue the latest authorized direct
  conversation even when the immediately preceding Murph message came from a
  scheduled notification turn.

## Success criteria

- Reconstruct the reported scheduled-notification and inbound-reply sequence
  from the supplied vault plus secret-safe hosted evidence and identify the
  exact boundary that lost conversational context.
- Keep one existing conversation/session owner and one continuity path; do not
  add a notification-specific history store, queue, scheduler, or parallel
  transcript.
- Preserve direct/group audience isolation, route authority, reply idempotency,
  provider-native continuity, durable transcript fallback, and foreground reply
  priority.
- Add production-faithful regression proof for notification-turn context being
  available to the next inbound reply, including the relevant cold-restore or
  stale-native-resume boundary when that is the proven failure.
- Pass the required verification, direct scenario proof, specialist audits,
  exact-head ReviewGPT loop, PR CI, and merge-conflict check.

## Scope

- In scope: supplied-vault and hosted-runtime diagnosis; direct-message session
  selection, transcript/native-resume persistence, scheduled notification turn
  handling, hosted snapshot integration, focused tests, and matching current
  runtime/architecture docs.
- Out of scope: changing reminder product policy or copy, adding durable product
  state, broad assistant-session redesign, group-audience behavior beyond
  preserving its current isolation, and unrelated mailbox/orchestration work.

## Constraints

- Prove the root cause from concrete vault, code-path, log, deployment, or test
  evidence before editing production behavior.
- Prefer deletion, reordering, or reuse of the existing session/transcript
  owner. Add no notification-specific context state or compatibility machinery
  without evidence that the existing owner cannot satisfy the requirement.
- Keep member content, direct identifiers, local account paths, secrets, raw
  message bodies, and provider payloads out of commits, plans, logs, fixtures,
  review artifacts, and PR text.
- Work only in the isolated task worktree and preserve the non-exclusive active
  mailbox/runtime lanes recorded in the coordination ledger.

## Risks and mitigations

1. Risk: treating the screenshot as proof of a session-key bug when provider
   resume loss, transcript omission, or deployment skew could produce the same
   symptom.
   Mitigation: correlate the vault's session, input, transcript, automation,
   outbox, and checkpoint evidence with runtime metadata and recent code before
   choosing a fix.
2. Risk: broadening continuity can cross direct/group audience or route
   boundaries.
   Mitigation: preserve the canonical conversation key and monotonic binding
   checks; only make already-authorized same-conversation notification output
   visible through the existing continuity owner.
3. Risk: a local passing test may miss hosted cold-restore behavior.
   Mitigation: include the proven restore/resume boundary in focused coverage
   and run the narrowest production-faithful hosted scenario available.

## Tasks

1. Inspect the supplied vault safely and query secret-safe hosted evidence for
   the reported time window.
2. Trace scheduled notification session selection, provider-native resume,
   transcript persistence, hosted snapshot inclusion, and later inbound session
   lookup through current code and tests.
3. Write a failing regression that reproduces the proven context loss.
4. Implement the smallest owner-level correction and update current durable
   docs only where the runtime contract changes or is clarified.
5. Run verification, direct scenario proof, required coverage audit, parent
   final review, exact-head ReviewGPT, CI, and clean-merge proof.
6. Close the plan with a scoped commit, push the task branch, open the PR, and
   report any cross-plane deployment order or remaining live-production proof.

## Decisions

- Vault and hosted metadata prove the scheduled message and later inbound reply
  used the same provider chat but different assistant sessions. Ingress,
  Temporal handoff, restore, provider execution, delivery, and deploy version
  were healthy.
- Preserve automations with full conversation locators already resolve the live
  conversation session. This older keyless automation correctly retained its
  separate pinned session, so the existing outbox-to-turn context bridge is the
  intended continuity owner for the next inbound reply.
- The bridge has rejected normal production deliveries since introduction:
  persisted message deliveries omit the optional `kind: "message"`
  discriminator, while three local match/read helpers require it. Reaction
  deliveries alone carry `kind: "message-reaction"`.
- Classify reactions once at the existing outbox-list boundary, narrow the
  downstream helpers to the normal-message delivery type, and make the shared
  fixture use the production shape. Do not merge sessions, rewrite automation
  routes, clear provider resume state, add persistence, or change hosted
  orchestration.

## Verification

- Production-shaped failing proof: removing the fixture's fabricated normal
  message discriminator made 17 cross-session event-path cases fail before the
  matcher correction.
- Focused event-path verification passes all 32 cases, including the exact Linq
  cron-route scenario, native reply anchors, causal cutoffs, route isolation,
  same-session exclusion, and receipt-watermark suppression.
- Assistant-engine typecheck passes. A full package run reached 2,285 passing
  tests and only two unrelated 60-second timeout failures; both timed-out cases
  pass in isolated reruns. An earlier unconstrained package run passed all 2,287
  tests with five skips.
- Truthful diff verification passed repository guards, affected typechecks, and
  all affected package suites except unrelated CLI timeouts. The missing
  ignored Health Commons prerequisite was generated through its standard
  command and the affected 32-test CLI file then passed. The remaining isolated
  CLI intervention timeout reproduces on untouched `origin/main`; the other
  timed-out CLI file passes all six tests alone.
- Required `coverage-write` audit completed with no edits and no actionable
  proof gaps. `git diff --check` and the secret/direct-identifier readback pass.
- Parent final review found no remaining correctness, coverage, privacy, or
  handoff gap. The scope-and-shape check reduced three duplicate runtime guards
  to one owner-boundary classification plus compiler-enforced helper types.
- Remaining external gates: exact pushed-head ReviewGPT pass, green PR CI,
  clean latest-base merge proof, and a post-deploy live scheduled-message reply
  check.
Completed: 2026-07-16
