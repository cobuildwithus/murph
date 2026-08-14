# Simplify recurring reminder conversation behavior

Status: active
Created: 2026-08-13
Updated: 2026-08-14

## Goal

- Make normal daily and weekly ordinary reminders inspect the existing
  conversation before interrupting again: send normally until a delivered
  reminder is unanswered, ask once whether to keep, change, or pause the
  interruption, then stay quiet until relevant human input changes the context.

## Success criteria

- The resident scheduled-turn contract owns the behavior for private and group
  conversations without new persisted state or a reminder-specific history.
- A focused occurrence-sequence regression proves send, one cadence question,
  then skip after continued silence.
- Bounded cold transcript history carries one privacy-safe incompleteness marker,
  so omitted reply context cannot be mistaken for silence.
- The guarantee stays inside the existing 14-day confirmed-output evidence
  horizon; a longer or unusually delayed cadence sends normally after that
  evidence expires rather than retaining content or inventing reminder state.
- Medication, clinician-directed, clinical, and safety-critical reminders remain
  outside the quiet-after-silence policy and continue until explicitly changed
  or paused or an existing authoritative skip condition applies.
- Dense-cadence setup policy and Linq-only unanswered-reminder policy are
  deleted, while reminder/check-in/review authorization boundaries remain.
- Relevant package tests and TypeScript checks pass; the exact pushed PR head
  passes the required ReviewGPT stages and CI.

## Scope

- In scope: scheduled reminder execution guidance, setup prompt cleanup,
  follow-through skill simplification, Linq posture cleanup, focused tests, and
  current owner documentation when required.
- Out of scope: schema changes, new lifecycle state, duplicate-automation
  production investigation, scheduler delivery/idempotency state, and changing
  the semantics of explicitly authorized check-ins or reviews.

## Constraints

- Technical constraints: reuse the ordinary conversation session and committed
  history; preserve provider-neutral execution, existing delivery state, and
  the canonical automation owner.
- Product/process constraints: group questions are room-scoped and do not blame
  individuals; silence does not imply non-completion; repeated copy may remain
  concise when context is unchanged; default to net deletion.

## Risks and mitigations

1. Risk: broad prompt wording could silently widen a reminder into an
   accountability check.
   Mitigation: define the sole exception as cadence administration and retain
   explicit prohibitions on completion inference and participant blame.
2. Risk: a setup-only regression could miss real scheduled-turn behavior.
   Mitigation: exercise consecutive occurrences against the same conversation
   through the existing cron runtime harness.
3. Risk: channel posture could continue to fork product semantics.
   Mitigation: remove reminder behavior from Linq recovery posture and keep
   route-health guidance only.
4. Risk: the generic policy could silence a safety-critical cue without explicit
   user intent.
   Mitigation: retain an explicit resident and setup-time safety exclusion and
   exercise three unanswered prescribed-treatment occurrences in the cron
   runtime harness.
5. Risk: transcript retention, count, or byte bounds could erase the only
   visible evidence that a member answered a prior reminder.
   Mitigation: project one fixed assistant-role incompleteness marker whenever
   an existing cold-history bound omits committed details, and disallow
   silence-based cadence escalation or skipping while that marker is present.
6. Risk: a cadence longer than cron-response retention could lose the only
   durable content that distinguishes a normal cue from the cadence question.
   Mitigation: state the daily/weekly evidence horizon explicitly and send
   normally when prior confirmed output is unavailable; do not extend private
   content retention or add durable reminder classification.

## Tasks

1. Trace current scheduled-turn history, delivery evidence, reminder scope, and
   existing dense-reminder setup policy.
2. Add a failing focused occurrence-sequence regression.
3. Implement the smallest execution guidance and delete overlapping setup,
   skill, and channel-posture policy.
4. Run focused tests and TypeScript verification; inspect the privacy-redacted
   final diff.
5. Commit, push, open the PR, run preliminary and final ReviewGPT gates with CI,
   and land every accepted patch or correction before final handoff.

## Decisions

- Use the current conversation as the only evidence source; add no engagement
  state, counter, table, scheduler phase, or reminder-specific session.
- Keep `supportKind`, automation lifecycle status, delivery/outbox state, and
  optional generic `activeUntil` because they own distinct authorization and
  reliability concerns.
- Preserve the fact that cold history is incomplete through the transcript
  owner's existing retention/count/byte projection and one fixed
  provider-history marker; do not retain or reconstruct expired message text.
- Exclude every recognized Murph-managed automation owner scope from the
  ordinary reminder overlay while retaining `supportKind: null` compatibility
  for legacy or user-authored reminders.
- Guarantee quieting only while the immediately prior confirmed output remains
  inside the existing 14-day evidence horizon. Normal daily and weekly
  reminders are covered; longer or delayed reminders safely continue when
  evidence expires. This explicit scope is preferable to extending message
  retention or adding a cadence enum, bit, counter, or host lifecycle.

## Review outcomes

- ReviewGPT round 1's safety-critical-reminder finding was accepted and fixed
  with an explicit resident/setup/skill exclusion plus a three-occurrence
  prescribed-treatment regression.
