# Game days off and recap superlatives

Status: active
Created: 2026-11-02
Updated: 2026-11-02

## Outcome and ownership

Refuse off-day posts before any entry is saved, retaining scheduled-yesterday
grace and count schedules. Reuse the pure rules and canonical command path.
Include optional member-addressed superlatives in the existing sealed recap.
Drop invalid optional pairs without losing a valid story. No new state owner,
database schema, external call, or dependency.

## Product UX

- Entry and promise: app posts and explicit chat photo saves get a kind refusal
  with the game-local weekday and next scheduled day; credit chat effort without
  claiming a save or retrying.
- People: weekday schedules, count schedules, grace captures, different time
  zones, future schedule changes, final off days, and old recap readers.
- Recaps: two similar weeks still receive distinct, kind titles grounded only
  in shared game entries and text. Keep member IDs for viewer mapping.
- Proof: rules, route, photo tool and recap persistence tests; exact composed
  guidance; focused synthetic live journeys with reply review.
- Done when: focused checks, review, exact-head CI, merge and verified deploys.

## Evidence and design

postingDay currently returns today after grace and stale-capture checks without
schedule admission. Chat rejects off days earlier but discards useful refusal
copy. Recaps use a shared schema, sealed game field and viewer-neutral projection.
Read_game must expose each player's memberId for the new optional pair.

## Tasks

1. Implement refusal, shared chat copy, optional recap validation and guidance.
2. Add deterministic and live proof; document iOS JSON and write changelog.
3. Review candidate, run ReviewGPT alongside CI, merge and deploy.
4. Record final evidence and retire the sanctioned task checkout.

## Deployment and risks

Deploy compatible Web first, then the runtime. Old writers omit the field;
Web only requests it when the tool supports it and strips it from old-writer
replay responses. New tools require player IDs before producing it. Old recaps and fallback omit it. No production data or member messages
are needed for verification. No force push or process interference.

## Verification

Focused Web rules, routes, photo bridge, recap validation and chat-tool suites:
209 tests pass. Hosted notification/dynamic-tool and compatibility suites pass.
Web, Assistant Engine and Hosted Execution typechecks pass; Web lint has only
pre-existing warnings. Complexity passes with no changed hotspot above 20.

Both focused live journeys use gpt-6.1-sol with local subscription:
- game chat off day credits effort without retrying or counting: Ready; one
  read and one rejected save, no retry or false credit, brief effort/day/next-day reply.
- game recap distinct grounded superlatives for similar weeks: Ready; one
  accepted story and one synthetic queued delivery, two distinct grounded titles.
  Initial reply review held repeated heading words; the production guidance,
  validation and assertion now exclude that prefix and the rerun passed.

Full first-input capture: individual 167575 -> 167575 bytes; game group
150996 -> 151234 (+238, +0.158%). Exact model tokenizer unavailable; no estimated
token count substituted. Loopback provider; complete request excluding cache key.
Ordinary group fixtures also unchanged. Source baseline f3acfb07a968.

Parent review: Ready. Preserves grace, count schedules, old stored scoring,
member-addressed copy, old writer replay and optional fallback. No new query or
external work. Group-chat skill inspected; no conflicting game-save guidance.
PR review, exact-head CI, merge and deploy remain pending.
