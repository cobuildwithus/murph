# Remove obsolete snapshot artifact index and align recovery fixtures

Status: active
Created: 2026-09-10
Updated: 2026-09-10

## Goal and accepted scope

Apply the accepted single Complexity Collapse from PR #3190 round 1: remove the persisted artifact-availability index after confirming that no current decision reads it. The original completed execution plan remains immutable.

Remove its persistence owner, exports, mutable inputs, restore fields/reads, and count metric. Keep per-call materialized/missing results, the canonical media catalogue, expiry/size/digest/path guards, receipt recovery, and clean-checkpoint markers. Historical index files remain inert; add no migration, enumeration, replacement state, or cleanup process.

Exact-head CI also exposed retired snapshot fixtures in the Cloudflare bridge and runtime workspace-runner suites. Preserve supported checkpoint, encrypted archive, dangling-Codex, and stale-import recovery assertions using v2 fixtures; remove only dedicated pre-v2 materialization assertions and add explicit rejected-shape proof before mutation.

## Decisions and risks

- Media reuse is derived from current local file size and digest. Ordinary-file availability remains a bounded filesystem check; no cache state is needed.
- The shared test snapshot port must replace its prior roots after fixture extraction, matching current v2 ownership. It is fixture transport; real encrypted staging and rollback remain covered by Cloudflare tests.
- Preserve latest main's generated-capture retention cases while adapting their materializer constructor.
- Deployment order and rollback floors remain as documented by the live Cloudflare deploy owner. No production actions or data migration are part of this correction.

## Tasks and verification

1. Cross-check all index consumers and remove only obsolete persistence/plumbing.
2. Preserve per-call/materializer, receipt, media retention, and v2 boundary proofs.
3. Reconcile current main, then run affected runtime and Cloudflare suites, both relevant typechecks, complexity, docs drift, and privacy/whitespace checks.
4. Commit and push the stable correction; retain the first reviewed head in the PR body and hand the same-thread review continuation to the parent.

Progress: source deletion and cross-consumer audit complete. The first focused runtime run passed 216 of 217 tests; the sole failure exposed fixture overlay behavior, and the staged replacement correction passed the exact stale-import regression. Final merged-tree proof is pending.
