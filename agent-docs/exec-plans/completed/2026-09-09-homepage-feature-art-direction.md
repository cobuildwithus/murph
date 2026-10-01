# Give homepage feature sections distinct visual hierarchy

Status: completed
Created: 2026-09-09
Updated: 2026-09-09

## Goal

Give the group and personal homepage sections a stronger visual hierarchy after removing their supporting paragraphs.

## Success criteria

- All eight headings and existing demos remain, without restoring supporting paragraphs.
- Larger features, open compositions, and varied scale replace the repeated equal-size panels.
- Phone reading order, audio controls, and horizontal overflow remain correct.
- Review real desktop, tablet, and phone screenshots, run focused checks, and refresh PR preview evidence.

## Scope

- In scope: TogetherSection, AsksGridSection, shared feature presentation, focused tests, changelog, and existing PR.
- Out of scope: Other homepage sections, new product promises, assistant behavior, and production deployment.

## Constraints

- Reuse the existing fonts, demo components, and anchored screenshot study.
- Keep headings before demos in DOM order, including visually reversed desktop rows.
- Preserve synthetic demo content and existing playback behavior.

## Risks and mitigations

1. Large typography may wrap poorly on phones. Inspect 390px, 1024px, and 1440px renderings and full-page transitions.
2. Strong panel colors may reduce contrast. Use light text on deep green and rust, and dark text on yellow.

## Tasks

1. Completed: replaced the repeated grid treatment with distinct compositions.
2. Completed: inspected desktop, tablet, phone, and full-page renders; corrected narrow tablet wrapping and decorative phone overflow.
3. Completed: 17 focused tests, prepared web typecheck, ESLint, complexity guard, and three responsive browser journeys passed.
4. Candidate reviewed for scoped commit. PR owns publication of selected screenshots, hosted preview verification, and exact-head CI evidence.

## Decisions

- Keep all removed subtext absent.
- Reuse one feature wrapper with compact, wide, and reversed layouts.
- Use deep green, warm yellow, and rust for selected featured demos; leave smaller demos unframed.

## Verification

- Focused homepage and changelog tests; prepared web typecheck; focused ESLint; complexity diff.
- Browser proof on homepage and screenshot study, with play/pause and overflow checks.
- Exact-head CI and a ready hosted preview.

## Outcome

The implementation and local review are complete. The existing PR records hosted preview and final-head CI results as they finish. No assistant or runtime contract changed.
Completed: 2026-09-09
