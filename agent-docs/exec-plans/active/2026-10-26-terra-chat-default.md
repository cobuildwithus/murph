# Terra chat defaults and subscriber model selection

Status: active
Created: 2026-10-26
Updated: 2026-10-26

## Goal and protected invariants

Use GPT-6.1 Terra by default in private and group chats, reset existing chat
model preferences once, expose Terra in Settings, and reserve Sol for paid
subscribers. Preserve chat isolation, reasoning preferences, pricing integrity,
and independent Astra eligibility. Explicit selections after migration persist.

## Evidence and owners

The shared hosted-execution catalog defaults to Sol. Web owns nullable model
preferences and currently gates only legacy Sol. Settings already mounts its
picker but lacks Terra. The pinned native catalog lacks Terra; the official
refreshed Codex catalog provides its entry. Extend these existing owners.

## Product UX

Outcome: existing and new chats use Terra; eligible subscribers can select Sol.
Entry: Settings or explicit chat model change. Changes affect the next turn.
People: free/trial, paid direct, sponsored family, group owners, and cancelled
subscriptions. Astra retains its premium rule. Group eligibility derives from
its owner's subscription, without exposing private account facts in the room.
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
Terra. Both use the production inbound-message builder with identical inputs. Individual
160,600 → 160,868 UTF-8 bytes (+268, +0.167%); group 138,746 → 139,142 bytes
(+396, +0.285%). Includes instructions, input, tool declarations and all
provider-visible fields; excludes the nondeterministic prompt cache key.
Exact target tokenizers are unavailable, so token counts/deltas are unmeasured.

## Full live comparison follow-up

The production-patched native binary built successfully. Both models run the
same 540-case local-subscription inventory. Completed first-run results are
retained across bounded process restarts; interrupted cases are recorded and
excluded until rerun. Some journeys intentionally pin another model and are
shared regression coverage, not a controlled Terra/Sol comparison. The source
baseline is the initial feature commit, with later remediation evaluated
separately. The comparison is still running; rollout verdict remains **Hold**.

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

The complete comparison must finish before the final quality verdict. Do not
merge or deploy based on passing deterministic checks alone. Production model
preferences have not been reset.

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
