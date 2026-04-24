# Land highest-value security review fixes

Status: completed
Created: 2026-04-24
Updated: 2026-04-24

## Goal

- Land the highest-value security review follow-ups that are still live across canonical write receipts, vault-sync import validation, OAuth connection setup, raw device snapshot identity, inbox model artifacts, and parser output persistence.

## Success criteria

- Guard receipts no longer copy sensitive canonical payloads to arbitrary operator-selected directories by default.
- Vault-sync import validates manifest file sizes and bounded pack shape before decoding heavy payloads.
- OAuth callback post-connect setup failure leaves no silently half-connected token-bearing account.
- Device snapshot raw evidence identity is stable across replay of the same provider/account/resource payload.
- Inbox model bundle commands avoid returning sensitive full bundle data unless explicitly requested and write artifacts privately.
- Parser output is runtime-validated and bounded before derived artifacts are written.
- Focused tests and the required verification/audit workflow pass, or unrelated blockers are named precisely.

## Scope

- In scope:
  - `packages/core` write-batch receipt and vault-sync import boundaries.
  - `packages/device-syncd` OAuth callback persistence/setup failure behavior.
  - `packages/importers` raw device snapshot envelope identity.
  - `packages/cli` inbox model bundle artifact output and permissions.
  - `packages/parsers` parser output runtime contracts.
  - Directly coupled tests and docs only if needed for truthfulness.
- Out of scope:
  - A full streaming vault-sync merge redesign beyond bounded pre-decode validation.
  - Broad provider-specific OAuth redesigns.
  - Rewriting canonical mutation, parser publication, or inbox model architecture.

## Constraints

- Technical constraints:
  - Preserve canonical vault ownership and existing package boundaries.
  - Do not add third-party dependencies for validation helpers when repo-local code is sufficient.
  - Keep sensitive artifacts private by default and avoid logging raw health/mail payloads.
- Product/process constraints:
  - Preserve unrelated in-flight ledger rows and working-tree edits.
  - Use the repo completion workflow for high-risk code changes.

## Risks and mitigations

1. Risk: Broad security fixes can sprawl into unrelated architecture.
   Mitigation: Implement the smallest safe boundary checks and add focused regression proof per finding.
2. Risk: Multiple active ledger rows mention overlapping files.
   Mitigation: Work from a clean tree, inspect current state first, and keep changes additive in the cited seams.

## Tasks

1. Inspect each reported seam to determine whether the issue is already landed.
2. Patch the remaining live guard receipt, vault-sync, OAuth, raw-ingest, inbox bundle, and parser output gaps.
3. Add focused tests for the changed security boundaries.
4. Run package/test:diff verification plus direct scenario checks where useful.
5. Run required `coverage-write` and `task-finish-review` audits.
6. Close the plan and create a scoped commit.

## Decisions

- Use bounded pre-decode validation for vault-sync now; defer a full streaming merge rewrite unless tests show it is required to stop the identified amplification path.
- No production changes were needed after re-triage. Each reported item is already covered in the current tree:
  - Guard receipts are hash/byte-count metadata only, use private modes, and no longer copy staged canonical payloads.
  - Vault-sync manifests enforce integer byte counts, file/total/per-file limits, actual-size checks before reads, and bounded JSONL validation.
  - OAuth post-persistence hook failures revoke provider access and mark stored accounts `reauthorization_required` with tokens cleared.
  - Raw wearable envelope IDs exclude `observedAt`; snapshot imports derive stable observed timestamps and replay tests assert stable envelope/artifact names.
  - Inbox model bundles write private artifacts and return the full sensitive bundle only behind the explicit sensitive flag; `derived/inbox` is excluded from vault-sync packs.
  - Parser provider outputs are runtime-normalized with text/markdown, block, table, metadata, and warning limits before private derived-artifact writes.

## Verification

- Commands run:
  - `git diff --check -- agent-docs/exec-plans/active/2026-04-24-2026-04-24-security-review-fixes.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  - `pnpm typecheck`
  - `pnpm test:smoke`
- Expected outcomes:
  - No production diff-test rerun is required because no production files changed; existing focused regression tests were confirmed by inspection in the cited packages.
Completed: 2026-04-24
