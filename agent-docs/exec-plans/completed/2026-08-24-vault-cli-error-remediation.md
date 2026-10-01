# Vault CLI error remediation

Status: completed
Created: 2026-08-24
Updated: 2026-08-24

## Goal

- Make supported Vault CLI validation and runtime failures precise enough for the
  assistant to correct one known input or prerequisite without guessing, while
  preserving redaction, bounded envelopes, and fixed bundle budgets.

## Success criteria

- Repeated blood-test and workout options identify a proven zero-based public
  occurrence and finite allowlisted leaf when that occurrence is uniquely known.
- Internal/sorted schema indices and arbitrary schema leaves never become public
  recovery paths; ambiguous missing children retain parent-only guidance.
- Retry guidance distinguishes unchanged transient retries, corrected new attempts,
  and safe stops when no concrete recovery guidance exists.
- Multi-item built-CLI tests prove exact occurrence/leaf guidance, no submitted-data
  echo, and no write on validation failure.
- Focused tests, affected typechecks, prepared runtime proof, and fixed Cloudflare
  runner bundle budgets pass.

## Scope

- In scope: blood-test `result`/`link` parsing; workout media/exercise/set validation
  projection in both the direct workout and scheduled-log typed owners; shared
  assistant CLI retry guidance; UNKNOWN fallback hinting; and focused
  source/built-boundary coverage.
- Out of scope: a global recovery registry, persisted repair state, generic schema
  path exposure, current-main reconciliation, pushing, and unrelated CLI owners.

## Constraints

- Technical constraints: public paths are owner-authored; repeated occurrence indices
  come only from original public option order; leaves are finite allowlists; raw
  submitted values and internal paths remain private; issue caps remain unchanged;
  bundle ceilings may not increase.
- Product/process constraints: preserve the live final ReviewGPT capture untouched;
  stop immediately if it returns findings or `RETROSPECTIVE_REQUIRED`; keep PR #2202
  Draft; hold the completed local remediation commit for parent diff review.

## Risks and mitigations

1. Risk: sorted or normalized arrays make internal schema indices look like public
   option occurrences.
   Mitigation: retain the original parsed option arrays and, only on validation
   failure, map exact assembled object references back to their original occurrence.
2. Risk: more precise guidance leaks values or uncontrolled schema vocabulary.
   Mitigation: format only numeric occurrences and finite owner-local leaf names, then
   prove multi-item no-echo behavior at the built CLI boundary.
3. Risk: additional mapping code exceeds tight runner bundle budgets.
   Mitigation: collapse owner-local duplication where it reduces code and run bundle
   measurement before the candidate is handed back.

## Tasks

1. Trace current blood-test, direct workout, and scheduled-log workout option parsing,
   assembly, validation, and public issue projection; identify the smallest explicit
   occurrence mapping shared by both workout owners.
2. Implement finite occurrence-plus-leaf public paths and preserve parent-only paths
   for non-unique repair targets.
3. Align assistant retry guidance and UNKNOWN projection with corrected new attempts
   versus unchanged retries and safe stops.
4. Add focused source and built-CLI tests for exact multi-item guidance in both workout
   owners, redaction, no-write behavior, and prompt/projection decisions.
5. Run focused tests/typechecks, prepared runtime proof, and runner bundle measurement;
   inspect the diff, close the plan, and create a scoped local commit without pushing.

## Decisions

- Accepted ReviewGPT findings are the bounded remediation scope; no preliminary rerun.
- Prefer owner-local mapping and existing projection helpers over a new abstraction.

## Verification

- Commands to run: focused Vitest from owning package roots; affected package
  typechecks; `pnpm verify:prepared-runtime`; CLI prepared/built tests; and
  `pnpm --dir apps/cloudflare runner:bundle`.
- Expected outcomes: all focused assertions pass, validation writes remain zero,
  submitted values are absent from envelopes, and every existing bundle cap remains
  green without a budget change.
Completed: 2026-08-24
