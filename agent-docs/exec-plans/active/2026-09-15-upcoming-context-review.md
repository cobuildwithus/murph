# Upcoming context: silent activation and reviewed PR

## Outcome

Finish the morning Journal/upcoming-context change with silent first-run capture,
then publish an owned PR with green final ReviewGPT and required CI. First obtain
ReviewGPT advice on deeper life-context understanding using existing primitives;
prioritize simple, composable architecture over new machinery.

## Invariants and scope

Remove connection heads-up messages and notice-based eligibility. Active supported
connections can be read immediately in the next morning run. Preserve explicit
opt-outs, private/group isolation, Journal canonical truth, source reconciliation,
existing follow-ups, date/uncertainty semantics, and ordinary action authority.
Historical completed plans remain immutable; this plan supersedes their notice
policy for the new iteration. No deployment or production account mutations.

## Steps and evidence

- [x] Obtain and evaluate the exploratory ReviewGPT architecture/product advice.
- [x] Remove the notice gate across skill, seed, tests, and current owner docs.
- [x] Implement concrete accepted improvements with existing owners.
- [x] Run focused deterministic/live proof, typechecks, complexity and parent review.
- [x] Publish the PR with complete evidence and provider-input measurements.
- [ ] Obtain green final ReviewGPT, resolve findings, and verify exact-head CI.
- [ ] Close the plan, commit final evidence, and hand off the PR.

## Review boundary

Exploratory advice is requested before publication and is not final approval.
Use the standard final PR review on the stable pushed head. Inspect recommendations
against source evidence; reject speculative complexity and redundant owners.

## Silent activation evidence

The managed seed, owning skill, routing hint, current docs, and changelog now
remove announcements and notice-based eligibility. Historical ledger flags do
not confer or withhold permission. Explicit global/provider/category opt-outs
remain controlling. No extra data store or migration is needed.

Focused deterministic checks passed 199 tests (seven pre-existing skips), with
67 managed-automation tests passing after the added composed-instruction
assertions. Engine typecheck and package build passed. Three focused Luna-high local-subscription
journeys passed and their replies are Ready: a new Gmail connection and an
undated baseline calendar both read in the first run, persist an empty successful
context inventory, and return skip; a globally opted-out account clears the
existing context and returns skip with no provider calls.

Exploratory ReviewGPT was sent against commit 5605db09f242 with the silent
activation requirement explicitly called out as the next change. The completed advice and accepted scope are recorded below. Draft PR https://github.com/cobuildwithus/murph/pull/3494 is
published at 91cca90a05fa with local proof and provider-input measurements. Its
initial CI failures are the expected draft-rejection gate; mark Ready only after
the consultation is assessed and the candidate is stable, then run final review
and exact-head CI together.

## Initial provider input measurement

The opt-in `MURPH_MEASURE_UPCOMING_INPUT=1` scripted-provider journey captures the
complete first Codex request at the provider boundary for identical direct/group
fixtures. It uses the base's exact previous Journal routing line and omission of
the upcoming block, while retaining the same production layers, tools, and history.
With one synthetic trip, direct input grows from 143666 to 145007 UTF-8 bytes
(+1341, approximately 0.93%); group remains 131269 bytes. Registered tool payloads
are unchanged (direct 56443; group 40481). Transport-only prompt_cache_key is
excluded. An exact Terra tokenizer is unavailable; token counts are explicitly
unreported rather than treating scripted usage or authored-text counts as tokens.
The two first-request captures passed with no external provider calls.

## Architecture consultation and accepted scope

The exploratory response was recovered from its original accepted thread after
waited capture timed out despite a complete marked Pro answer. Exact-thread
export matched the accepted turn and requested model. Existing Frog #3213 covers
the capture/export failure; no duplicate entry is needed. This is architecture
advice, not the final PR approval.

Accepted: use canonical Journal plan metadata and the existing context snapshot
for deterministic projection, dirty invalidation, restore/replay, and read-time
expiry. Delete the separate model-written upcoming-context page. Normalize only
the negative controls in the existing connected-source ledger so opt-outs and
disconnections filter rebuilt context. Keep aliases and dedupe mappings there.
Canonical writes and ledger policy writes invalidate the projection through the
existing write-receipt path; unrelated snapshot sections remain usable.

Also accept source-identity retry handling at the canonical note owner, explicit
event timezone on typed note creation, compact navigation before detail expansion,
and clear distinction between planned travel, observed arrival, and freshness.
Keep the separate authorized reminder-availability owner unchanged. Defer generic
memory input tuning and broad relevance scoring because they are independent of
this feature. No new scheduler, database, agent, or generic context framework.

These changes supersede the earlier derived-page proof. Focused engine suites
passed 293 tests (seven existing skips), core import tests passed 42, and typed
CLI tests passed four. Engine, core, CLI, contracts, and runtime typechecks passed;
the full incremental workspace build and contract artifact generation passed.
The complexity guard passed. Canonical retry, correction, deletion, policy
suppression, expiry, bounds, preemption, timezone, and audience isolation have
focused deterministic coverage. Provider input measurements above use the final
canonical projection. Live calendar retry and direct/scheduled tentative travel
journeys passed. All seven final live journeys passed and replies were reviewed
Ready: calendar retry, grouped email itinerary, new mailbox, undated calendar,
global opt-out, and ordinary/scheduled tentative travel use. Capture returned
skip without notices; opt-out performed zero provider reads; context use made no
schedule changes. The final focused readback passed 40 tests, including complete
provider input capture, skill discovery, and canonical projection. Runtime receipt
wake proof passed. Parent diff/privacy review and complexity guard passed.

The PR remains unmerged and undeployed. Updated strict contract consumers must
precede writers of optional canonical plan metadata; keep compatible readers
after new metadata is persisted. Final ReviewGPT and exact-head CI remain pending.
