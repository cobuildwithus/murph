# Replace generic Codex base instructions with Murph execution kernel

Status: active
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Replace Codex's generic coding-product base prompt in ordinary Murph turns
  with a compact Murph-owned execution kernel that preserves autonomous,
  careful end-to-end behavior without assuming every request is repository or
  terminal work.

## Success criteria

- Ordinary Codex thread starts receive the Murph base instructions through the
  existing app-server request field.
- The instruction contract remains below 3 KiB and retains hierarchy,
  tool-use, authorization, verification, progress, steering, and compaction
  behavior.
- The Codex contract fingerprint rotates when the kernel changes, while
  committed conversation-history recovery remains unchanged.
- Prompt diagnostics expose byte counts only and never prompt text.
- Focused Assistant Engine and Assistant Runtime tests, the truthful diff lane,
  and repository acceptance pass.
- The prompt and coverage specialist review returns no unresolved accepted
  finding, and the parent final review finds no remaining gap.

## Scope

- In scope:
  - Assistant Engine base-instruction ownership and app-server forwarding.
  - Codex contract fingerprinting and metadata-only diagnostics.
  - Focused regression coverage in Assistant Engine and Assistant Runtime.
- Out of scope:
  - Specialized read-only group and outgoing-reviewer base prompts.
  - Model selection, reasoning configuration, context windows, tools, apps,
    plugins, permissions, or collaboration support.
  - New dependencies, schemas, environment variables, flags, or services.

## Constraints

- Technical constraints:
  - Use the existing `baseInstructions` app-server field and existing contract
    fingerprint seam.
  - Preserve provider-native thread continuity semantics and committed
    transcript fallback during intentional thread rotation.
  - Keep diagnostics metadata-only.
- Product/process constraints:
  - Preserve Murph's general autonomy and persistence while removing
    coding-agent-specific assumptions.
  - Follow the prompt-primary worktree, exact-pushed-head specialist review,
    verification, scoped commit, and PR workflow.
  - Preserve concurrent prompt work recorded in the coordination ledger.

## Risks and mitigations

1. Risk: An underspecified replacement reduces autonomous task completion.
   Mitigation: Keep explicit end-to-end execution, tool use, verification,
   progress, steering, compaction, and honest-blocker rules under a tested
   3 KiB budget.
2. Risk: Existing native threads resume under a different instruction
   contract.
   Mitigation: Include the exact base instructions in the existing Codex
   contract fingerprint so changed instructions rotate the provider thread.
3. Risk: Prompt diagnostics leak instruction text.
   Mitigation: Add only a byte-count field and lock redaction with focused
   runtime tests.

## Tasks

1. Inspect the supplied patch against current owners, tests, and concurrent
   prompt work.
2. Integrate the smallest current-tree implementation and update focused
   regression coverage.
3. Run focused tests, truthful diff verification, and acceptance.
4. Commit and push the exact review candidate, open the PR, and run the
   preliminary prompt/coverage specialist pass.
5. Resolve accepted findings, perform the parent final review, close the plan,
   push the final head, and prove merge readiness and green CI.

## Decisions

- Classified as prompt-primary with mechanical forwarding, fingerprint, and
  diagnostic support. It does not change a product-owned member journey, so
  local product-experience review and the separate final ReviewGPT gate are not
  selected unless implementation scope expands.

## Verification

- Commands to run:
  - Focused Assistant Engine and Assistant Runtime Vitest files.
  - `pnpm test:diff` for every touched owner path.
  - `pnpm verify:acceptance`.
  - `git diff --check` and prompt byte-count/readback checks.
- Expected outcomes:
  - All checks pass with no prompt text in diagnostics and no unresolved
    specialist or parent-review findings.
