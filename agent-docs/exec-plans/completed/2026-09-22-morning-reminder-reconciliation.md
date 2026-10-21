# Reconcile existing reminders against current context

## Outcome and design

The morning pass reviews existing private reminders on every run, not only travel
or newly captured plans. Reuse canonical context and the existing versioned patch
owner to repair supported instruction, timing, reference, and lifecycle mistakes.
No new tool, scheduler, state owner, or dependency. Keep uncertainty, explicit
member choices, privacy boundaries, and domain-owned lifecycle authority intact.

## Experience and proof

Silent repairs should prevent stale or obsolete nudges. Exact event changes move
relative reminders; completion retires only the matching one-off; current member
constraints repair incorrect instructions. No accounts/new plans must not skip the
review. Correct, paused, ambiguous, fixed-time, and recurring reminders must not be
accidentally retired or moved. Repeat runs must be idempotent.

Use deterministic assembled prompt/skill tests, production-model Codex live
reconciliation and opt-out journeys, relevant typechecks, changelog tests,
complexity/docs/privacy review, and a scoped commit. No production writes.

## Progress

Implemented in the existing connected-context skill and managed morning seed.
The sweep explicitly requests up to 200 active/paused inventory entries rather
than the default ten, checks totalCount, and must not claim a truncated inventory
is complete. It uses only permitted canonical evidence after connected opt-out.

Completed verification:
- 165 focused model-behavior, connected-apps-prompt, and managed-automations tests;
  assistant and web typechecks.
- 10 changelog rendering tests after regenerating the fragment registry.
- Complexity guard passed with unchanged source debt/maxima; docs drift,
  whitespace, and private-identifier checks passed.
- Production gpt-5.6-luna high, local subscription: global connected opt-out stayed
  silent with zero provider calls. Existing travel capture/repair and repeat-run
  journey passed, preserving timing and fixed destinations without duplicate work.
- Broader live journey uses twelve synthetic reminders and production current-state
  prompt assembly. Initial harness omissions of saved memory and distinct duplicate
  fixture identities were corrected and validated before calling the provider.
  Ready: exactly four repairs (equipment wording, event-relative timing, completed
  one-off, confirmed duplicate), seven unrelated/ambiguous/paused/recurring/fixed-time
  records unchanged, one authoritative duplicate retained, all routes preserved,
  canonical facts unchanged. Second fresh pass: zero additional patches or records.

Live commands, each run as one focused journey with local subscription and
`--model gpt-5.6-luna` (production seed high reasoning):
- `pnpm test:assistant:live -- --test "repairs non-travel reminder context timing completion and duplicates without new connections" --model gpt-5.6-luna`
- `pnpm test:assistant:live -- --test "respects a global opt-out without reading provider content" --model gpt-5.6-luna`
- `pnpm test:assistant:live -- --test "captures travel and repairs stale reminder location without changing timing or fixed destinations" --model gpt-5.6-luna`

All live reply/effect reviews are Ready: routine maintenance stays silent, no
extra notification or question, authorized reminder purpose preserved. This
establishes the tested journeys, not a guarantee for every future model sample.

Parent review: prompt-primary change, no new runtime owner, API, persistence,
scheduler, dependency, or independently sensitive backend change. No deployment
or production member mutation is part of this local verification.
Status: completed
Updated: 2026-09-22
Completed: 2026-09-22
