# Linq Attachment Egress Allowlist

## Goal

Restore production hosted Linq image/media intake by allowing the runner's
credential-injection egress path to fetch Linq attachment metadata.

## Scope

- `apps/cloudflare/src/runner-egress-intercept.ts`
- `apps/cloudflare/test/runner-egress-intercept.test.ts`
- `apps/cloudflare/test/hosted-local-linq-webhook-e2e.test.ts`

## Constraints

- Preserve fail-closed provider egress and runtime write-fence checks.
- Do not expose attachment locators, user/contact identifiers, provider
  payloads, secrets, or authorization values in code, tests, logs, docs, or
  handoff.
- Keep the change limited to the production-style Linq metadata read path.
- Preserve unrelated dirty worktree edits.

## Plan

1. Add the missing `GET /attachments/{id}` Linq egress allowlist entry.
2. Add focused tests proving credential injection and write-fence enforcement
   for attachment metadata reads.
3. Strengthen the hosted-local Linq image E2E so it proves the metadata lookup,
   byte download, and multimodal provider input path together.
4. Run focused Cloudflare test coverage plus typecheck as required.
5. Close the plan with a scoped commit if unrelated dirty work does not block
   the safe commit path.

## Verification

- `pnpm exec vitest run apps/cloudflare/test/runner-egress-intercept.test.ts --config apps/cloudflare/vitest.node.workspace.ts --no-coverage -t "attachment metadata"` passed.
- `pnpm hosted-local e2e linq-webhook --no-bundle` passed all 6 Linq webhook E2E tests, including image and audio paths.
- `pnpm typecheck` passed.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-egress-intercept.ts apps/cloudflare/test/runner-egress-intercept.test.ts apps/cloudflare/test/hosted-local-linq-webhook-e2e.test.ts` passed.
- `git diff --check` passed for the scoped Cloudflare files and this plan.

## State

- Fix and verification complete. Production logs showed Linq image attachment
  metadata lookup returning HTTP 403 before bytes were stored, while the local
  E2E only exercised a raw-token local stub path.
Status: completed
Updated: 2026-05-22
Completed: 2026-05-22
