# Simplify notification audience authority

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

- Resolve scheduled Telegram destination and audience through the existing Web route owner, including saved routes without directness. Keep one effective audience in conversation planning and delete identity-based guesses.

## Success criteria

- A legacy-shaped private Telegram occurrence reaches normal notification planning after live route authorization.
- Group routes remain group-scoped; changed or revoked destinations cannot inherit private context.
- Unknown live authority fails before model work with the existing typed retry; no new state, service, repair loop, or dependency.
- Focused owner, transport, scheduler, and composed planner tests; typechecks; one synthetic real-Codex journey; parent complexity/security review and scoped commit.

## Scope

- In scope: existing Web assertion response, Worker/runtime forwarding, scheduler consumption, conversation audience simplification, focused proof and owner docs.
- Out of scope: production route edits, historical replays, deployment, changing member-selected channels, unrelated scheduler or diagnostic repairs.

## Constraints

- Existing signed write-fenced route assertion remains the authority and send-time recheck. Return its already-known audience instead of inferring from raw identifiers.
- Keep stored directness only for the same bound destination; fresh target-bound authority wins. Do not infer private audience from actor equality.
- Product UX patch — Outcome: authorized scheduled messages use their actual conversation audience. Reaches: private/group Telegram, Linq, missing and mismatched targets. Proof: composed scheduler/planner and delivery assertions plus synthetic real-Codex reply review.

## Risks and mitigations

1. Private/group misclassification: test fresh authority, same-binding fallback, changed destinations, and no authority before any provider/effect.
2. Deployment skew: Web adds optional response metadata first; old consumers ignore it. New scheduled consumers require it and retry if missing. No persisted shape changes or migration.

## Tasks

1. Add a failing legacy Telegram scheduled-route regression through the real audience policy.
2. Return audience from existing route assertion and consume it before planner admission.
3. Delete redundant audience inference and duplicate effective/raw directness representation.
4. Run focused deterministic proof, typechecks and live journey; review complexity and update owner docs.
5. Complete routed review/evidence and commit.

## Decisions

- Runtime logs establish missing usable audience, not the exact saved record; the hosted diagnostic timed out. Synthetic proof defines the correction without copying production data.
- No new checker or route resolver service. Extend the existing assertion's return value; resolve private/group independently of the stored hint.

## Verification

- The legacy Telegram scheduler/planner regression failed before implementation and passes with live route-owned audience.
- Focused deterministic proof: 825 engine tests across the affected suites, 52 runtime scheduling tests, 27 Web route-owner/endpoint tests, 5 Worker forwarding cases, and 10 changelog rendering tests pass. Covers exact current targets, missing/stale metadata, private/group scope, no actor/participant guesses, and onboarding using the same audience fact.
- Engine, runtime, Worker and Web typechecks; scoped Web ESLint; diff whitespace; complexity guard pass. Audience-policy maximum complexity decreases from 19 to 18; no new complexity debt.
- The existing target-bound directness helper remains small; its inference tree and separate target/actor inference helper are deleted, together with the duplicate effective audience field. Unrelated cron and workspace lifecycle hotspots retain their current owners.
- The synthetic real-Codex journey runs the canonical scheduled entry through the ordinary notification planner into a queued outbox intent. Both private and group live journeys pass on gpt-5.6-terra using local subscription auth. Each makes exactly one model request, no tool calls, and one pending outbox intent for the exact authorized target; no production send is part of this task.
- Product UX: deterministic private, group, unknown, changed-target and no-route local paths match the patch plan. Reply review is Ready: both synthetic reminders are concise, immediately useful, and make no completion or internal-authority claims.

## Handoff

- Implementation and focused proof are complete in PR #3210. Final external review and exact-head CI remain PR completion gates; no merge or deployment is authorized by this task.
- Deploy Web before the Worker adapter and runtime; missing metadata during skew uses the existing bounded retry and does not weaken audience checks.
Completed: 2026-09-10
