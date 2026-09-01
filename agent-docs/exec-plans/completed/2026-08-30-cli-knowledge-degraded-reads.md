# Expose degraded knowledge reads truthfully

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Keep Knowledge reads useful when one derived page is malformed while telling
  an agent, truthfully and safely, that the result is degraded and how to run
  `knowledge lint` for recovery.

## Success criteria

- `knowledge list` and `knowledge search` preserve valid-page results, expose a
  bounded privacy-safe degradation summary, and name `knowledge lint` as the
  recovery action when malformed pages were isolated.
- `knowledge list` preserves legacy `pageCount` as the returned-page count and
  adds the total valid filtered `totalCount` before limiting, plus truthful
  `returnedCount` and `truncated` fields.
- `knowledge show <slug>` distinguishes an existing malformed target with the
  typed `knowledge_page_invalid` error while preserving true not-found behavior.
- Degradation output never includes malformed contents, raw parser errors, or
  absolute paths and remains bounded for many issues and duplicate slugs.
- Focused service and built-CLI tests, package typechecks/builds required by the
  touched public boundaries, and scoped diff verification pass.

## Scope

- In scope:
  - Query-owner issue summaries already produced by
    `readDerivedKnowledgeGraphWithIssues`.
  - Assistant Engine Knowledge list/search/show result and error semantics.
  - CLI Knowledge output schemas and focused deterministic coverage.
  - One production-derived real-Codex recovery journey only if implementation
    changes a model-owned prompt, tool-selection, argument, or reply boundary.
- Out of scope:
  - Knowledge writes, lint/rebuild behavior, generic query/search/timeline,
    Health Commons, Research Scout, and any new persisted state.

## Constraints

- Technical constraints:
  - Reuse the existing issue-isolating graph reader; do not add a second parser,
    projection, index, or recovery owner.
  - Keep issue metadata aggregate-only and bounded. Do not expose malformed
    content, parser prose, or absolute filesystem paths.
  - Preserve the reserved group-room-model exclusion and existing valid-page
    ordering/filter semantics.
- Product/process constraints:
  - Product UX Patch.
  - Outcome: an agent can use valid Knowledge results without mistaking a
    degraded read for complete truth.
  - Reaches: ordinary Knowledge list/search reads and exact show recovery in a
    vault containing malformed derived pages.
  - Proof: focused healthy/degraded service and built-CLI scenarios, plus a
    production-derived assistant journey when applicable.
  - The parent later expanded this delegated lane through scoped commits, a
    draft PR, and its PR-linked changelog entry; ReviewGPT remains parent-owned.

## Risks and mitigations

1. Risk: aggregate issue metadata accidentally becomes a new privacy leak.
   Mitigation: expose only closed issue categories, an aggregate count, and the
   fixed `knowledge lint` recovery action.
2. Risk: list totals accidentally count malformed, reserved, or unfiltered
   pages. Mitigation: derive total from the already-filtered generic graph before
   applying the requested limit.
3. Risk: an invalid exact slug is still mislabeled missing, or an unrelated bad
   page changes true not-found behavior. Mitigation: match only sanitized
   issue-relative paths for the requested canonical page path and test both
   branches.
4. Risk: changing result contracts leaves CLI/runtime consumers stale.
   Mitigation: update owning types and CLI Zod schemas together, build touched
   package boundaries, and exercise the built CLI.
5. Risk: repurposing legacy `pageCount` silently breaks existing consumers.
   Mitigation: preserve it as the returned-page count and add `totalCount` as
   the new pre-limit truth field.

## Tasks

1. [completed] Inspect Knowledge contracts, issue types, CLI schemas, and
   existing service/CLI/assistant-journey coverage.
2. [completed] Add the smallest bounded degradation projection at the Assistant
   Engine owner and wire it through list/search/show.
3. [completed] Update CLI schemas and focused deterministic tests for isolation,
   invalid target, totals/truncation, duplicates/bounds, and privacy.
4. [completed] Apply the real-Codex journey gate: no live journey is needed
   because this changes only the CLI machine result/error contract, not a
   model-owned prompt, tool description, availability, arguments, or reply
   policy; the focused built-CLI test is the direct terminal proof.
5. [completed] Run focused tests, relevant typechecks/builds, scoped diff checks,
   Product UX walkthrough, and final diff/privacy review.

## Decisions

- Keep valid results available when unrelated malformed pages exist; degraded is
  explicit rather than terminal.
- Treat only the exact malformed target as `knowledge_page_invalid`; unrelated
  issues do not change true not-found semantics.
- Recovery metadata is diagnostic output, not persisted product state.
- Preserve the legacy `pageCount` meaning and expose the valid filtered total
  only through the additive `totalCount` field.
- Match an invalid target by the malformed page file's slug-like basename so
  legacy nested pages receive the same truthful recovery as flat pages.
- Do not add stochastic model proof for a deterministic CLI envelope-only
  change with no production model boundary to exercise.

## Verification

- Commands to run:
  - Focused Assistant Engine Knowledge service tests.
  - Focused CLI Knowledge command tests against the built CLI.
  - Relevant Query/Assistant Engine/CLI typecheck and package build checks.
  - No live-model command: the real-Codex gate does not apply to this
    machine-envelope-only change.
  - `pnpm test:diff <changed paths...>` as the scoped completion lane.
- Expected outcomes:
  - Valid results remain readable with explicit bounded degradation metadata;
    totals and truncation are truthful; exact malformed targets are typed and
    recoverable; output remains private; no unrelated CLI family changes.

## Results

- Query contract tests: 3 passed.
- Assistant Engine Knowledge service tests: 15 passed.
- Built CLI degraded Knowledge journey: 1 passed; 2 unrelated cases skipped by
  the focused name filter.
- Query, Assistant Engine, and CLI typechecks: passed.
- CLI scenario integrity: 207 scenarios, 12 samples, and 29 golden directories
  passed.
- Canonical prepared runtime build, Query build, generated CLI schema/hash, and
  CLI package-shape verification: passed.
- `pnpm test:diff` reached every selected package boundary. Its Assistant CLI
  suite passed 136 tests, and its Assistant Engine suite passed 264 files and
  4,222 tests. One unrelated real-App-Server scripted file entered a 47-case
  cascade after its first case timed out at 90 seconds under concurrent machine
  load; subsequent failures showed a busy warm process and shifted scripted
  responses. The first failing case then passed alone in 24 seconds, proving the
  cascade was not caused by this patch.
- Assistant Engine TypeScript emit passed; its postbuild CLI-manifest command
  hit the existing 60-second `--llms-full` timeout tracked by the linked Frog
  issue. The canonical prepared runtime and direct CLI package-shape checks both
  passed afterward.
- `git diff --check`, final diff inspection, and identifier/privacy review:
  passed.

## Product UX walkthrough

Product UX readiness: Ready.

- Healthy Knowledge read: legacy `pageCount` retains its returned-count meaning;
  additive totals are exact and `degradation` is null.
- Valid read beside malformed pages: valid list/search/show data remains usable,
  reports bounded degradation, and points to `knowledge lint` without exposing
  content or paths.
- Exact malformed target: `knowledge show` returns the typed terminal
  `knowledge_page_invalid` recovery instead of falsely claiming the page is
  missing.
- Truly missing target: existing `knowledge_page_not_found` behavior remains
  distinct and unchanged.

## Outcome

The Knowledge CLI now degrades transparently and compatibly: valid information
stays available, completeness is machine-readable, and an agent gets one safe
recovery command for malformed data without a new parser, state owner, or
recovery abstraction.
Completed: 2026-08-30
