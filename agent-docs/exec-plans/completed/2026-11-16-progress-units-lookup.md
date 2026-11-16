# Progress units, searched goals and rung text

Status: completed
Created: 2026-11-16
Updated: 2026-11-16

## Outcome and constraints

Implement the supplied units-lookup plan including all six accepted findings.
The external locked plan remains binding; its private copies stay untracked.
Keep existing owners, sealed content, keyed lookups, immutable award facts,
transaction-time authority and one-shot provider work. No new tables or routes.
The integrator owns ReviewGPT and merge.

## Product UX

- Effort: Product change.
- Entry: Progress totals, landmark drawers, goal picker, route preview and medals.
- Outcome: Reader units change presentation while earned facts remain fixed.
- Journeys: US/UK/metric reader; typing versus explicit lookup; found, fictional,
  failed or budget-limited lookup; stale pick; revoked session; earned goal after
  replacement and withdrawal; route text and generic found medal face.
- Proof: Pure table tests, route contracts, PostgreSQL persistence and races.
- Exclusions: iOS rendering and unmerged health/friends lane implementation.

## Implementation

1. Rebase onto BE3 head, then main after its squash merge. Done.
   BE3 head: 99f2cde0f384ee59b1dae6d8cbf22d570c49292f.
2. Separate definitions and award facts from reader text; thread explicit units. Done.
3. Replace typing-time generation with cited lookup and atomic found selection. Done.
4. Author bank short text, taglines and metric blurbs; update contract fixtures. Done.
5. Prove invariants, review the diff, commit, push and open a PR. Do not merge.
   Delivery resumes in a helper-created worktree; the staged handoff was preserved.
   Clean rebase onto current main 559aa0ee8c; no Progress changes or conflicts.

## Decisions and evidence

- Budget: 20 explicit lookups per member per 24-hour limiter window.
- Provider shapes checked using the public OpenAI docs MCP and pinned SDK.
- OPENAI_API_KEY is unset; the optional live eval is skipped without seeking keys.
- Checked bank has 36 landmark and 7 time blurbs containing imperial dimensions,
  including hyphenated foot measurements. All receive metric prose; the supplied
  plan's counts of 37 and 8 do not match this bank.

## Verification

- Focused Vitest: 291 tests across eight files, exit 0.
- PostgreSQL: 60 tests across three files, exit 0; owned temporary database dropped.
- Web `typecheck:prepared`: exit 0.
- `pnpm complexity:diff`: exit 0; no hotspots.
- `git diff --check` and task-file privacy scan: passed.
- `pnpm test:diff`: exit 0; 15,752 Web tests passed, 2,800 opt-in tests skipped;
  lint, typecheck and production build passed. Exact-head CI awaits the PR.
- Candidate review: typed route/provider boundaries, citation shape, units,
  frozen facts, sealed field ownership and all six accepted findings checked.
- Product UX: backend integration Ready. Native rendering and live provider
  quality are not claimed; no API key was available. The response fixture is
  synthetic and follows the documented Responses shape.
- Changelog: not applicable; no released native build exposes Progress yet.
- ReviewGPT and merge remain with the integrator. BE2 must thread viewer units
  through its health/friends callers when integrated.
Completed: 2026-11-16
