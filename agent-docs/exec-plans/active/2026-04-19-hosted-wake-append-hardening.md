## Title

Fail closed on the Cloudflare hosted-wake append callback.

## Goal

Remove the generic Cloudflare hosted-wake append surface from the live path. Cloudflare should call a typed hosted email-ingress callback that carries only narrow email facts, and the old generic append route should fail closed.

## Scope

- `apps/web/app/api/internal/hosted-wake/{append,email-ingress}/route.ts`
- `apps/web/test/hosted-wake-routes.test.ts`
- `apps/cloudflare/src/{hosted-email/worker-ingress,web-control-plane}.ts`
- `apps/cloudflare/test/hosted-email-worker-ingress.test.ts`
- `packages/hosted-execution/src/{contracts,parsers}.ts`
- focused hosted-execution parser tests if the shared seam changes

## Constraints

- Keep `apps/web` as the canonical owner of hosted wake ordering and append policy.
- Do not allow `device-sync.wake`, `vault.share.accepted`, `member.*`, `assistant.cron.tick`, or non-email `conversation.message` wakes through the Cloudflare callback append surface.
- Web should derive the canonical email wake from narrow email-ingress facts instead of trusting a full wake object from Cloudflare.
- Preserve unrelated dirty-tree work in `apps/web`, `apps/cloudflare`, and `packages/hosted-execution`.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/web/app/api/internal/hosted-wake/append/route.ts apps/web/app/api/internal/hosted-wake/email-ingress/route.ts apps/web/test/hosted-wake-routes.test.ts apps/cloudflare/src/hosted-email/worker-ingress.ts apps/cloudflare/src/web-control-plane.ts apps/cloudflare/test/hosted-email-worker-ingress.test.ts packages/hosted-execution/src/contracts.ts packages/hosted-execution/src/parsers.ts`
- targeted Vitest commands only if the diff-aware lane leaves a direct proof gap

## Notes

- Direct proof must show the old Cloudflare-signed append route rejects non-email wakes while the typed hosted email-ingress route still appends successfully.

## Current status

- Implementation complete: the generic hosted-wake append route now fails closed and Cloudflare uses the typed hosted email-ingress callback instead.
- Web derives the canonical email wake from narrow email-ingress facts instead of accepting a caller-supplied generic wake payload.
- Static proof is present in the current code/tests:
  - `apps/web/app/api/internal/hosted-wake/append/route.ts` rejects the old generic append surface.
  - `apps/web/app/api/internal/hosted-wake/email-ingress/route.ts` builds only the email `conversation.message` wake shape.
  - `apps/web/test/hosted-email-ingress-route.test.ts` proves both the email-ingress success path and generic-append rejection path.
