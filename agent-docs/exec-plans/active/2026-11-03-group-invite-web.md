# Preview group game invite links

Status: active
Created: 2026-11-03
Updated: 2026-11-03

## Goal

- Render open group bearer invites in the public page, metadata and OG image,
  using only the public starter name, group word, shared task, schedule and prize.

## Success criteria

- Group reads explicitly opt into multiplayer without a member identity.
- Pair HTML and copy remain byte-for-byte unchanged; closed/cancelled copy stays.
- Focused game tests, Web typecheck/lint, complexity and docs checks pass.
- Draft-first PR becomes Ready with resolved ReviewGPT and green required CI.

## Scope

- In scope: existing invite renderers, copy, regression proof and design study.
- Out of scope: game service/API authority, app links, group admission, merge and deploy.

## Constraints

- Reuse readInvitePreview and its existing public projection; no new state or queries.
- Do not render sparse task overrides, authenticated extras or private labels.
- Groups remain dark, so no changelog. ReviewGPT uses the vonneumann lane.

## Risks and mitigations

1. Pair regressions: capture base page/card HTML before edits and assert unchanged.
2. Public disclosure: render shared default task, ignore all viewer/seat extras.
3. Rollout: Web-only reader change; old API clients and admission remain unchanged.

## Tasks

1. Done: confirm capability omission and capture pair baseline.
2. Done: add group copy/rendering and explicit capable server reads.
3. Done: prove open group, pair and closed journeys, including metadata/image routing.
4. Done: inspect phone/desktop rendering and complete local checks and parent review.
5. Commit, push, open draft, mark Ready; run ReviewGPT alongside CI. Do not merge.

## Decisions

- Root cause confirmed: all Web reads omit multiplayer; service rejects groups.
- Product UX effort: Patch. Token holder sees group headline and shared terms,
  then the existing app handoff. Pair recipients and closed links retain their
  current experience. Phone and desktop presentation use the existing study.
- Authoritative state stays in the unchanged game service; no writes or retries.

## Verification

- Passed: 29 focused non-PostgreSQL Web game suites, 627 tests. Invite suites
  rerun after the final pair-capability assertion: 29 tests pass.
- Passed: Web typecheck and lint (existing unrelated warnings), complexity:diff
  (no hotspots above 20), docs:drift and docs:gardening (zero issues).
- Passed: Playwright invite study at 390 and 1280 pixels. Inspected group page
  and card captures plus a real 1200x630 ImageResponse PNG with bundled fonts.
- No database needed: service behavior is unchanged; route tests substitute
  the preview boundary and exercise real page, metadata and image-route wiring.
- Product UX: Ready. Open group, pair and closed/cancelled paths match the plan;
  public group rendering ignores private/seat-specific fields and keeps app links.
- Parent candidate review passed: small renderer-only correction, no new state,
  public API changes, providers or foreground reply work. ReviewGPT and CI pending.
- Design proof is local with inspected synthetic captures. No hosted preview
  deployment is permitted by the task; the PR will disclose that limitation.
- Browser setup regenerated unrelated stale legal PDFs. Restored those generated
  files and recorded the reproducible issue with Frog; no legal changes included.
