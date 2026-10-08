# Preserve required secrets during inference credential retirement

Status: completed
Created: 2026-10-07
Updated: 2026-10-07

## Goal

- Make protected inference-secret retirement uploadable by pinned Wrangler while preserving the canonical required-secret contract and all retained secret values.

## Success criteria

- Real Wrangler dry-run proof reproduces the duplicate Secret/Unsafe Metadata rejection with production-shaped `secrets.required` before the fix and passes afterward for disabled, empty, partial, and full synchronization.
- Every required secret is present in the retained baseline or synchronized payload. Retained inheritance stays pinned to the exact baseline; optional/crypto secrets and supplied rotations survive. Canonical artifacts and the post-upload inventory guard remain unchanged.
- Focused deployment tests, Cloudflare typecheck, complexity and documentation checks pass. Complete the plan, commit, push and open a draft PR for parent-owned review.

## Scope

- In scope: the existing temporary upload-config helper, realistic Wrangler regression fixtures, the deploy owner documentation, and a public-safe Frog proof-gap entry.
- Out of scope: private workflows, dependencies, new inputs, source/receipt changes, external mutations, deployment retries, ReviewGPT launch, and merge.

## Constraints

- Technical constraints: Wrangler validates duplicate config binding names before applying `--secrets-file`. Required declarations and unsafe inheritance must not duplicate a name in the temporary config. Preserve all other generated fields and relative paths.
- Product/process constraints: the existing public helper remains the source of truth consumed by private protected deployment. The parent owns final review and production execution.

## Risks and mitigations

1. Filtering declarations could hide missing required keys or permit unpinned default inheritance. Validate every original required name against baseline-plus-payload before removing only inherited-name declarations.
2. Removing redundant inheritance could lose rotations or optional keys. Test disabled, empty, partial and full synchronization through the actual pinned Wrangler serializer, plus existing stage/final activation guards.

## Tasks

1. Complete: all four real Wrangler dry-run modes reproduced duplicate Secret/Unsafe Metadata rejection before the fix. Pinned source confirms config validation precedes secret-file overlay.
2. Complete: the temporary config omits supplied names from inheritance, validates all original required names against expected inventory, and filters only inherited required declarations.
3. Complete: focused checks pass, the owner documentation and public-safe Frog entry record the corrected contract and proof gap. Candidate is ready for a scoped commit and draft-PR handoff; the parent owns final review, CI, merge and production execution.

## Decisions

- Keep the canonical generated config unchanged. No provider patch or new abstraction; required keys remain enforced by expected inventory and upload readback.
- The exact retired-name set, baseline version identity, canonical config, upload owner, activation guards, source receipts, and existing cleanup/retry behavior are unchanged.

## Verification

- Focused `deploy-retired-inference-secrets` and `deploy-worker-version-cli` Vitest suites, including real pinned Wrangler dry runs.
- `pnpm --dir apps/cloudflare typecheck`, `pnpm complexity:diff`, documentation checks, and `git diff --check`.
- Results: the four-mode real-Wrangler matrix failed before the fix and passes afterward. Both focused deployment files pass all 74 tests. Cloudflare typecheck passes after normal fresh-worktree Prisma generation. Complexity passes with the existing maximum unchanged at 19 and no hotspots above 20. Documentation drift/gardening and diff checks pass.
- Frog: `.agents/friction-log/20261007224008-worker-secret-cleanup/friction.md` records the omitted-required-declaration proof gap using synthetic configuration only.
- No production secret values, external mutations, deployment retries, merges, or ReviewGPT launches occurred in this task. Operational convergence remains owned by the parent.
Completed: 2026-10-07
