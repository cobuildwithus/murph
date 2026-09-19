# Correct hosted E2E admission observation and expose safe provider outcomes

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Goal

- Make the reminder/device fairness proof observe its actual accepted runtime
  owner, and expose enough structural provider-stub evidence to diagnose the
  separate Junction request-count failure without recording request content.

## Success criteria

- The observer counts one accepted owner through a full 30-second window and
  detects every distinct replacement, including helper-origin starts.
- The existing reminder, device backlog, nudge, and model-request assertions
  retain their exact success criteria.
- Stub diagnostics report actual fixture selection and completed HTTP status;
  unit proof excludes prompt text and identifiers from published metadata.
- Focused tests, Cloudflare typecheck, complexity, docs, and privacy checks pass.
- Treat the separate Junction runtime diagnosis as follow-up; this test patch
  does not claim to resolve its model-request or dirty-state failures.

## Scope

- In scope: test admission observer, existing provider-stub failure metadata,
  focused tests, testing owner documentation, and the task's friction record.
- Out of scope: production scheduler changes, queue changes, relaxed assertions,
  deployment, data mutation, and claiming Junction fixed without evidence.

## Constraints

- Reuse existing runtime attempt identity, queue matching, response writers,
  scenario isolation, and failure formatter; add no production owner or fallback.
- Use only synthetic local E2E fixtures and the exact reviewed private worker.
  Preserve the active development database, ports, processes, and containers.
- Parent owns final candidate review, commit, PR, and subsequent merge decisions.

## Risks and mitigations

1. An older woken owner's start could shorten the observation window.
   Mitigation: anchor a fresh full window at wake acceptance and test that case.
2. Whole-history prompt matching could misidentify the current nudge turn.
   Mitigation: expose only a boolean for the latest user input, and retain the
   strict raw request-count assertion.
3. Diagnostics could expose request contents or mislabel an incomplete response.
   Mitigation: allowlisted fields only, null status until response completion,
   and focused metadata/privacy proof.

## Tasks

1. [x] Trace accepted owner/log identity and prove the observer's exclusion bug.
2. [x] Implement the bounded observer and eight fake-clock cases.
3. [x] Complete structural provider diagnostics and focused HTTP/privacy proof.
4. [x] Run relevant typecheck, complexity, docs, and candidate privacy checks.
5. [x] Hand the reviewed candidate and evidence to the parent for completion.

## Decisions

- Existing runtime logs intentionally omit member identity; bind the first owner
  by its accepted attempt and conservatively count later fresh owners from the
  isolated scenario's stdout instead of adding a production identity field.
- Junction remains an investigation. Diagnostics do not change queue selection,
  request counts, retry behavior, or success assertions.

## Verification

- Passed: combined observer, provider stub, and full-stack failure-formatter
  suites, 68 tests in 4.87 seconds, using the Cloudflare Node configuration with
  one worker and no file parallelism.
- Passed: `pnpm --dir apps/cloudflare typecheck`, `pnpm complexity:diff`,
  `pnpm docs:drift`, `git diff --check`, and candidate privacy readback.
- The initial typecheck caught an unavailable `findLast` API and an incomplete
  test helper action union; the final proof uses reverse traversal and the
  canonical accepted-response type, including replacement-owner coverage.

## Follow-up diagnosis

- The isolated synthetic Junction scenario is a separate diagnostic follow-up,
  with the reviewed private worker package supplied through the existing
  environment option. The canonical harness owns ephemeral databases, reserved
  ports, isolated persistence, and current-build cleanup. Preserve the strict
  scenario assertions and report the actual outcome without declaring a fix.
Completed: 2026-09-11