- ReviewGPT round 2's long-cadence retention finding was accepted and fixed in
  the existing transcript-history projection, with answered and unanswered
  retention-boundary proof.
- The preliminary specialist's public recovery wording, residual skill policy,
  known managed-job scope, and model-decision coverage findings were accepted.
  The new gated real-app-server table covers the reminder decision owner; the
  existing inspect-and-patch tests remain the owner for later automation
  mutations rather than duplicating that subsystem here.
- Final round 3 required a requirement-level retrospective because count- and
  byte-bounded cold history can lose the same relevant reply that age retention
  can lose while separate automation-output evidence still preserves the
  cadence question. The retrospective compares the immutable first-reviewed
  source shape (`+83/-115`) with the current shape (`+137/-130`) and chooses
  shrinking and continuation: replace the age-specific marker with one general
  incompleteness signal at the existing committed-transcript projection. The
  signal covers age, audit/count, per-message-byte, and total-byte bounds; warm
  native resume remains authoritative, while bounded reconstruction cannot
  prove silence. No reminder state, history store, lifecycle, or second policy
  owner is authorized.
- Final round 4 found that a current-cold-history marker would remain visible
  inside the replacement native thread and could become a permanent veto on
  later cadence decisions. The finding is accepted: marker authority is scoped
  to the provider request whose engine-supplied cold-history section contains
  it, and expires before later native-resume decisions. A gated three-turn App
  Server regression covers cold continuation, resumed cadence question, and
  resumed skip without adding state.
- Final round 5 found an earlier chronology boundary: a supported provider,
  inference-revision, expiry, or other continuity transition can replace the
  conversation session before transcript projection, while automation outputs
  from the prior session remain available. The second requirement-level
  retrospective chooses the existing cross-owner join instead of another
  marker: cadence evidence may use only automation runs whose existing
  `sessionId` matches the currently resolved conversation session. On session
  replacement, older output is neither answered nor unanswered evidence, so
  the current cue sends normally and establishes a fresh same-session sequence.
  Output enrichment moves behind session resolution; no schema, state, counter,
  session type, lifecycle, or reminder-specific history is added.
- Final round 6 found the remaining evidence-horizon boundary: ordinary cron
  response text and terminal outbox delivery evidence both expire after 14
  days, so an arbitrary long-cadence reminder cannot retain both confirmed
  dispatch and cue-versus-cadence-question semantics without changing privacy
  retention or adding durable classification. The third requirement-level
  retrospective chooses scope shrink and continuation. The quieting guarantee
  applies to normal daily and weekly reminders whose immediately prior
  confirmed output remains inside the existing evidence horizon. A longer or
  unusually delayed cadence sends normally when that evidence has expired; it
  never guesses silence. Extending message-content retention, adding a durable
  cadence bit/counter, correlating pre-delivery transcript text by timing, and
  rebuilding the deleted host lifecycle are rejected. The correction is an
  intent-contract and resident-copy clarification with focused horizon proof,
  not a new state or retention owner.
- Final round 7 found that retained `delivery_pending` output still combined
  queued intent with terminal dispatch. The fourth requirement-level
  retrospective keeps authority in the existing cron-run outcome: pending
  output is unavailable to cadence decisions; terminal outbox reconciliation
  rewrites that existing run to `delivered` only after `sent`, or to `failed`
  after failed, abandoned, or missing delivery. The next occurrence cannot run
  while its job still owns a pending intent, so no confirmed output is lost by
  excluding unresolved pending runs. This adds no field, enum, intent link,
  state owner, or reminder lifecycle. Composed queue-to-sent and queue-to-failed
  tests must prove the run transition, and output projection must admit only
  the terminal delivered branch.
- The final ReviewGPT loop reached its seven-round hard cap with the preceding
  accepted finding. The cap retrospective chooses the same existing-owner
  correction and continuation through required local audit, parent review,
  focused verification, and PR CI. No round eight is authorized by this plan;
  repository policy requires a fresh explicit continuation decision before any
  eighth ReviewGPT round.

## Verification

- Commands to run: focused assistant-engine Vitest files, the assistant-engine
  TypeScript check selected by repository scripts, privacy/diff inspection,
  exact-head GitHub Actions, and required ReviewGPT commands.
- Expected outcomes: focused behavior and prompt regressions pass, typecheck is
  clean, the dense lifecycle remains deleted while review-driven safety and
  retention corrections stay focused, ReviewGPT has no accepted unresolved
  findings, and required CI is green on the final head.
- Current local evidence: 10 changed-surface assistant files passed with 511
  tests and 71 intentional provider-gated skips; focused cron store, output,
  and runtime coverage passed with 243 tests; assistant and Web
  typechecks passed; 57 focused changelog tests passed. Production UI design
  proof is not applicable because no component, style, layout, or browser state
  changed. The session replacement correction has direct selection,
  persisted-vault, and resolved-notification-path proof. The live real-model
  command is authored but cannot execute in this worktree because the isolated
  harness requires an `OPENAI_API_KEY` and none is configured. Round-seven
  delivery-authority proof covers both composed terminal branches: queued then
  sent becomes the only projected output, while queued then failed is excluded.
