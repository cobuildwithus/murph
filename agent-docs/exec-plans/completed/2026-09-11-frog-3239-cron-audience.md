# Preserve explicit cron route audience evidence

## Outcome and invariant

Patch: resolving and saving an explicit complete cron route preserves its supplied direct or group audience evidence. Evidence must never transfer to a route changed by saved defaults. Unknown audience stays unknown; hosted live authority and notification admission remain unchanged.

## Owner and cause

`assistant-engine` cron target resolution omits `threadIsDirect`; `operator-config` self-delivery defaults also rebuilds both result branches without it. Existing canonical automation and runtime stores already support this field. Extend the existing lookup type and preserve explicit booleans only for unchanged normalized nonempty routes. Reuse public workspace entrypoints. Do not change saved-target schema, delivery selection, continuity, prompts, or provider authority.

## Product UX

Outcome: a direct reminder retarget remains eligible for its existing private notification journey; a group route remains explicitly non-direct.
Reaches: no-default and exact-saved-route resolution; changed or incomplete fallback routes retain unknown audience.
Proof: deterministic defaults/canonical-write readback plus one focused production-composed real-Codex reminder notification with one queued synthetic effect and truthful reply.

## Steps

- [x] Prove both omission boundaries with focused failing regressions.
- [x] Preserve evidence at existing callers and defaults owner with exact normalized route equality.
- [x] Run focused regression, type, complexity and live journey proof; review final diff and UX with parent.
- [x] Parent reviewed the final source and scoped live-fixture design; implementation is ready for its scoped plan-closing commit.

PR completion remains tracked by the owning lane: draft creation, actual changelog PR provenance, final Ready admission, full exact-head ReviewGPT and required CI; human merge only.

## State, deployment and completion

No new state or wire shape. Existing optional boolean readers accept old and new writes. Rolling readers retain their existing live authority checks. Old writers may still lose evidence until upgraded, and rollback restores the defect without a schema incompatibility. No new network, database, retry, or foreground await. This runtime/privacy PR requires human merge; leave issue open until separately approved landing.

## Evidence

Frog issue #3239 is the existing exact-hash authority. Fresh live main was b0141ce79ae2f6a3d8cf83266b60e57b1e8a9425; only merged sync PR claims its binding. Sanctioned isolated checkout and frozen install succeeded; Frog list succeeded after install.

Focused regressions first failed for explicit true and false at both owners. Final defaults suite: 10 passed. Canonical retarget regression: 2 passed; all 227 existing runtime tests passed. The continuity assertion reads its runtime owner because a keyed route deliberately does not expose an old session pin. Operator-config, Assistant Engine and Web typechecks passed. Complexity passed with no hotspots and unchanged maximum 15 in the defaults file. Changelog archive rendering: 10 passed.

The focused real-Codex journey `queues one private reminder after explicit defaults preserve its audience` passed on gpt-5.6-terra using local subscription auth. It uses the public defaults helper with an explicit synthetic home, canonical validation/upsert/readback, production cron instruction composition, and the production notification path. Exactly one provider request queued exactly one direct Telegram outbox intent; the single existing automation remained. Parent separately reviewed the deterministic actual set-target caller proof. No global environment mutation, external delivery, or production data was used. Reply review: Ready, concise truthful reminder, no extra follow-up or question. Final review and CI remain separate PR gates.
Status: completed
Updated: 2026-09-11
Completed: 2026-09-11
