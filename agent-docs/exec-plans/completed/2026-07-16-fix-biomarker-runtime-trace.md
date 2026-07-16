# Restore biomarker detail pages to production bundles

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Restore every published `/biomarkers/[biomarkerId]` detail page in the
  production Next server bundle, including `/biomarkers/hrv-rmssd`, without
  widening the deployed Health Commons artifact set beyond the biomarker web
  projections those routes read.

## Success criteria

- A production build trace for biomarker detail and research routes contains
  the route index plus representative shell, overview, and research artifacts.
- The production-built server renders the canonical HRV/RMSSD page instead of
  emitting `NEXT_HTTP_ERROR_FALLBACK;404`.
- The Health Commons trace guard fails when biomarker detail artifacts are
  absent, so the deployment regression cannot pass the web build again.
- Routed apps/web verification, completion audits, CI, and the selected
  ReviewGPT PR gate are green.

## Scope

- In scope: biomarker generated-artifact tracing, the production trace guard,
  focused regression coverage, and direct production-build/server proof.
- Out of scope: authored biomarker content, slug or alias changes, visual
  redesign, private biomarker trends, and unrelated Health Commons routes.

## Constraints

- Technical constraints: generated catalogs remain ignored build outputs;
  runtime routes consume only compact `generated/web` projections; preserve the
  build-memory work that removed broad automatic catalog tracing.
- Product/process constraints: keep the canonical URL unchanged, use the
  isolated worktree/PR lane, preserve unrelated work, and complete the required
  frontend, coverage, and ReviewGPT gates.

## Risks and mitigations

1. Risk: a broad tracing change restores the page by packaging the full Health
   Commons catalog and regresses build memory.
   Mitigation: prove exact `.nft.json` contents and retain the existing guard
   against catalog and unrelated bundle leakage.
2. Risk: unit tests pass against local generated files while Vercel still omits
   them.
   Mitigation: make the post-build trace guard assert representative biomarker
   projections and run the production server against the built output.

## Tasks

1. Reproduce the soft 404 and prove the missing production trace boundary.
2. Determine the narrowest Next tracing/path change that includes biomarker web
   projections without restoring broad catalog tracing.
3. Extend the production trace guard and focused tests for the canonical HRV
   route artifacts.
4. Run apps/web verification, production-server scenario proof, specialist
   audits, parent review, and privacy/diff checks.
5. Finish the scoped commit, open the PR, run ReviewGPT concurrently with CI,
   and resolve every accepted finding.

## Decisions

- The canonical content and route id are valid; no content or redirect change
  is warranted.
- Treat the wire-level HTTP 200 as a failure because the streamed response
  contains `NEXT_HTTP_ERROR_FALLBACK;404` and `robots=noindex`.
- Consolidate the 20 compact biomarker projections under the `/biomarkers`
  trace prefix because the Turbopack build applies that entry across the route
  subtree while the narrower dynamic entries did not affect deployed traces.
- Keep overview and research trace assertions independent so one correctly
  packaged function cannot mask the other.

## Verification

- Passed: focused Next config tests (36/36), a fresh production build, and the
  Health Commons checker across 213 Next traces.
- Passed: exact overview and research trace inspection found the route index,
  HRV shell, and matching overview/research projection in each function, with
  no monolithic catalog.
- Passed: production-built overview and research requests returned HTTP 200,
  rendered `Heart Rate Variability`, and contained neither the embedded 404
  marker nor `robots=noindex`.
- Passed: full hosted-web tests (5,376 passed, 141 skipped), lint with only
  pre-existing warnings, and a clean TypeScript check.
- Required audits: frontend review returned no findings; coverage-write found
  the production trace checker sufficient and made no edits.
- Required second-model UI double-check: Fable was unavailable because of a
  server-side overload; the allowed Opus fallback independently inspected the
  built traces and unchanged route failure path, then returned no findings and
  made no repository edits.
- Local gap: the browser runtime exposed no backend for desktop/mobile
  screenshots. The diff-aware lane's dev smoke also reached Next `Ready` but
  intermittently exceeded its fixed 90-second health-route window on the slow
  worktree filesystem; one isolated prepared-environment run passed, and the
  production build/server path remained green.
Completed: 2026-07-16
