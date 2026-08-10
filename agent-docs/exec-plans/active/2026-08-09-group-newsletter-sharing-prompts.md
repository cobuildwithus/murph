# Group newsletter sharing prompts

Status: active
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- Give weekly group updates grounded same-period behavioral context when the
  authorized data supports it, without inventing causes.
- Request the complete selectable sharing set by default at the consent
  checkpoint while preserving explicit narrower requests and member opt-out.
- Let Murph author one natural native consent message through a strictly
  validated trusted-template boundary, and suppress only the redundant
  companion reply after a fresh native offer succeeds.

## Success criteria

- Newsletter prompt and product policy require contextual association, forbid
  unsupported causality, and include workout details in current-chat defaults.
- Omitted access-offer scopes resolve to the complete selectable scope set for
  native offers and standalone links; explicit scopes remain unchanged.
- `messageTemplate` accepts exactly one `{{share_scope}}` and one `{{join_url}}`,
  rejects unknown or incomplete placeholders, and safely falls back to trusted
  server copy.
- Only a freshly posted native offer returns the owned `kind: none` final action;
  reused, link, and failure paths remain reply-capable.
- Focused Assistant Engine and Web tests, exact-head CI, preliminary specialist
  review, final ReviewGPT, and parent final review complete with no unresolved
  accepted findings.

## Scope

- Existing Assistant Engine group/newsletter prompt, tool schema, adapter, and
  focused tests.
- Existing Web group-tool consent rendering/default resolution and focused tests.
- Current group newsletter product specification.

## Constraints

- Consent remains explicit and server-authoritative; defaults select requests,
  never grants.
- The model cannot choose substituted scope text or URL.
- No new state owner, dependency, service, queue, or persistence shape.
- Preserve unrelated worktree changes and keep confidential screenshots and
  identifying details out of repository artifacts.

## Tasks

1. [x] Inspect the rebased owners and replace the incomplete branch patch with
   the smallest complete implementation.
2. [x] Add focused regression coverage and run scoped local verification plus
   direct source-level scenario proof.
3. [x] Commit and push the exact candidate, open the PR with the required intent
   contract, and start specialist/final ReviewGPT concurrently with CI.
4. [ ] Resolve accepted findings, rerun affected proof, and complete parent
   review and merge-conflict proof.
5. [ ] Close this plan through `scripts/finish-task`, push the final head, and
   confirm all exact-head merge gates are green.

## Verification log

- `pnpm exec vitest run --config vitest.config.ts --no-coverage
  test/assistant-codex-group-tool.test.ts
  test/group-newsletter-automation.test.ts
  test/assistant-hosted-domain-tools.test.ts` from `packages/assistant-engine`:
  96 tests passed on the initial full focused run.
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage
  apps/web/test/hosted-group-tool.test.ts
  apps/web/test/hosted-onboarding-linq-http.test.ts`: 208 tests passed on the
  initial full focused run.
- Remediation rerun: 302 focused Web group, join-client, and Linq-provider tests
  passed; the final join-client-only rerun also passed.
- `pnpm typecheck` passed in `packages/assistant-engine`,
  `packages/hosted-execution`, and `apps/web`.
- Desktop and 390px mobile design-catalog proof captured the comprehensive
  selected-permission checkpoint with its bounded review area and visible join
  action.
- Exact-head CI and corrected ReviewGPT rounds remain pending on the remediation
  candidate.
