# 2026-03-27 Production Advice Follow-Up

## Goal

Close the remaining actionable gaps from the hosted-production advice review without inventing a broader redesign:

- make generic/internal hosted dispatch URLs first-class instead of preferring the old Cloudflare-public env naming
- make the hosted side-effect contract read as genuinely generic rather than "assistant outbox plus exceptions"
- add explicit Cloudflare container-image cleanup tooling and docs so frequent deploys do not quietly accumulate registry garbage

## Scope

- `packages/hosted-execution/src/env.ts`
- `apps/web/src/lib/hosted-execution/dispatch.ts`
- `apps/web/test/hosted-execution-dispatch.test.ts`
- `packages/assistant-runtime/src/{contracts.ts,hosted-runtime.ts}`
- `apps/cloudflare/{package.json,src/deploy-automation.ts,scripts/cleanup-container-images.ts,test/deploy-automation.test.ts,README.md,DEPLOY.md}`
- `docs/cloudflare-hosted-idempotency-followup.md`
- matching architecture/runtime/testing docs only if the documented contract meaning changes

## Constraints

- Preserve current hosted dispatch payloads and env aliases; this is a compatibility-preserving cleanup, not a control-plane rewrite.
- Do not claim stronger than reality for upstream transports that still have an unavoidable "send succeeded, marker write failed" edge.
- Keep image cleanup operator-driven and explicit; do not introduce destructive automatic deletion in the normal deploy path.
- Preserve adjacent dirty worktree edits in `apps/cloudflare`, `apps/web`, and docs.

## Planned Shape

1. Prefer the generic dispatch env names in shared hosted-execution env resolution and docs, while keeping the old Cloudflare aliases as compatibility fallbacks.
2. Tighten the hosted side-effect helpers/docs so the committed side-effect contract is framed generically even though assistant delivery remains the first implemented kind.
3. Add a small Cloudflare image-cleanup CLI wrapper and document when to run it after repeated deploys.

## Verification Target

- `pnpm --dir apps/cloudflare test`
- `pnpm --dir apps/web typecheck`
- targeted hosted-web and Cloudflare Vitest coverage for any changed helpers
- required repo checks after integration: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
