# PR 2204 round-six recovery

Status: completed
Created: 2026-08-24
Updated: 2026-08-25

## Goal

Close the accepted final-review gaps in the Vault CLI activity slice: prevent
the remaining generated daily-food title failure from partially writing, and
prevent stored scheduled-log validator prose from becoming model-facing repair
guidance.

## Evidence

- `food schedule` preflighted only `auto-log-<slug>`. A valid 152-character
  food title with a short slug wrote the food and audit before core rejected
  the generated `Auto-log <title>` scheduled-log title at 161 characters.
- Core and query already shared the canonical stored frontmatter schema. The
  first correction carried its issue reason into the CLI, but stored validator
  prose can contain arbitrary unknown keys or submitted values and is not a
  trustworthy model-facing field repair channel.

## Design

- Export and reuse core's canonical generated-title builder before the first
  combined-command write. Keep core persistence validation unchanged.
- Return one owner-written `title` validation issue for this derived boundary.
- Carry only the bounded schema issue code and finite static path from
  core/query. Render one fixed terminal read message and omit field errors for
  stored corruption. Preserve the terminal no-write advice.
- Add no transaction, rollback coordinator, state owner, dependency, or generic
  redaction framework.

## Tasks

1. Add generated-title preflight and exact no-write command/use-case proof.
2. Preserve only bounded stored scheduled-log schema codes and finite paths
   through core, query, and CLI with non-echoing command-family proof.
3. Run focused tests, affected typechecks, docs gates, prepared runtime, package
   shape, bundle/parity, and privacy/diff scans.
4. Commit and push the candidate, disclose the intentional timezone behavior
   in the PR, and run the next exact-head review with CI.

## Progress

- Generated-title preflight now returns `stage: validation` and field `title`
  before any food, audit, or scheduled-log write.
- Stored registry schema failures now preserve only a bounded code and finite
  static path for the fixed terminal read message. Raw issue messages and
  model-facing field errors are absent because stored corruption is not an
  editable command input.
- Focused core/query/use-case/CLI suites pass 67 distinct tests; affected package
  typechecks pass.
- Prepared-source and release-shaped suites pass; CLI package shape passes.
- Documentation drift and gardening gates pass.
- Vault CLI bundle is 9,467,360 bytes of 9,479,687; entry/static closure are
  805/25,155 bytes. Runner bundle is 11,272,688 bytes of 11,393,617;
  entry/static closure are 1,740,666/8,596,587 bytes. All eight parity probes
  pass.
- Integrated current `main` without retaining duplicate shared error projection
  or path-masking policy. The resulting tree is current `main` plus only this
  activity slice.
- Current-main proof passes 103 activity-focused tests, 188 shared-boundary
  tests, 14 bundle-budget tests, all seven affected package typechecks, prepared
  runtime, CLI package shape, docs drift, and docs gardening.
- The integrated Vault CLI bundle is 9,506,988 bytes of 9,515,546; entry/static
  closure are 805/25,155 bytes. The runner bundle is 11,329,361 bytes of
  11,393,617; entry/static closure are 1,751,098/8,648,745 bytes. All eight
  parity probes pass.
- ReviewGPT round six findings are resolved: the daily-food boundary validates
  both generated title and slug before its first write, and the PR contract
  discloses intentional date-only measurement timezone ownership. Round seven
  reached the seven-round cap but its browser capture ended before a marked
  response; the recovered thread evidence identified the remaining stored-
  issue prose channel above. Repository policy therefore stops the substantive
  loop rather than starting an eighth round.
- Corrected stored-corruption proof exercises list, show, pause, resume,
  archive, save, and import with an unknown-key sentinel, terminal `read`
  classification, no field errors, no echo, and no writes. Focused Core and
  Query suites, the submitted-validation regression, all three affected
  typechecks, and `git diff --check` pass. Production/test code deletes 41 net
  lines.
Completed: 2026-08-25
