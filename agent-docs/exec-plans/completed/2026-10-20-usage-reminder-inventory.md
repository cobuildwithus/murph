# Exclude maintenance instructions from reminder inventory

Status: completed
Created: 2026-10-20
Updated: 2026-10-20

## Goal

Reduce daily reminder-review payloads by excluding immutable built-in routine jobs before pagination and instruction serialization. Preserve complete ordinary and support-reminder review and existing versioned repairs.

## Success criteria

- Opt-in exclusion uses the existing static managed seed registry, never titles or editable tags.
- Filtered counts and cursors cover all remaining records, including paused and clinical/support reminders; default listings remain unchanged.
- Synthetic actual CLI response comparison proves fewer bytes/pages without omitted eligible records.
- Focused query/CLI/prompt tests, affected typechecks, and the production-derived morning live journey pass.

## Scope and ownership

Existing query filters own collection selection. The CLI composes a generic exact-ID exclusion with IDs derived from the assistant's existing static seed registry. The morning skill opts in. No second registry, stored state, new tool, or model change.

## Product UX

- Outcome: retain silent correct reminder repairs while reading less unrelated routine text.
- Reaches: ordinary active and paused reminders, support/clinical records, and maintenance-only inventories.
- Proof: complete filtered pagination plus the existing morning repair/retry journey seeded with built-in maintenance jobs; no new sends or edits to those jobs.

## Risks and mitigations

- Wrong classification: derive only registered static seed IDs; retain records that merely imitate tags/titles and dynamic support jobs.
- Pagination holes: filter inside the canonical query before count/cursor/limit.
- Version skew: optional read-only CLI flag and packaged skill deploy together; no stored schema or migration. Existing callers retain the default inventory.
- Dependency cost: CLI already statically imports the public assistant-engine root; reuse it without another package or identity owner.

## Tasks

1. Add generic ID exclusion and compose the opt-in maintenance filter from existing registry.
2. Update morning skill and architecture contract; extend deterministic and real-Codex proof.
3. Measure synthetic actual CLI responses, run focused checks and inspect candidate diff.
4. Close plan, commit/push, open draft PR; parent owns Ready, review and merge gates.

## Verification

- Query pagination: 4 passing tests; CLI automations: 40 passing tests; connected-apps prompt boundaries: 11 passing tests.
- Query, CLI and assistant-engine typechecks pass.
- Synthetic real CLI responses with eight built-in member routines and three eligible reminders: unfiltered baseline 78,334 bytes/two pages; filtered result 3,092 bytes/one page. Both use identical canonical records and normalize only the synthetic vault root for byte counts. This is a response-payload comparison, not token or allowance savings.
- GPT-6.1 Sol local-subscription morning journey passes: four supported repairs, silent result, no extra repair on repeat, and no maintenance inspections or mutations. Shipped GPT-6 Luna with the current xhigh setting also passes the same journey: four repairs, silent skip, no repeat repair, and all eight routine jobs unchanged and uninspected. UX verdict: Ready.
- Complexity guard passes with unchanged debt; all five reported hotspots predate this change and are untouched internally.
- Documentation drift and diff whitespace checks pass. No repository-actionable friction was encountered after ordinary frozen dependency installation.
- Initial provider input remains unchanged: the changed skill and CLI schema are loaded only after model tool calls, not assembled into either individual or group initial input. Existing root CLI manifest already imports the assistant-engine public root, so this adds no module closure to the CLI.
- Changelog not applicable: internal read projection only; reminder behavior and model settings are preserved and member allowance savings are not quantified.


## Handoff

Implementation and focused evidence complete. Parent owns draft-to-Ready admission, exact-head CI, final ReviewGPT, and any subsequent merge or deployment. No production changes occurred.
Completed: 2026-10-20
