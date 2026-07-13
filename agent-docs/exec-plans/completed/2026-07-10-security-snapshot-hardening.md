# Harden encrypted snapshot restore boundaries

Status: completed
Created: 2026-07-10
Updated: 2026-07-11

## Goal

- Ensure an authenticated but unsafe hosted workspace archive cannot write paths or entry types outside the capture contract before restore replaces the durable workspace.
- Reduce snapshot leakage impact by eliminating persisted tar/zstd stderr bodies and shortening prepared restore GET capabilities.

## Success criteria

- Restore performs a complete non-extracting archive inventory after ciphertext/hash authentication and before extraction, using the same path/type policy as capture.
- Absolute/traversal/duplicate paths, `.env*`, links, special/unknown entries, excessive entries/bytes, and authenticated manifest-count/size mismatches fail closed without replacing the existing durable root.
- Snapshot command failures persist only classified metadata such as stage, exit/signal, counts, and truncation—not stderr text or relative vault filenames.
- Restore-only R2 GET capabilities use a ten-minute lifetime in prepared and fallback paths while PUT behavior remains unchanged.
- Focused adversarial tests, full acceptance, required security/privacy and coverage audits, parent final review, PR ReviewGPT, and PR CI pass.

## Scope

- In scope: `apps/cloudflare` v2 snapshot archive inventory/restore validation, snapshot command diagnostics, restore GET TTL, focused Node/Workers tests, and matching security/runtime/deploy documentation.
- Out of scope: TEE/independent key authority, runtime egress isolation, root rotation, snapshot AAD generation redesign, assistant descriptor-authoritative selection, legacy snapshot deletion, and unrelated runner/container lifecycle code.

## Constraints

- Technical constraints: authenticate/decrypt/hash first, validate the entire archive without extracting, then extract into staging; reuse capture-side parsing/policy rather than create a second archive grammar.
- Product/process constraints: preserve valid v2 and required legacy restore success paths; keep Cloudflare execution thin; avoid overlapping active runner-egress/container work.

## Risks and mitigations

1. Risk: tar listing and extraction semantics could diverge or double resource usage.
   Mitigation: one bounded parser/policy, explicit entry/byte limits, abort propagation, and production-command fixture tests.
2. Risk: stricter validation could strand legitimate snapshots produced by current capture.
   Mitigation: derive allowed entries from the existing capture contract and test representative current snapshots plus required legacy compatibility separately.
3. Risk: shorter URLs could expire during slow restore.
   Mitigation: change GET only, retain bounded retry/re-preparation behavior already owned by the restore flow, and test the exact TTL contract.

## Tasks

1. Reconfirm current v2 restore ordering, capture inventory policy, failure diagnostics, and prepared/fallback GET capability creation.
2. Extract/reuse the minimal archive inventory parser and validate every entry plus authenticated counts/bytes before extraction.
3. Replace persisted stderr detail with classified metadata and add filename-leak regressions.
4. Set and test the ten-minute restore GET capability lifetime without changing upload capability semantics.
5. Update matching security/runtime/deploy docs and capture direct valid/adversarial restore proof.
6. Run acceptance, security/privacy review, coverage-write, parent final review, and resolve findings.
7. Finish the plan, commit, push, open the draft PR, and complete ReviewGPT/CI/mergeability gates.

## Decisions

- Keep this PR entirely on the Cloudflare snapshot boundary; defer assistant descriptor selection to avoid coupling with active assistant-runtime snapshot work.
- Preserve only structured command-failure metadata, never stderr bodies.
- Validate before extraction and before durable-root replacement; failed validation leaves the prior root untouched.

## Verification

- Commands to run: focused workspace-snapshot/runner-platform/R2 tests; `pnpm test:diff` for touched `apps/cloudflare` and docs; `pnpm verify:acceptance`; direct valid/adversarial archive scenario; `git diff --check`; required audits; PR ReviewGPT and CI.
- Expected outcomes: valid snapshots restore, unsafe archives are rejected before extraction/replacement, diagnostics contain no injected path marker, GET TTL is exact, and all gates pass without secret or identifier leakage.
Completed: 2026-07-11
