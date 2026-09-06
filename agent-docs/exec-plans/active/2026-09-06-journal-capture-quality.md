# Reliable Journal capture and presentation

Status: active
Created: 2026-09-06
Updated: 2026-09-06

## Goal

Capture clear private health facts without an explicit save request. Use English names, useful detail, honest timing, and suitable icons. Request updated entries when Journal opens.

## Scope and authority

- Reuse canonical note events and their existing tags. No new table, service, or projection owner.
- Leave legacy Journal, production records, and group capture policy unchanged.
- Preserve the existing Journal layout. Add no Refresh control.
- Implementation, verification, PR updates, ReviewGPT, and merge after passing checks are authorized. A single Web preview may bypass the ignored-build command. Permanent hosting settings remain unchanged.
- Keep private feedback out of repository artifacts. Use independent synthetic fixtures.

## Product UX

Effort: Product change.

Journeys: multilingual private capture, continuing symptoms, approximate or missing activity time, follow-up corrections, stale data on page entry, phone and desktop presentation.

Exclusions: group consent, legacy Journal removal, production record migration, runtime scheduler redesign.

## Decisions

- Store icon and timing choices in existing note tags through a shared catalog.
- Keep the date-only storage anchor; show its declared precision instead of a guessed clock time.
- Preserve the vault time zone and any explicitly assigned day during projection.
- Ask Codex for English names and non-repeating detail at save time. Hide an exact title/summary duplicate through the existing view.
- Use the existing bounded runtime refresh API once on page entry. Waiting stops after 60 seconds; reopening requests another refresh.
- Offer 49 existing or Quiver-generated icons, including eight new distinct concepts. Unknown or conflicting icon metadata uses the notebook fallback.

## Evidence

- CLI-to-vault-to-Journal-to-browser-replica tests cover all supported timings, date-line time zones, exact noon, same-ID correction, and invalid input rejection.
- Query and replica tests: 40 passed. Web page, provider, and training tests: 121 passed. CLI write and import-surface tests: 6 passed. Prompt and planner tests: 184 passed.
- Focused prompt and catalog boundary tests cover private-only capture, English detail, unknown timing, and unsupported icons.
- The real-Codex journey uses the production CLI and prompts with synthetic Spanish input. It saved two separate English notes, selected supported icons and all-day/period timing, then corrected the same record without duplication.
- Earlier live attempts exposed weak guidance for continuing symptoms, repeated detail, and combined facts. Instructions now state these rules at both the conversation and typed-command boundaries.
- Actual replies were inspected. Journal capture and correction are Ready for the tested model and run, not guaranteed across all samples.
- The real production study was inspected at 390px and 1440px. The Journal itself has no horizontal overflow. Separate design-catalog content can overflow outside this component.
- CLI metadata and skill hash were regenerated. Web and assistant type checks, lint, and complexity guard pass.
- Round 1 found an error-retry admission bug. Retry now uses the existing foreground refresh. A provider-backed Journal regression fails before the correction and renders the timeline after it. Existing denial tests still pass.
- Keep explicit private capture rules after shorter live variants missed saves or repeated descriptions. The resident prompt ceiling rises from 68,578 to 70,511 characters. Typed command help also gives a concise title/detail example. Planner snapshots were updated only for prompt-bearing private routes.
- A pre-existing training fixture used the wall clock. It now pins the selector date to the synthetic replica date, retaining all assertions. The related public-safe Frog entry is included.
- The icon catalog uses a dedicated contracts export. Unrelated scoped CLI commands retain their original module-count ceiling.

## Deployment

Deploy the Web reader before the runtime writer publishes new timing values. Existing replicas remain readable; existing notes are not rewritten. Keep the compatible reader if a writer rollback leaves new replicas in storage. Verify a new note, a correction, and page-entry refresh after deployment.

## Remaining work

1. Finish the focused real assistant journey and current preview proof.
2. Push the reviewed correction to PR #2970.
3. Complete round 2 and required CI on the intended candidate.
4. Close the plan, merge after passing gates, and retire the clean task checkout.
