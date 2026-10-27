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

## Behavioral remediation and shipping authorization

The user explicitly requested repairing real behavioral misses, rerunning them,
removing stale or unnecessary tests, and shipping once behavior is satisfactory.
The earlier Hold is the baseline verdict, not a request to stop. The product
contract remains Terra for personal defaults, Sol for every group, and a paid
subscription for personal Sol only.

The first affected-case audit covered 106 previously failing scenarios per
model. Terra completed 74 passes and 32 failures. Subsequent fixes and reruns
remain separate artifacts; original results are retained. Do not treat a later
pass as deletion of an earlier failure.

Production fixes under verification now include bounded wrist-effect retries,
checking existing group grants before offering permission, ordinary reminder
model selection at the save boundary, food-query repair without repeated rejected
queries or internal-error prose, plain welcomes after group jokes, chart palette
instructions, onboarding first-reply ordering, game dates across the 3 AM cutoff,
and research persistence before sending. Nutrition target revisions must load
their owner and read back the complete saved target; device-photo edits preserve
the source in the same mutation.

Fixture repairs distinguish harmless reads from writes, seed already-known
language where unrelated bookkeeping contaminated effect counts, provide calendar
event ownership, align fixture clocks, accept equivalent truthful prose, and
allow exact bounded historical reads. Removed a duplicate journey that prescribed
schema-discovery internals instead of exercising an ordinary reminder request.
Required mutation counts, authorization, final canonical values, privacy, and
forbidden claims remain asserted. Stochastic research suppression is legitimate;
an actual send still requires its successful dedupe-ledger write.

A source preview for the unchanged Settings UI is building from the current
pushed feature head. The PR remains draft while remaining behavior diagnostics
and final verification are in progress. No production preferences have changed.


## Stable remediation candidate

The affected-case union has 106 scenarios per configuration. Initial remediation
audit results were Terra 74/106 and Sol 84/106; these and the original full-suite
results remain retained. Subsequent runs repair production prompts or invalid
fixtures before rerunning the affected cases. Scheduled reminder execution now
asserts the actual provider receives the delivery contract and uses its JSON
object after tools. The final complete create/fire/cancel journey passes for both
chat models, including its independently pinned Luna scheduled turn.

Final deterministic evidence: 453 affected tests passed; the later base-prompt
change passed 203 prompt/planning tests, and the final live-fixture contracts
passed 72 tests with 541 live cases correctly opt-in. Assistant Engine typecheck
passes after the final fixture edits. Earlier Web/shared/Cloudflare typechecks,
model entitlement tests, catalog/image checks, and PostgreSQL reset proof remain
applicable. Complexity passes across 22 source files; all 16 existing hotspots
retain their complexity and the model resolver reduces its debt.

Complete first native provider input, compared with the retained identical base
fixtures: individual 160600 to 161338 bytes (+738, +0.460%); group 138746 to
139586 (+840, +0.605%). Registered tool bytes are 67159 and 76454 respectively.
The target tokenizer is unavailable, so token counts remain unmeasured. Captures
include assembled instructions, wrappers, and native-generated guidance, excluding
the nondeterministic cache key.

The Settings source preview is Ready and anonymously reachable at
https://murph-9bo503kud-cobuildwithus.vercel.app/screenshots/settings#settings-model-save-controls.
Paid/free production components were inspected at 390px and 1280px. Safe images
are attached to PR comment https://github.com/cobuildwithus/murph/pull/4383#issuecomment-6430868252.
Terra is the selected default; personal Sol is locked for free accounts and
available for subscribers. All groups retain Sol without billing eligibility.

Parent candidate review covered runtime/catalog skew, reset scope, individual
versus group defaults, preserved later group selections, entitlement failures,
fixture effect assertions, prompt conflicts, and privacy. No production mutation
has occurred. Before merge, preserve and temporarily hold the Vercel ignored-build
setting. Deploy protected main runtime first through the existing private workflow
with normal predeploy/smoke gates and immediate container rollout. Restore the
prior build setting only after verified convergence, then build/promote main Web
and verify the one-time reset and effective model counts. Exact-head CI and Final
ReviewGPT are the remaining candidate gates; keep this plan active through them.

The latest completed behavioral result is passing for all 106 affected cases on
each configuration. The final five-case Terra sweep passed; Sol passed canonical
create/fire/cancel and feedback, then the final pending-edit and two restaurant
cases passed after fixture corrections. Both restaurant variants also passed on
Terra after the final fixture wording change. Replies and actual effects were
reviewed. This closes the baseline Hold for the scoped release, while the 21
missing-corpus cases and development-credential cache replay remain unavailable.
No broad equivalence or universal reliability claim is made.
