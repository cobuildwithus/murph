# Group newsletter sharing prompts

Status: active
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- Give weekly group updates grounded same-period behavioral context when the
  authorized data supports it, without inventing causes.
- Request the complete selectable sharing set by default at the consent
  checkpoint while preserving explicit narrower requests and member opt-out.
- Use one natural Web-owned native consent message whose affirmative reaction
  meaning cannot be redefined by model prose, and suppress only the redundant
  companion reply after a fresh native offer succeeds.

## Success criteria

- Newsletter prompt and product policy require contextual association, forbid
  unsupported causality, and include workout details in current-chat defaults.
- Omitted access-offer scopes resolve to the complete selectable scope set for
  native offers and standalone links; explicit scopes remain unchanged.
- The assistant surface exposes no consent-copy template; Web substitutes the
  frozen scope description and first-party URL into its canonical affirmative
  reaction sentence and ignores the legacy wire field.
- Existing members can see and revoke the union of the current request and
  their active selectable grants; new invitees see only the current request.
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
- The model cannot choose the affirmative reaction meaning, substituted scope
  text, or URL.
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
- Corrected-head product-purpose revalidation: the irreducible purpose is one
  truthful, controllable group-sharing decision plus one grounded weekly story.
  The smallest complete journey is the single native offer/reaction or join
  customization checkpoint, an exact requested-scope snapshot, no redundant
  companion reply after a fresh offer, and same-period newsletter context drawn
  only from authorized facts. The rendered comprehensive-default checkpoint
  preserves review, opt-out, and the primary action without adding another
  screen. No product-experience finding remains.
- The separate Claude Code UI double-check was attempted with Fable after the
  final rendered surface stabilized; the CLI reported explicit usage-credit
  exhaustion, the workflow's documented non-blocking gap. No alternate Claude
  request was made.
- Final remediation focused proof: 89 Assistant Engine tests and 298 Web group
  store/tool, join-client, and provider-boundary tests passed. Assistant Engine,
  Hosted Execution, and Web typechecks passed.
- ReviewGPT round 2 required the recorded anomaly retrospective after finding
  that model prose could invert the reaction meaning and a narrower current
  request could hide an existing member's older active grant. The remediation
  deleted the model template surface, made Web own the canonical sentence, and
  derives existing-member controls from current request plus active grants.
- Exact-head Ubuntu app verification exposed a stale test mirror of the
  intentionally ratcheted runner total-byte budget. The mirror now matches the
  production constant, and its focused 42-test bundle suite passes.
- ReviewGPT round 3 found a provider-gap race that scope equality cannot fence
  across A→B→A and a channel adapter that erased explicit empty arrays. Both are
  reproduced by the production code paths. The recorded retrospective chooses
  one opaque generation in the existing policy JSON plus field-preserving
  adapter forwarding, without a new table, queue, lifecycle, or reconciler.
- ReviewGPT round 4 verified those consent corrections but found that the
  existing group-email weekly reducer silently drops authorized `workouts.v0`
  day records. The recorded retrospective keeps the correction in that reducer
  and the existing weekly-stat shape, with a full email-prepare regression and
  no raw-event payload or new owner.
- ReviewGPT round 5 found that a fresh native offer's unconditional final-action
  patch also erased unrelated output from a compound request. The recorded
  retrospective deletes that group-specific owner and reuses the existing
  explicit `finish_without_reply` choice only when the offer completes the
  whole request; mixed-intent turns retain their remaining answer.
- Round-5 remediation proof: 96/96 focused Assistant Engine group/newsletter
  tests passed, the two production-runtime finalization regressions passed, and
  Assistant Engine typecheck passed.
- Exact-head CI and corrected ReviewGPT rounds remain pending on the remediation
  candidate.
