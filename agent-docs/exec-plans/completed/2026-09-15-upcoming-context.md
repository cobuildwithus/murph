# Morning Journal and upcoming context

## Outcome and invariants

One morning connected-context pass maintains Journal plans and supplies useful
upcoming life context to private conversations and scheduled model turns.
Preserve canonical Journal events, dedupe, corrections/cancellations, passive
follow-up suppression, exact reminder timing, explicit opt-outs, and private
versus group isolation. Remove the connection-date launch exclusion.

## Owners and design

Reuse the morning managed automation, retire the afternoon through the existing
retired-id reconciliation, and preserve standalone follow-up automations. Extend
the connected-context skill to scan fourteen days and reconcile known future
itineraries. Existing Journal events remain authoritative. One derived Knowledge
page, `upcoming-context`, contains normalized dated summaries referencing those
events; it is an advisory projection, never instructions or mutation authority.
The existing private current-state prompt reader reads that one bounded file on
every turn, removes expired/canceled entries, and labels stale verification.
No provider reads or graph traversal occur on the foreground path.

## Evidence and simplification

Current code seeds two passes, excludes old/undated connections in its skill,
and injects no upcoming plans. Existing canonical writes and knowledge pages
already cover persistence; no new scheduler, database, service, tool, or dependency
is required. The provider timestamps are not required for reading active accounts.

## Failure and migration

Migrate baseline accounts through the existing notice boundary while preserving
opt-outs. Preserve verified notice state. Retire only the fixed afternoon id.
Canonical plan edits precede projection replacement; partial provider reads do
not imply cancellations. Malformed/oversized projection data contributes no facts.
Expiry is evaluated at read time even when maintenance fails. Existing readers
ignore the additive Knowledge page; deployment needs the updated skill and reader
in the same engine build. Old binaries can recreate the afternoon pass, so mixed
runtime versions must converge before asserting the new cadence.

## Product UX

Feature: existing and new connections, opted-out and disconnected sources,
private interactive/resumed/scheduled turns, groups, travel/overnight events,
cancellations, missed refreshes, and dense context. Routine updates stay silent.
Relevant context can adapt wording or interpretation; schedule/protocol mutations
still require their ordinary authority. Journal plans and one-shot follow-ups
retain their existing owners and behavior.

## Proof and progress

- [x] Managed retirement, window and notice migration tests.
- [x] Bounded context read, expiry, stale data, replacement and private isolation.
- [x] Focused synthetic real-Codex capture and context-use journeys.
- [x] Focused tests, typecheck, complexity and parent diff review.
- [x] Owner docs, changelog decision, scoped commit and final handoff.

No production data or account mutations belong to this task.

## Validation evidence

The focused engine suite passed 273 tests (seven pre-existing skips) across
upcoming context, current state, managed automations/core, turn planning, skill
assets, and dynamic system prompts. Engine and Web typechecks passed. The
changelog page suite passed ten tests. The final affected context/skill subset
passed 38 tests with the same seven skips. Complexity guard passed: new reader
maximum complexity nine; existing managed-automation/system-prompt hotspots are
unchanged. Added-content privacy scan and whitespace checks passed.

Local subscription live proof uses `gpt-5.6-luna`, matching the automation model.
Each scenario is selected separately with `pnpm test:assistant:live -- --test
<unique-pattern> --model gpt-5.6-luna`. Completed reply reviews are Ready:
undated baseline migration sends one notice without provider content reads;
calendar capture saves one canonical plan and one end-based check-in, publishes
schema-valid context, and stays silent without duplication on retry; private
conversation and scheduled reminder use relevant travel context without actions
or following hostile event text. The original email itinerary proof also passed.
Global opt-out clearing passed with zero provider calls. Expanded email projection
and dedupe-mapping proof passed: one Journal itinerary, one follow-up, complete
normalized route/date details in schema-valid injected context, and persisted
source mapping. All six selected live scenarios have passing evidence and Ready
reply reviews. The final email run took 586 seconds; this is a bounded synthetic
correctness result, not a production latency or cost claim.

Live evidence exposed an unnecessary tool discovery under a global opt-out.
The skill now makes opt-out precedence a hard stop before provider search or
execute, clears the derived page, and preserves historical Journal records.
Expanded email proof caught a missing source-to-plan ledger update. The skill
now requires canonical write, verified source mapping, then derived refresh,
with bounded canonical recovery after a partial write.
Fixture corrections normalize Knowledge's generated heading on JSON readback
and initialize real canonical vaults before context persistence.

## Delivery boundary

Changes remain local until separately published and deployed. No production
records, provider accounts, or member-facing channels were mutated. The current
task authorizes a scoped commit, not a PR; exact-head CI and PR-routed external
review remain future publication gates. The bounded foreground addition is one
local file read, parallel with existing readers, with no network/database calls
and at most 8 KiB of optional prompt context. Existing group prompt golden hashes
remain unchanged. Full normalized details stay in canonical Journal records;
overflow directs explicit retrieval instead of silently claiming completeness.
Status: completed
Updated: 2026-09-15
Completed: 2026-09-15
