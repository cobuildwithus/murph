# Retire unused hosted inference secrets

Status: completed
Created: 2026-10-07
Updated: 2026-10-07

## Goal

- Remove exactly the retired Venice and Vercel AI Worker secrets through the existing protected upload, preserving every retained secret, rendered binding, and deployment receipt.

## Success criteria

- Uploaded stage and final versions omit `VENICE_API_KEY` and `VERCEL_AI_API_KEY`; retained secrets inherit from the exact live baseline and synchronized values still win.
- Malformed inventories and unexpected uploaded secret sets stop before activation. Existing Web admission, live identity, native rollout, smoke, and receipt guards remain authoritative.
- Focused deployment tests, Cloudflare typecheck, complexity and documentation checks pass; scoped commit and draft PR handed to the parent for review.

## Scope

- In scope: the current public Worker upload owner, a small fixed-purpose helper, synthetic behavior tests, deploy documentation, and obsolete local example comments.
- Out of scope: private workflows, new inputs or dependencies, general pruning, local production secret access, deployment, external credential deletion, merge, and ReviewGPT launch.

## Constraints

- Technical constraints: Wrangler 4.93 preserves omitted secrets by default. Its unsafe binding passthrough supports explicit-version inheritance and its metadata override disables blanket preservation. Keep the canonical generated config untouched and write the upload derivative beside it to preserve relative paths.
- Product/process constraints: public Murph owns the helper; the existing private protected workflow consumes it. Deploy cleanup only after OpenAI Worker/runner consumers converge. No member-facing behavior changes or changelog item.

## Risks and mitigations

1. Missing optional keys could be accidentally pruned. Derive all retained names/types from the exact baseline, not just the current generated secret contract.
2. Stage/final uploads could lose synchronized rotations. Keep normal `--secrets-file` precedence on both uploads and prove the complete expected secret inventory before each activation.
3. Old consumers could still need removed credentials. Document consumer convergence as the first cleanup deployment prerequisite; retain existing protected rollout and rollback boundaries.

## Tasks

1. Complete: exact-name retirement uses the existing upload owner and validates uploaded metadata before either activation.
2. Complete: focused proof covers malformed metadata, optional/crypto secret retention, synchronization, relative paths, stage/final ordering, and repeat attempts. Pinned Wrangler's actual offline serializer proves explicit-version inheritance and payload precedence.
3. Complete: updated the deploy owner and obsolete example comments; candidate is ready for scoped commit and draft-PR handoff. The parent owns final external review, CI, merge, and any production execution.

## Decisions

- No separate administrative workflow or secret-delete command. No inherited latest-version assumption. No persisted cleanup state.
- Existing artifact validation stays before config enrichment. The enriched config contains secret names and version IDs only.
- Each upload receives a unique adjacent temporary config; the upload owner removes that exact file on success, upload failure, or readback failure. Canonical artifacts remain reusable.

## Verification

- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/deploy-worker-version-cli.test.ts apps/cloudflare/test/deploy-retired-inference-secrets.test.ts --no-coverage`
- `pnpm --dir apps/cloudflare typecheck`
- `pnpm complexity:diff`, `pnpm docs:drift`, `pnpm docs:gardening`, and `git diff --check`.
- Results: both focused test files pass, 68 tests total; Cloudflare typecheck passes. Complexity passes with no functions above 20 (new helper maximum 19; existing CLI maximum unchanged at 11). Documentation drift/gardening and diff checks pass.
- Fresh-worktree typecheck initially lacked generated Prisma types; the existing `prisma:generate` script resolved this without source edits. Frog already tracks this as `20260826160413-fresh-worktree-web`; no new entry or workaround was needed.
- Deployment remains unperformed. First cleanup requires converged OpenAI Worker/runner consumers and the existing protected workflow. Current OpenAI releases are the rollback floor; restoring legacy inference requires separately reviewed configuration and consumer recovery.
Completed: 2026-10-07
