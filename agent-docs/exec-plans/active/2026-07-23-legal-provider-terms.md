# Land hardened launch legal and provider terms

Status: active
Created: 2026-07-23
Updated: 2026-07-23

## Goal

- Reconcile the supplied hardened legal/provider patch with current `main`.
- Publish a new launch-consent document set and regenerated deterministic PDFs.
- Make already-connected wearable providers available under the stated
  provider-permission assumption without weakening the member consent boundary.
- Preserve product-critical behavior while making stale launch consent visible
  and recoverable.

## Success criteria

- Current legal Markdown, document registry, generated PDFs, aliases, and
  manifest agree on the new versions and hashes.
- The hosted consent card accurately explains when an existing member must
  review updated documents.
- Existing members' current feature behavior is traced from stored consent
  versions through every affected launch, browser-vault, join, device-connect,
  companion, computer-use, and container-backed texting path.
- Focused tests, full acceptance, responsive UI proof, required review gates,
  CI, and final ReviewGPT pass for the exact PR head are complete.

## Scope

- Hosted legal documents, consent registry, consent UI, legal routes, and tests.
- Legal PDF generation and deterministic generated artifacts.
- Provider launch-gate documentation and configured wearable connection targets.
- The computer-use skill's connected-source restrictions.

## Constraints

- Treat the supplied patch as behavioral intent, not overwrite authority.
- Preserve unrelated work and current legal changes already on `main`.
- Assume the necessary wearable-company permissions exist, as instructed.
- Do not bypass member legal consent or source-specific authorization.
- Do not interrupt current inbound texts, hosted container wakes, or
  current-conversation replies when a prior document acceptance becomes stale.
- Do not add new persisted state or a second consent owner.

## Tasks

1. Reconcile every supplied hunk against current source and tests.
2. Regenerate legal PDFs and validate manifest/version/hash consistency.
3. Trace stale-consent behavior for existing members and add or correct proof
   where the supplied patch leaves a gap.
4. Complete responsive browser proof and required product/specialist/UI review.
5. Run canonical acceptance, close the plan, commit, push, open the PR, and
   complete final ReviewGPT plus CI.

## Evidence

- `pnpm --dir apps/web legal:pdf` regenerated the six current 2026-07-23
  documents and was deterministic on a second run.
- The 11 changed web test files pass locally (65 tests); the hosted web,
  assistant-runtime, and device-syncd typechecks pass.
- The focused assistant-runtime provider-offer suite passes (248 tests), and
  Crabbox runs passed the changed assistant-engine, assistant-runtime, and
  device-syncd owners. The broad dispatcher remains red on two unrelated
  existing Testbox failures: the hosted-local-harness repeated-signal timeout
  test and a vault-usecases fixture lookup for an ungenerated Health Commons
  artifact.
- Responsive proof covers the stale-consent gate and the provider register.
  At 1440px the seven-column register fits its wide breakout; at 390px the
  focused scroll region moves from `scrollLeft=0` to `40` with ArrowRight.
- Product-experience review accepted and verified two table-accessibility
  corrections, then returned `NO FINDINGS`.
- The required Claude Code UI check stopped at explicit credit exhaustion.
- Preliminary and final ReviewGPT/CI evidence remains pending.
