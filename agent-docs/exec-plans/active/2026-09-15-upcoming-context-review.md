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

- [ ] Obtain and evaluate the exploratory ReviewGPT architecture/product advice.
- [x] Remove the notice gate across skill, seed, tests, and current owner docs.
- [ ] Implement concrete accepted improvements with existing owners.
- [ ] Run focused deterministic/live proof, typechecks, complexity and parent review.
- [ ] Publish the PR with complete evidence and provider-input measurements.
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
assertions. Engine typecheck passed. Three focused Luna-high local-subscription
journeys passed and their replies are Ready: a new Gmail connection and an
undated baseline calendar both read in the first run, persist an empty successful
context inventory, and return skip; a globally opted-out account clears the
existing context and returns skip with no provider calls.

Exploratory ReviewGPT was sent against commit 5605db09f242 with the silent
activation requirement explicitly called out as the next change. Its advice
remains pending; no PR has been published yet.

## Initial provider input measurement

The opt-in `MURPH_MEASURE_UPCOMING_INPUT=1` scripted-provider journey captures the
complete first Codex request at the provider boundary for identical direct/group
fixtures. It uses the base's exact previous Journal routing line and omission of
the upcoming block, while retaining the same production layers, tools, and history.
With one synthetic trip, direct input grows from 143666 to 145055 UTF-8 bytes
(+1389, approximately 0.97%); group remains 131269 bytes. Registered tool payloads
are unchanged (direct 56443; group 40481). Transport-only prompt_cache_key is
excluded. An exact Terra tokenizer is unavailable; token counts are explicitly
unreported rather than treating scripted usage or authored-text counts as tokens.
The two first-request captures passed with no external provider calls.
