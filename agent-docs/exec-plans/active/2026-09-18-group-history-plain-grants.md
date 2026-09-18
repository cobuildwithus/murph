# Plain-grant group history follow-up — PR #3565

Status: candidate implemented and locally verified; database, preview, final review and CI gates pending.
Base: `13353ccc238be2554ba34735dfb988d394af06f5`.

## Outcome and scope

All existing active and new selected health metrics retain today plus the prior
89 member-local civil dates under their existing plain scope keys. No history
consent, regrant, alias/migration service, flags, or persistent rollout state.
The current owner is `agent-docs/product-specs/group-challenge-data-diagnostics.md`;
the earlier completed plan is immutable and no longer defines current policy.
No production access, mutation, deployment, or provider backfill is authorized.

## Implementation

- Remove the unreleased history authority field, duplicated registry/capabilities,
  supersession; preserve explicit-save refresh recovery and genuine sleep v0/v1
  mapping, immutable offers/replay identity, and per-metric revocation.
- Publish canonical-zone 90-date observations through existing producers and
  plain active-grant discovery. Keep 720 observations, 4 MiB complete rejection,
  256 KiB complete-date pages, and the short ordinary/email reporting boundary.
- Retain current membership, recipient, generation and workspace fences, four-
  ciphertext database-only batches, and crypto outside transactions. Metadata
  candidates are bounded by 200 × (3 requested + 2 sleep aliases + 1 profile);
  email metadata retains the 99 canonical non-email scope keys plus email authority.
- Render current policy for both new/existing Web selections and native saved
  offers; adapt detached-read schema and the targeted production-prompt live
  scenario without requiring a history permission or claiming absent coverage.

## Synthetic verification and remaining gates

The local isolated TypeScript/Node harness runs the existing focused contract,
producer-family and policy suites against the authored source without external
services. It is not Vitest, a full typecheck, a database proof, or a real-model
run. The handoff records exact executed results and patch-integrity checks.

The local owner must run hosted-execution history/contracts/runtime-control;
assistant-runtime projection/history-producer suites; Web grant/discovery/
delivery/shared-read/freshness/store/native/UI suites; Cloudflare runner-platform;
and assistant-engine group tool/parser/limits suites. Run the local PostgreSQL
grant lifecycle/deadline/concurrency proofs with the existing guarded test lane,
package typechecks, complexity/diff/docs checks and exact-head CI. The existing
real-model scenario `reports sparse 90-day history from an already-active metric
grant after following date pages` remains an explicitly authorized separate
verification gate; it was not invoked by the patch author.

## Deployment and rollback

Follow the owner's consumer-first release order: compatible parsers, Web readers
and snapshot/delivery handlers, Cloudflare transport and assistant schemas before
any 90-date runtime publication. Old no-zone snapshots stay ordinary-readable;
normal compatible publication unlocks longer available history on the same grant.
After new snapshots exist, keep those compatible consumers as the rollback floor.
No automatic grant rewrite, snapshot deletion, consent expansion, or live operation
is part of this task. Parent owns application, review, CI, archival and release.

## Parent execution

The local preparatory plan was consolidated into this authored plan before commit. The patch hash matches the captured response. The artifact downloader repeated the existing exact-turn export failure; its ordinary labeled download succeeded and the SHA-256 matched, reusing Frog `20260829230530-reviewgpt-patch-attachment`. No completed plan was changed.


Parent focused verification: 210 contract/parser, 147 runtime, 425 Web, 139
assistant and 217 Cloudflare tests pass. All five affected package typechecks
pass (final Web render-source check pending). The real assistant followed both
history pages for an already-active metric and accurately explained sparse
coverage without asking for expansion approval. Browser checks passed at 390px
and 1280px; existing settings have one selected metric, and per-metric toggling
still works. Parent inspected the rendered synthetic screens. Complexity guard
passes with no increased debt; scope-doubling machinery is removed. Restored
pre-existing explicit-save generation refresh recovery after reviewing its
original introduction; automatic expansion itself does not regrant anything.
The first PostgreSQL run used an outdated shared test schema; an isolated test
database is being prepared through existing migrations before rerunning.
