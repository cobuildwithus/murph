# junction-pagination-safe-default-timeseries

Status: active
Created: 2026-08-12
Updated: 2026-08-13

## Goal

- Make Junction's exhaustive code-owned timeseries resource set complete within
  the hosted runtime's bounded execution model, including paginated provider
  responses, without adding another scheduler or persisted state owner.

## Success criteria

- A full job commits progress in a provider request unit that cannot be erased
  by the outer hosted-runtime deadline.
- Omitted configuration and production configuration request every supported
  canonical Junction timeseries resource from one exhaustive contract; explicit
  empty and exact supported overrides remain authoritative.
- A continuation resumes timeseries work without repeating already-completed
  provider inventory, summary, or historical scheduling work.
- Weight reconnect resets source-scoped extended-history coverage through the
  shared coverage-matrix owner.
- Focused tests prove pagination and cancellation progress, default resources,
  source-scoped reconnect, and existing history semantics.
- The exact pushed head passes ReviewGPT and required GitHub checks.

## Scope

- In scope: ReviewGPT round 9's accepted pagination/progress finding, integration
  with the frequency-aware history policy and matrix, regression tests, and
  truthful durable documentation.
- Out of scope: raw dense sample persistence, a new table/queue/service, opaque
  vendor cursors in product state, or per-member resource preferences.

## Constraints

- Keep the existing Junction job, payload, queue, import, and source-admission
  owners. Persist only complete canonical hourly, daily, or per-reading units.
- Keep every supported canonical timeseries resource enabled by default. Dense
  resources remain compact and bounded; weight keeps extended sparse history.
- Use the existing PR ReviewGPT loop; inspect and verify every accepted change.

## Tasks

1. Derive configured and omitted resource defaults from one exhaustive registry.
2. Bound page work and enter durable timeseries continuations directly.
3. Move weight reconnect reset onto the shared source/resource matrix.
4. Run focused tests and affected typechecks, then finish and push the task.
5. Run exact-head ReviewGPT concurrently with required CI and resolve findings.

## Verification

- Completed: integrated the current branch; reconciled its newer resource and
  history owners; passed the full Junction provider and service suites; passed
  the focused contracts, configuration, coverage-matrix, importer,
  health-metrics, assistant-runtime, and Web checks; passed affected package
  typechecks; and completed privacy and diff checks.
- Remaining: exact-head ReviewGPT, required PR checks, parent final review, and
  plan closure.
