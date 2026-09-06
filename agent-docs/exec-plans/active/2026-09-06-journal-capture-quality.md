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
- Implementation, verification, PR creation, and ReviewGPT are authorized. Merge and production deployment remain separate actions.
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
- Query and replica tests: 40 passed. Web page tests: 39 passed. Runtime refresh tests: 5 passed.
- Focused prompt and catalog boundary tests cover private-only capture, English detail, unknown timing, and unsupported icons.
- The real-Codex journey uses the production CLI and prompts with synthetic Spanish input. It saved two separate English notes, selected supported icons and all-day/period timing, then corrected the same record without duplication.
- Earlier live attempts exposed weak guidance for continuing symptoms, repeated detail, and combined facts. Instructions now state these rules at both the conversation and typed-command boundaries.
- Actual replies were inspected. Journal capture and correction are Ready for the tested model and run, not guaranteed across all samples.
- The real production study was inspected at 390px and 1440px. The Journal itself has no horizontal overflow. Separate design-catalog content can overflow outside this component.
- CLI metadata and skill hash were regenerated. Final type checks, lint, complexity guard, and PR packaging are in progress.

## Deployment

Deploy the Web reader before the runtime writer publishes new timing values. Existing replicas remain readable; existing notes are not rewritten. Keep the compatible reader if a writer rollback leaves new replicas in storage. Verify a new note, a correction, and page-entry refresh after deployment.

## Remaining work

1. Finish final focused checks and parent diff review.
2. Commit the scoped change and open the draft PR with changelog and design proof.
3. Complete required review and CI on the intended candidate.
4. Close the plan and hand off the reviewed PR.
