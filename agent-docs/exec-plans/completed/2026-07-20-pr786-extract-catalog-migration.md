# PR 786 Catalog Migration Extraction

## Goal

Reduce PR #786 to the durable product-test schema and product behavior by moving
one-time catalog acquisition, remap, audit, and reconciliation artifacts into a
local sibling `product-tests` repository.

## Scope

- Preserve the current one-time pipeline and its proof artifacts in the sibling
  repository before removing them from Murph.
- Restore Murph's pre-existing refresh utilities where the PR does not need to
  change their durable behavior.
- Keep the product-test schema fields required by the deployed data contract,
  the web/API/CLI behavior that exposes them, and focused regression coverage.
- Keep completed historical plans unchanged.
- Update the PR description and exact line-shape accounting after verification.

## Invariants

- Existing product-test rows and deployed schema remain compatible with web and
  CLI reads.
- Label search and contaminant product-detail behavior remain covered.
- No secret, private database value, local username, or home-directory path is
  copied into either repository.
- The sibling repository is local-only and uses neutral commit identity.
- ReviewGPT round six remains paused until the user explicitly approves
  exceeding the five-round cap.

## Verification

- Exact snapshot/readback and privacy scan of the sibling repository.
- Focused product-test, public-product, UI, contract, and CLI tests.
- Web and CLI typecheck/build coverage selected by `pnpm test:diff`.
- Required coverage-write audit and parent final diff review.
- Exact-head CI after push.

## Status

Completed.

## Result

- Preserved 57 files and 17,322 lines in a committed sibling local repository
  using a neutral noreply commit identity.
- Removed the one-time catalog adapters, raw fixtures, remap/audit utilities,
  reviewed operational data, and large database harnesses from the Murph diff.
- Restored Murph's pre-existing refresh/remap utilities and retained the durable
  schema, web/API/UI, CLI, contracts, and focused regression proof.
- Reduced the base-to-head Murph diff from 8,960 added lines to about 2,100 added
  lines including historical ReviewGPT and execution-plan records.

## Verification Result

- Focused web: 115 passed, 126 environment-gated skipped.
- Focused CLI: 13 passed.
- Focused contracts: 9 passed.
- Web, CLI, and contracts owner typechecks passed.
- Coverage-write found no meaningful missing proof and made no edits.
- Diff-aware verification passed dependency, boundary, architecture/privacy,
  affected typecheck, contracts, and assistant CLI stages; its assistant-engine
  leg exhausted the default Node heap after 2,519 passing tests while another
  heavy web verification held the shared host. The exact owner rerun under the
  exclusive verification slot with one worker passed 2,530 tests with 5 skipped.
- Scenario-manifest integrity, `pnpm no-js`, diff privacy scan, and
  `git diff --check` passed.
Status: completed
Updated: 2026-07-20
Completed: 2026-07-20
