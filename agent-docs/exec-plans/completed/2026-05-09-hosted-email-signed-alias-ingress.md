# Hosted email signed alias ingress

Status: completed
Created: 2026-05-09
Updated: 2026-05-09

## Goal

- Fix Cloudflare-hosted email ingress so a signed per-user reply alias can route an active signed-up member even though Cloudflare Email Workers do not expose a trusted sender-authentication verdict.

## Success criteria

- Signed reply-alias ingress resolves through the existing web-owned `replyAliasLookupKey` and active member check without requiring a provider-authenticated sender verdict.
- Direct mail to the fixed public sender address still fails closed unless an accepted authenticated-sender verdict is supplied by a future trusted verifier seam.
- Cloudflare does not parse raw `Authentication-Results`, `ARC-*`, envelope `from`, or header `From` as sender proof.
- The authorization label and security docs no longer imply that reply aliases prove SMTP sender identity.
- Focused Cloudflare and web tests cover alias success without a verdict and direct-public fail-closed behavior.

## Scope

- In scope:
  - `apps/cloudflare/src/hosted-email/routes.ts`
  - `apps/web/app/api/internal/hosted-execution/email/resolve-route/route.ts`
  - Focused hosted email route/worker/web callback tests.
  - `agent-docs/SECURITY.md`, `agent-docs/references/hosted-runtime-protocol.md`, and `agent-docs/index.md` trust-boundary doc updates.
- Out of scope:
  - New tables, migrations, per-thread aliases, random alias rotation, or broad mailbox redesign.
  - Parsing raw email authentication headers as proof.
  - Changing outbound email transport beyond the existing stable per-user reply alias.

## Constraints

- Keep architecture simple: reuse the existing signed alias token, `replyAliasLookupKey`, signed Cloudflare-to-web callback, and active member gate.
- Treat a reply alias as a private bearer routing capability, not proof of human sender identity.
- Preserve all unrelated dirty worktree edits and active plans.

## Risks and mitigations

1. Risk: The alias path is mistaken for SMTP identity proof.
   Mitigation: Rename the Cloudflare route authorization label and document that direct-public sender identity still needs a trusted verdict.
2. Risk: Direct public email accidentally becomes routable without Cloudflare sender auth.
   Mitigation: Keep the direct-public verdict gate in both Cloudflare and web callback code, with focused tests.
3. Risk: The callback starts doing unnecessary email-authorization reads for alias replies.
   Mitigation: Make the alias branch only look up the alias key plus active member state.

## Tasks

1. Split alias and direct-public route authorization in Cloudflare.
2. Split alias and direct-public resolution in the web callback.
3. Update focused tests for the new trust boundary.
4. Update security docs.
5. Run focused verification, completion audits, close the plan, and commit.

## Verification

- Passed:
  - `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --project cloudflare-node-platform --no-coverage apps/cloudflare/test/hosted-email-routes.test.ts apps/cloudflare/test/hosted-email-worker-ingress.test.ts apps/cloudflare/test/hosted-email.test.ts`
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --project hosted-web-execution --no-coverage apps/web/test/hosted-execution-email-callback-routes.test.ts`
  - `pnpm typecheck`
  - `pnpm docs:drift`
  - `git diff --check -- <scoped task paths>`
- Audits:
  - `security-privacy-review`: no blocking issues; fixed low-severity sender metadata minimization and durable-doc clarity findings.
  - `coverage-write`: added a direct-public envelope/header mismatch regression.
  - `task-finish-review`: no blocking issues; fixed non-blocking reply-alias participant wording.
- Unrelated broader verification failures:
  - `bash scripts/workspace-verify.sh test:diff <scoped task paths>` failed in `apps/cloudflare verify` because `apps/cloudflare/test/deploy-automation.test.ts` has an unrelated deploy workflow expectation mismatch.
  - `pnpm --dir apps/web verify` failed because unrelated hosted-onboarding/crypto tests currently lack `hostedMemberIdentity.findMany` on their Prisma mocks; web lint and Next build completed.
Completed: 2026-05-09
