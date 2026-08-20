# Simplify record-scoped workout tracking

Status: active
Created: 2026-08-13
Updated: 2026-08-20

## Goal

Make live workout logging tolerant of ordinary conversation gaps: retain an
exact member-set repetition prescription on the workout itself, close a finite
workout when its final planned set is logged, and let a new workout start even
when an older record was never explicitly closed.

## Root cause and invariant

- Conversation replay is bounded, so a prompt-only repetition rule eventually
  loses the member's establishing message.
- A repository-wide active-workout singleton coupled one stale record to every
  later workout start and mutation.
- The canonical workout record, not assistant runtime focus or transcript
  retention, owns workout identity, prescribed repetitions, completed sets,
  and observed end time.

## Product UX plan

Classification: Product change.

### Outcome

A member can log an ordinary finite workout with short replies and move on to
the next workout without bookkeeping questions caused by transcript limits or
an older unfinished record.

### Entry and promise

The member starts or resumes a workout in a private conversation. Murph uses
the exact workout returned by that interaction, applies an exact repetitions-
per-set statement to later terse completions for that exercise, and treats the
final planned completion as the observed session end. A later extra set can be
appended only to an exactly named workout.

### Affected people

- A member with a long workout conversation whose original repetition message
  has fallen outside bounded replay still gets the established repetitions on
  the intended set.
- A member completing the last set of an explicitly finite workout sees the
  session complete immediately and can start the next workout.
- A member with an older unfinished or targetless workout can start another
  workout without Murph inventing an end time or modifying the older record.
- A member intentionally adding an extra set can append it to the exact
  completed workout; ambiguous or missing identity remains a narrow refusal.

### Proof and recovery

Exercise the canonical start, prescription, set-log, auto-close, next-start,
retry, correction, and exact-extra-set paths. Verify the persisted record and
assistant-visible result. Old unfinished records remain readable and editable
by exact id; they no longer block unrelated work.

### Done when

- No global active or focused workout selector remains in the mutation path.
- Every mutating CLI command requires an exact workout id.
- A finite plan closes atomically with its final newly completed set.
- Exact retries and corrections do not move the observed end boundary.
- Starting another workout never depends on closing a prior workout.
- Product walkthrough, focused proof, ReviewGPT gates, exact-head CI, merge,
  deploy, and bounded post-deploy verification are green.

## Architecture decision

- Persist optional `memberRepsPerSet` on the exact workout exercise. Only an
  exact member statement can set or change it; never derive it from a target,
  prior workout, reminder, or assistant suggestion.
- Persist `setPlanIsFinite` only where existing structure cannot distinguish an
  explicit set count from an open-ended targetless exercise. Do not add focus
  state, a lifecycle manager, reconciliation, or a compatibility service.
- Target mutations by exact workout id or the existing opaque card binding.
  Use per-workout locking; delete the global workout lock and singleton lookup.
- Logging the final pending set of an entirely finite workout writes the actual
  result and accepted completion timestamp as `endedAt` in the same canonical
  mutation. A later exact extra set advances that observed boundary.
- Keep old records valid through optional fields. Legacy saved-routine workouts
  retain finite semantics; new targetless exercises explicitly remain open-
  ended.

## Deployment and rollback

The hosted assistant, CLI surface, contracts, and vault use cases ship in the
same runner bundle. Existing records need no migration, but the preceding
runner's strict workout parser rejects the two new optional fields. Deploy the
Worker and runner with `container_rollout=immediate` and prove the exact new
runner fingerprint before accepting workout traffic. Before the first new-field
write, the preceding bundle is a safe rollback; afterward, the compatible
runner is the rollback floor for affected workspaces and recovery is a forward
fix rather than a rollback below that floor. Web has no ordering dependency.

## Work

1. Inspect and simplify the generated patch against current main.
2. Add or repair focused coverage for record-scoped targeting and every
   affected Product UX path.
3. Run focused owner tests, typechecks, direct journey proof, and inspect the
   final provider-visible prompt/tool surface.
4. Commit and push one candidate, open the PR, and run required ReviewGPT gates
   concurrently with exact-head CI.
5. Resolve only verified findings with the smallest owner-level correction.
6. Close this plan, merge, deploy through the documented hosted path, verify
   bounded production signals, and retire the worktree.

## Product walkthrough

Result: Ready.

- Started an eight-set workout while a different older workout remained open;
  the new start succeeded and the older record stayed untouched.
- Stored one exact nine-repetition exercise prescription, then logged all eight
  sets through fresh CLI instances with no provider-thread state. Every terse
  completion inherited nine reps from the exact canonical exercise.
- The set-eight write atomically stored its actual and an observed `endedAt`;
  no finish-time question or second closure command was needed.
- Started and completed the next finite workout while the oldest record still
  remained open. Exact retry and correction paths kept the established end
  boundary stable, while a clearly appended ninth set advanced it once.
- Verified that targetless sessions remain open for optional additional sets,
  exact card actions revalidate under a per-workout lock, and stale cards do not
  retarget to another same-shaped workout.

## Verification

- Focused contracts, operator-config, Assistant Engine, assistant-runtime,
  vault-usecase, and CLI suites pass: 152 behavioral assertions across the
  directly changed paths, plus all 324 contract tests and generated-schema
  verification.
- All affected package typechecks pass. Prepared CLI runtime generation and
  exact package-shape verification pass after regenerating the Incur CLI
  schema, generated TypeScript surface, and skill hash from the built entrypoint.
- Complete first-provider request capture used the pinned real Codex App Server,
  local scripted Responses provider, `gpt-5.6-terra`, low reasoning, production
  code mode, identical synthetic direct/group turns with response cards
  available, and `gpt-tokenizer` 3.4.0 `o200k_harmony`. After normalizing private
  paths and provider-generated UUIDs, direct input changes from 29,446 tokens /
  136,321 bytes to 29,447 / 136,330 (+1 token, +9 bytes); group changes from
  25,946 / 120,827 to 25,947 / 120,836 (+1 token, +9 bytes). The complete
  first-request delta is confined to two exact-workout phrases in the existing
  response-card tool description. The larger tracked-workout instruction
  rewrite remains deferred skill content and is not part of the initial request.
- The opt-in paid real-model journey compiles, but no supported provider
  credential is present locally. The protected production deployment's required
  live-model smoke remains the external model/auth proof.
