# Distill the medical records page

## Outcome and protected behavior
Reduce the default view to a provider, concise latest-import outcome, one contextual action, and Manage. Preserve visible incomplete/failure states, accessible recovery, lab eligibility, import limits, confirmation and retained-record semantics. Existing client presentation remains the owner; no backend or authority changes.

## Approach and journeys
Remove card chrome and duplicate outcome rows. Move repeat import and connection controls into Manage when lab results are available; otherwise retain the import/reconnect action. Keep add-provider and privacy access quiet. Use the existing synthetic production study. Replay phone/desktop, keyboard Manage, retry discovery, disconnect cancellation, and existing status cases. Verdict: Ready.

## Verification
- Focused client and changelog suites: 36 passed using `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/clinical-records-pages-client.test.tsx apps/web/test/changelog-page.test.tsx` after changelog generation.
- Web typecheck passed; prepared typecheck repeated after the shared import-link extraction.
- Responsive production-component proof: two Playwright cases passed at 390 and 1280 pixels. Inspected both renderings. Manage opens by keyboard, repeat import is hidden until requested, saved-reference detail is accessible, disconnect still confirms and cancels, and privacy access remains available.
- Complexity guard passed: maximum 18, no hotspots above 20. Native disclosure and the existing import route avoid new state or backend work.
- Parent reviewed diff, privacy, recovery visibility and current-component screenshot evidence. `git diff --check` passed.

Local implementation only; no PR, CI, or deployment claimed. Changelog copy updated to match Manage. No new dependencies or persisted state. Frontend-only scope; no final ReviewGPT required.
Status: completed
Updated: 2026-09-25
Completed: 2026-09-25
