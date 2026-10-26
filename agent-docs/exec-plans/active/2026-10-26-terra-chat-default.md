# Terra chat defaults and subscriber model selection

Status: active
Created: 2026-10-26
Updated: 2026-10-26

## Goal and protected invariants

Use GPT-6.1 Terra by default in private chats, retain Sol for all
groups, reset existing chat model preferences once, expose
Terra in Settings, and reserve personal-chat Sol for paid
subscribers. Preserve chat isolation, reasoning preferences, pricing integrity,
and independent Astra eligibility. Explicit selections after migration persist.

## Evidence and owners

At the task base, the shared hosted-execution catalog defaults to Sol. Web owns
nullable model preferences and gates only legacy Sol. Settings mounts its
picker but lacks Terra. The pinned native catalog lacks Terra; the official
refreshed Codex catalog provides its entry. Extend these existing owners.

## Product UX

Outcome: personal chats use Terra and every group uses Sol. Eligible subscribers
can select Sol in personal chats.
Entry: Settings or explicit chat model change. Changes affect the next turn.
People: free/trial, paid direct, sponsored family, group owners, and cancelled
subscriptions. Astra retains its premium rule. Group Sol is available to everyone
without reading or exposing private account facts in the room.
Proof: default resolution, saved readback, denied Sol writes, eligibility loss,
room isolation, migration, pricing, responsive picker and focused real Terra turns.
Done when these paths pass and production rollout status is reported truthfully.

## Implementation and rollout

1. Add Terra catalog, image capability, diagnostic and pricing support.
2. Update defaults, subscriber authorization and Settings choices.
3. Add a once-only preference reset through the existing hosted migration owner.
4. Prove deterministic boundaries, typecheck, live model and rendered UX.
5. Review the complete diff and commit scoped changes; report deploy prerequisites.

Canonical state remains hosted_member.assistant_model_preference. Do not add a
second preference store. Deploy compatible Worker/container readers before Web
starts selecting Terra. Reset persisted overrides only after compatible runtime
support is deployed; migration must not run before that rollout boundary.
No local production secret retrieval or direct database writes.

## Verification

Focused model/configuration/pricing/settings tests pass (227 Web cases; 67 shared
model/runtime cases; 36 assistant configuration/image cases; five image catalog
cases). PostgreSQL reset proof passes and preserves reasoning preferences.
Web, shared execution, Assistant Engine and Cloudflare typechecks pass. Both
new individual/group Terra model-selection live journeys pass with truthful
next-turn replies. Responsive picker proof passes at 390px and 1280px.

The user additionally requested all local live-Codex tests compared against
GPT-6.1 Sol. Inventory: 538 main live journeys plus two commentary journeys.
The initial broad attempt revealed the default npm binary lacks the production
native patch required by canonical fixtures; these startup failures occurred
before provider requests and are excluded from model scoring. Build the pinned
production source plus checked-in patch locally, then run the same fixtures and
code against both models. Preserve first-run failures and inspect effects/replies;
do not retry merely to turn a stochastic failure green. The optional provider-key
cache replay requires a development API credential unavailable in this session.
Production execution is not yet performed.

## Initial provider input

Complete native first requests captured through the scripted Responses boundary,
with identical synthetic fixtures and production prompt builders. Base restores
original tool descriptions/enums and inbound framing and uses Sol; head uses
Terra for the individual fixture and Sol for the group fixture. Both use the production inbound-message builder with identical inputs. Individual
160,600 → 161,011 UTF-8 bytes (+411, +0.256%); group 138,746 → 139,082 bytes
(+336, +0.242%). Includes instructions, input, tool declarations and all
provider-visible fields; excludes the nondeterministic prompt cache key.
Exact target tokenizers are unavailable, so token counts/deltas are unmeasured.

## Full live comparison follow-up

The production-patched native binary built successfully. Both models run the
same 540-case local-subscription inventory. Completed first-run results are
retained across bounded process restarts; interrupted cases are recorded and
excluded until rerun. Some journeys intentionally pin another model and are
shared regression coverage, not a controlled Terra/Sol comparison. The source
baseline is the initial feature commit, with later remediation evaluated
separately. The comparison is complete; rollout verdict remains **Hold**.

Initial failures exposed ambiguous incoming-message framing and video evidence
that directed local playback instead of the hosted analysis tool. The prompt
builder now labels current inbound messages and routes available video evidence
to its analysis owner. Deterministic prompt proof passes; the affected group
video live journey passes. Batched preference updates need further assessment
because outcomes remained inconsistent across samples.

