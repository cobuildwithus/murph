# PR 2204 round-six recovery

Status: active
Created: 2026-08-24
Updated: 2026-08-24

## Goal

Close the accepted final-review gaps in the Vault CLI activity slice: prevent
the remaining generated daily-food title failure from partially writing, and
retain bounded stored scheduled-log schema reasons for operator/model recovery.

## Evidence

- `food schedule` preflighted only `auto-log-<slug>`. A valid 152-character
  food title with a short slug wrote the food and audit before core rejected
  the generated `Auto-log <title>` scheduled-log title at 161 characters.
- Core and query already shared the canonical stored frontmatter schema, but
  both discarded its issue reason and the CLI returned one generic registry
  sentence for every static shape failure.

## Design

- Export and reuse core's canonical generated-title builder before the first
  combined-command write. Keep core persistence validation unchanged.
- Return one owner-written `title` validation issue for this derived boundary.
- Carry only bounded schema issue code, static path, and reason from core/query
  to the existing CLI error context. Preserve the terminal no-write advice.
- Add no transaction, rollback coordinator, state owner, dependency, or generic
  redaction framework.

## Tasks

1. Add generated-title preflight and exact no-write command/use-case proof.
2. Preserve stored scheduled-log schema paths and reasons through core, query,
   and CLI with non-echoing command-family proof.
3. Run focused tests, affected typechecks, docs gates, prepared runtime, package
   shape, bundle/parity, and privacy/diff scans.
4. Commit and push the candidate, disclose the intentional timezone behavior
   in the PR, and run the next exact-head review with CI.

## Progress

- Generated-title preflight now returns `stage: validation` and field `title`
  before any food, audit, or scheduled-log write.
- Stored registry schema failures now preserve a bounded static path and reason
  plus the existing terminal no-write instruction.
- Focused core/query/use-case/CLI suites pass 67 distinct tests; affected package
  typechecks pass.
- Prepared-source and release-shaped suites pass; CLI package shape passes.
- Documentation drift and gardening gates pass.
- Vault CLI bundle is 9,467,360 bytes of 9,479,687; entry/static closure are
  805/25,155 bytes. Runner bundle is 11,272,688 bytes of 11,393,617;
  entry/static closure are 1,740,666/8,596,587 bytes. All eight parity probes
  pass.
