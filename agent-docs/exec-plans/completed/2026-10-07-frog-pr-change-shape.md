# Preserve complete evidence on Frog reconciliation pull requests

Status: completed
Created: 2026-10-07
Updated: 2026-10-07

## Goal

Generate the required change-shape evidence every time Frog rebuilds its sync PR body.

## Success criteria

- Derive Markdown and synchronization JSON line totals from a complete PR file inventory.
- Reject incomplete, duplicate, unsupported, or inconsistent inventory before editing the body.
- Preserve selection authority, idempotent normalization, and human text outside the owned footer.
- Complete focused proof, parent review, external ReviewGPT, and required CI.

## Scope

Only the existing reconciliation footer owner, its workflow read, regression tests,
owner documentation, and this task's public-safe friction entry change. No dependency,
permission, runtime, or issue-creation changes. Duplicate discovery is a separate
investigation; replay currently deduplicates correctly, so no speculative patch is added.

## Risks and mitigations

A truncated PR file list could produce false totals. Compare the unique inventory
count and summed line counts with the same PR response. Support only the Markdown
entry and generated synchronization JSON paths owned by the existing action.

## Decisions

Reuse one existing PR read with additional fields, the context normalizer, and the
existing workflow tests. No pagination lifecycle, new state, or authorization is added.
Internal-only behavior requires no member changelog or product journey.

## Verification

- Focused workflow guards: 14 passing cases, including composed CLI input,
  repeated normalization, changing totals, incomplete/duplicate inventory,
  unexpected paths, rename/binary-only rejection, and mismatched totals.
- Repo-tools TypeScript check, docs drift, and complexity guard pass; no changed
  function exceeds the complexity threshold (maximum 19).
- The current sync PR file inventory derives the exact added/deleted totals
  through the real CLI with an upstream action-shaped regenerated body.
- Parent candidate review passed across the complete implementation and evidence.
  External ReviewGPT and exact-head CI remain PR landing gates.
  No runtime deployment is required.
Completed: 2026-10-07
