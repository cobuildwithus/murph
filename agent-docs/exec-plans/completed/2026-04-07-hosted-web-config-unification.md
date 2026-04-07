# Unify hosted web public-origin and callback auth config docs

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Keep hosted public-origin precedence and Cloudflare callback-auth configuration in one operator-facing place under the hosted web app docs so operators do not have to reconcile duplicate guidance across web, Cloudflare, and shared-package docs.

## Success criteria

- `apps/web/README.md` states the canonical public-base precedence and Cloudflare callback key contract in one dedicated section.
- Adjacent hosted docs keep only the minimum context they need and point back to `apps/web/README.md` instead of restating the full operator contract.
- The touched docs read back cleanly and `pnpm typecheck` passes on the low-risk docs/tooling fast path.

## Scope

- In scope:
- `apps/web/README.md`
- `apps/cloudflare/DEPLOY.md`
- `packages/hosted-execution/README.md`
- this execution plan and the coordination ledger
- Out of scope:
- runtime code or env-name changes
- auth-behavior changes for hosted dispatch or callback verification
- broader hosted architecture edits outside this config-doc cleanup

## Constraints

- Technical constraints:
- Keep the documented public-origin precedence aligned with `apps/web/src/lib/hosted-web/public-url.ts`.
- Keep the documented callback key responsibilities aligned with `apps/web/src/lib/hosted-execution/cloudflare-callback-auth.ts` and `apps/cloudflare/src/web-callback-auth.ts`.
- Product/process constraints:
- Preserve unrelated dirty hosted-worktree edits.
- Stay on the docs/process-only workflow unless the scope expands.

## Risks and mitigations

1. Risk: rewriting overlapping hosted docs too broadly while other hosted lanes are active.
   Mitigation: keep the diff limited to config wording, re-read each touched doc before editing, and avoid unrelated line churn.
2. Risk: centralizing the prose but misstating env precedence or callback key ownership.
   Mitigation: ground the wording in the current web and Cloudflare env helper implementations before editing.

## Tasks

1. Register the docs-only lane and capture the concrete scope in this plan.
2. Add one canonical hosted-web config section for public-origin precedence and Cloudflare callback auth in `apps/web/README.md`.
3. Trim duplicate operator guidance from Cloudflare and shared-package docs and replace it with short pointers back to `apps/web/README.md`.
4. Run docs-only verification, read back the touched docs, and finish with a scoped commit.

## Decisions

- Keep the operator-facing contract in `apps/web/README.md` because hosted public-origin resolution and callback verification both live in the hosted web app, while Cloudflare only owns the signing half of the callback keypair.
- Leave runtime behavior unchanged; this task is documentation consolidation only.

## Verification

- Commands to run:
- `pnpm typecheck`
- direct readback of the touched Markdown files
- Observed result:
- direct readback passed for the touched docs
- `pnpm typecheck` is currently red for unrelated existing errors in `packages/core/src/vault.ts` and `packages/assistant-engine/src/usecases/{integrated-services,workout-measurement,workout-model}.ts`
- Expected outcomes:
- Typecheck passes on the low-risk docs/tooling lane.
- The touched docs consistently point operators to `apps/web/README.md` for hosted public-origin and Cloudflare callback-auth config.
Completed: 2026-04-07
