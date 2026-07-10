# Group-chat onboarding guard

Status: completed
Updated: 2026-07-10

## Why

A production iMessage group-chat turn entered Murph's personal onboarding flow
and asked one participant for profile and health-goal details. Group containers
must stay in group mode; personal onboarding belongs only to the member's
private conversation.

## Evidence and decision gate

- Production metadata shows two distinct inbound turns. Each produced one
  assistant cycle and its intentionally split outbound bubbles; no duplicate
  webhook, model retry, or transport retry explains the behavior.
- Both turns reached the personal active-member planner path instead of the
  thread-container route. Existing safe diagnostics did not record the webhook
  group flag, provider version, or imported directness, so they cannot
  distinguish a missing flag from an incorrectly direct flag.
- The current Linq webhook schema carries group truth on the chat object, while
  the canonical chat-read endpoint also returns that truth. Resolve inbound
  iMessage classification from the canonical chat record before planning when
  the webhook does not already attest a group, with a bounded lookup.
- Classification must be stable across at-least-once webhook retries. If the
  canonical read fails or omits group truth, return a retryable server failure
  before any receipt, route, or mailbox write; falling back to the signed
  webhook could route one delivery personally and a later retry to the group
  container because those owners have different dedupe scopes.
- Independently prevent personal onboarding guidance whenever existing
  conversation policy says the effective thread is a group. Preserve direct
  and unknown-directness onboarding behavior.
- Do not add persisted state, a second heuristic classifier, or speculative
  compatibility parsing for a payload shape that could not have reached the
  observed planner path.

## Scope

Owners are Linq chat classification at hosted web ingress and onboarding
guidance admission in assistant route planning. Focused changes live in the
existing Linq client/webhook service and assistant planning primitive, with
their direct tests. Preserve direct-message onboarding, current-inbound
replies, group tools, and existing delivery behavior.

## Verification

- Focused hosted-web regressions: 171/171 passed, covering stale and omitted
  webhook directness, canonical group/direct classification, unavailable
  classification fail-closed behavior, caller cancellation, retryable HTTP
  status, and the existing Linq ingress surface.
- Focused assistant planning regressions: 32/32 passed, covering group
  suppression plus explicit-direct and unknown-directness onboarding controls.
- Diff-aware guards and all six affected package typechecks passed. Its
  assistant-engine surface passed 2,009 tests; eight load-sensitive timing
  tests in two unchanged assistant-runtime files failed under the saturated
  broad run, then both files passed 195/195 in an isolated serial rerun.
- Hosted-web lint completed with zero errors; changed-file lint and
  `git diff --check` passed.
- Security/privacy re-audit found no medium-or-higher issue after the
  fail-closed retry correction. Coverage-write added omitted-directness and
  explicit-direct controls, with no remaining scoped coverage finding.
- Parent diff review and PR review loop on the final head.

## Deployment

No persisted-data migration is required. Deploy the Cloudflare assistant
runtime guard before the hosted web ingress correction, then verify one group
turn routes to a thread container without onboarding guidance. The reverse
order leaves a temporary window where correctly routed fresh group containers
can still receive the old onboarding instructions.
Completed: 2026-07-10
