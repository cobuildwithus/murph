# PR 522 ReviewGPT Follow-up

## Goal

Resolve every evidence-backed finding from the final-head review of the group-chat
onboarding guard while preserving direct-message onboarding and bounded webhook
ingress.

## Constraints

- Keep group/directness as tri-state data until a decision explicitly requires a
  boolean attestation.
- Preserve existing direct SMS/RCS onboarding when provider directness is unknown.
- Bound canonical Linq chat classification across both headers and response-body
  consumption, with caller cancellation preserved.
- Use only the documented canonical Linq chat-read response shape.
- Do not modify the archived original execution plan.
- Keep the deployment handoff coordinated: the guarded runner bundle must fully
  replace old warm runners before corrected web ingress is deployed.

## Working Set

- `apps/web/src/lib/hosted-onboarding/linq-client.ts`
- `apps/web/src/lib/linq/api.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-service.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`
- focused hosted onboarding tests
- `packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts`
- focused assistant runtime and planning tests
- PR deployment description

## Verification Plan

- Focused regression tests for SMS/RCS unknown directness and iMessage group/direct
  classification.
- Real HTTP-server tests proving the classification deadline and caller abort cover
  a stalled response body.
- Full web typecheck, full web tests, lint, and diff/privacy checks.
- Completion re-audits for the accepted findings.
- Push the final head, wait for green CI, and rerun ReviewGPT until zero accepted
  findings on a valid exact-head round.

## Review Resolution

- Accepted: omitted SMS/RCS directness was being collapsed to confirmed group.
  Semantic directness is now tri-state through webhook planning and mailbox import;
  direct-chat attestation remains boolean only where route binding requires it.
- Accepted: the chat-read deadline ended after response headers. One shared Linq
  request primitive now owns fetch, response-body consumption, timeout, and caller
  cancellation as a single operation.
- Deployment concern already covered in the PR contract: runner first with immediate
  rollout or verified old-runner drain. The final PR description must name the
  deployed bundle-fingerprint smoke and rollback floor explicitly.
- Accepted: the chat-read parser admitted an undocumented nested webhook shape. It
  now accepts only the pinned SDK's canonical top-level Chat response.

## Verification Results

- Focused hosted web regressions: 137 passed.
- Explicit thread-route regressions: 30 passed.
- Focused assistant-runtime mailbox regressions: 58 passed.
- Full serialized diff lane passed, including 1,495 assistant-runtime tests, 4,048
  hosted web tests, 1,679 Cloudflare tests, production web build/typecheck/lint,
  dependency/boundary guards, and runtime smoke checks.
- Reliability, product-flow/privacy, and simplicity/provider-boundary re-audits:
  no evidence-backed medium-or-higher findings.
Status: completed
Updated: 2026-07-10
Completed: 2026-07-10
