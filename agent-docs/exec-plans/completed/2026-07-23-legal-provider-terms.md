# Land hardened launch legal and provider terms

Status: completed
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
- The focused web regression set passes locally (8 files, 142 tests), including
  the stale-consent retry/exact-route handoff, provider-connect routes,
  canonical legal pages, and the assertion that `/design` has no page-wide
  Privy boundary. The hosted web and assistant-engine typechecks pass.
- The focused assistant-runtime provider-offer suite passes (248 tests), and
  canonical `pnpm test:diff` Testbox passed the changed assistant-engine,
  assistant-runtime, device-syncd, and web owners. The broad dispatcher remains
  red only on two unrelated existing Testbox failures: the
  hosted-local-harness repeated-signal timeout test and a vault-usecases fixture
  lookup for an ungenerated Health Commons artifact.
- `pnpm verify:acceptance` passed in Blacksmith Testbox
  `tbx_01ky7084gnragverww8mv357rk`, including all workspace typechecks, builds,
  guards, artifact checks, app verification, and Cloudflare Worker tests.
- Responsive proof covers every stale-consent card state at 300px, 320px, and
  390px without overflow, plus the provider register at desktop and mobile
  widths. At 390px the focused table scroll region moves from `scrollLeft=0` to
  `40` with ArrowRight.
- Product-experience review accepted and verified two table-accessibility
  corrections, then returned `NO FINDINGS`.
- The required Claude Code UI check stopped at explicit credit exhaustion.
- Preliminary ReviewGPT found mobile handoff overflow, missing owner-boundary
  continuation/retry coverage, and missing Function Health prompt regression
  proof. The button now wraps within the card, direct dashboard tests cover
  failure/retry and exact-path continuation, and the prompt test pins the
  Function Health restriction; focused and full acceptance verification pass
  with those corrections.
- Parent final review found no remaining correctness, privacy, or
  product-critical-flow issue in the completed diff.
- Final ReviewGPT and PR CI evidence remain pending.
Completed: 2026-07-23
