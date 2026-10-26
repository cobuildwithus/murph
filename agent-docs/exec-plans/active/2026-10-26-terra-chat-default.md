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
original tool descriptions/enums and uses Sol; head uses Terra. Individual
160,377 → 160,598 UTF-8 bytes (+221, +0.138%); group 138,561 → 138,910 bytes
(+349, +0.252%). Includes instructions, input, tool declarations and all
provider-visible fields; excludes the nondeterministic prompt cache key.
Exact target tokenizers are unavailable, so token counts/deltas are unmeasured.
