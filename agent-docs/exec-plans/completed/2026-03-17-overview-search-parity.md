# Overview search parity

Status: completed
Created: 2026-03-17
Updated: 2026-03-17

## Goal

- Remove the duplicated lexical search engine in the web overview path by reusing shared query scoring/tokenization/snippet logic while preserving the web surface's safe-field restrictions.

## Success criteria

- The web overview search builds a safe, whitelisted search-document shape instead of maintaining its own scorer/tokenizer/snippet implementation.
- Shared query search utilities own scoring, tokenization, sorting, and snippet behavior for both query and overview search.
- Web results still avoid path leakage and do not expose raw structured payloads beyond the existing safe surface.
- Tests cover hyphenated terms, Unicode-ish token handling, one-character queries, and no path leakage in web results.

## Scope

- In scope:
- shared lexical-search utility refactor in `packages/query`
- overview search wiring in `packages/web`
- focused parity tests in query and web
- Out of scope:
- changing the query package's public search result payload shape outside what is needed to support safe shared scoring
- changing the web overview response contract beyond search behavior parity and safety preservation

## Constraints

- Keep field whitelisting in the web layer so overview search cannot match on paths or raw structured record data.
- Preserve current sort/ranking semantics unless the shared query implementation already defines the intended behavior.
- Avoid introducing internal-package imports from web; use the query package public entrypoint if cross-package reuse is needed.
- Follow the repo completion workflow and required verification commands.

## Risks and mitigations

1. Risk: exporting raw query search helpers could encourage unsafe direct reuse with full-path fields in the web package.
   Mitigation: reuse only generic document-scoring helpers that operate on caller-provided pre-sanitized documents, and keep safe field selection local to `overview.ts`.
2. Risk: tokenization changes can alter result counts and snippet anchors in subtle ways.
   Mitigation: add direct parity tests for the known drift cases before relying on behavior.
3. Risk: web result mapping could accidentally leak query-only fields such as `path`.
   Mitigation: map shared hits back into the existing overview result shape and assert no-path behavior in tests.

## Tasks

1. Extract or expose shared search-document scoring/snippet utilities from `packages/query`.
2. Rewire `packages/web/src/lib/overview.ts` to build safe search documents and delegate scoring/snippet generation.
3. Add query and web parity tests for tokenization/snippet/path-safety cases.
4. Run completion-workflow audits, required verification, and commit the scoped files.

## Verification

- Required repo checks: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
- Focused checks: targeted query/web Vitest runs as needed during implementation
Completed: 2026-03-17