Both models also exposed clinical extraction ambiguity for known values with
undocumented units. Preserve these as typed observations with no inferred unit,
rather than dropping the fact or blocking an otherwise complete extraction.
The updated clinical deterministic suite and both structured live variants pass
on both models. Correct stale live fixtures for the Terra default, structured
clinical dates, separate procedure/finding facts, and current reminder models.
Read-only health-guidance fixtures now begin with an already-known language,
while retaining their exact no-write assertions. The onboarding email fixture
now supplies the prior conversation needed to establish its stage.

The user explicitly chose Sol for every group without a subscription, while
keeping personal-chat Sol subscriber-only and personal defaults on Terra.
The candidate follows that split. Explicit group selections stay distinct from
the derived Sol default. No group-owner billing relation is needed or read.
The quality verdict remains Hold.

Do not merge or deploy based on passing deterministic checks alone. The completed
comparison does not establish Terra parity. Production model preferences have
not been reset.

The meal-intake benchmark's 21 cases cannot reach the model: their uncommitted
image corpus is absent. A local food-label service was started for diagnosis,
but the populated labels database denied reads (`42501`); the alternate local
fixture database contains only one food. No permissions were changed and the
session-owned service was stopped. Treat these as environment blocks, not
model-quality failures. The separate API-key cache replay is also blocked by
its missing development credential.

Follow-up checks: 104 prompt/clinical unit tests, Assistant Engine typecheck,
and the 17-file complexity guard pass with unchanged complexity debt. Corrected
clinical-date recovery passes on both models and verifies that documentation
timestamps remain unchanged while the clinical date is repaired.

The split-default follow-up adds real-model restore-default journeys for personal
chats and groups. The initial candidate treated a free group differently; the
user clarified that every group can use Sol. Update the fixtures to that final
contract. Terra initially asked redundant confirmation when restoring a default;
the configuration tool now explicitly treats that request as authorization to
apply the known default. Exact writes and next-turn replies remain asserted.
Personal/group resolution checks include free, paid, inactive, and explicit model
preferences. All five final selection/default journeys pass on both Terra and Sol, including
Sol defaults in free and subscribed groups. Each required change makes exactly
one update and reports its next-turn effect; no unrelated command executes.

## Completed baseline and final handoff

Both complete local baseline runs finished on 2026-10-26 using the same initial
feature snapshot, production-patched native Codex, and local subscription auth.
All 540 unique inventory cases have a terminal result for each configuration.
The 21 benchmark setup failures never reached the provider and are split out:

| Configured model | Passed | Assertion/runtime failures | Setup blocked | Total |
| --- | ---: | ---: | ---: | ---: |
| GPT-6.1 Terra | 432 | 87 | 21 | 540 |
| GPT-6.1 Sol | 460 | 59 | 21 | 540 |

Paired first results: 411 pass on both, 49 pass only on Sol, 21 pass only on
Terra, and 59 fail on both (including the 21 shared environment blocks).
These are suite outcomes, not a clean model ranking: fixtures include pinned
other-model journeys, stale assertions, and setup failures. Initial attempts
that could not start the patched native provider are excluded. Interrupted
cases were rerun; completed failures were retained. Follow-up fixes and passing
reruns are separate evidence, not replacements for the original results.

Reply/action review found real Terra misses: redundant group permission offers,
a missed requested exercise illustration, inconsistent batched preferences,
and missing or inefficient follow-through in private research/nutrition paths.
Some failures merely reject equivalent wording or incidental reads. In the
food-label recovery case, Sol completed the lookup but exposed implementation
wording; Terra failed to complete the lookup. Sol also has genuine misses: one
wrist-alert journey issued two buzz calls for a request for one. Neither full
suite is clean. No claim of model equivalence or complete safety is justified.

The final candidate retains Sol for every group, defaults personal chats to
Terra, and gates personal Sol behind a subscription. The five final configuration
journeys pass on each model; focused clinical/video/default restorations pass.
Local deterministic checks, typechecks, and complexity pass. The temporary
baseline test copy was removed after every comparison process finished.
The complete initial-input measurement is recorded above; no target tokenizer
was available. No production secret was retrieved or production state changed.

Draft PR: https://github.com/cobuildwithus/murph/pull/4383
Current-base mergeability was proved against the verified remote base.
Required CI intentionally rejects a draft; frontend evidence also needs a
reviewer-openable preview. Final ReviewGPT has not been started because this is
not a Ready candidate. Keep the plan active and the PR draft until the remaining
quality issues and fixture prerequisites are resolved, then finish exact-head
CI/review and the documented consumer-first rollout. The global preference reset
remains unapplied.
