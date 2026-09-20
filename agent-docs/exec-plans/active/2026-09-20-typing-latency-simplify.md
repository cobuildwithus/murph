# Remove workspace startup from first typing feedback

## Outcome and evidence

Outcome: accepted Linq messages show typing while the existing durable wake and
runtime import proceed. Production timing separates a short provider typing
request from much longer startup, restore and mailbox-fetch waits. The existing
onboarding hint already supports early feedback and records actual acceptance.
Reuse that owner instead of building another startup optimization or alert rule.

Reaches: fresh authenticated non-self messages with a committed conversation
wake in the exact inbound chat, for direct and routed conversations. Reactions,
edits, ignored/duplicate events, already-answered inputs and rejected admission
retain their current behavior. Runtime remains the owner of sustained typing,
reply selection, allowance enforcement and delivery.

Proof: real webhook planner/service tests with synthetic providers; block wake
acknowledgement to prove typing starts independently; fail the hint and the wake
separately; preserve instant onboarding, quiet paths and acceptance telemetry.

## Architecture and failure

Remove the onboarding-only restriction on the existing best-effort hint. Keep
its single request, 2.5-second deadline, failure cleanup, provider API and
post-response acceptance recording. No new store, cache, queue, configuration,
timer or dependency. This is receipt feedback, not permission to run inference
or a claim that a final reply is ready. Failures still use existing durable
mailbox and Temporal recovery. No change to assistant prompts or tool contracts.

Web-only change using the existing ingress timestamp column and parser; old
runners remain compatible. No production deployment is authorized by this
local task. Actual post-deploy latency remains to be measured.

## Validation

- The two early-feedback regressions fail on the unchanged base because no
  typing request starts before the wake settles.
- Five focused suites pass, 340 tests: Linq dispatch, direct wake, latency
  storage, latency alerts and changelog rendering.
- Web typecheck passes with generated Prisma, Commons and changelog inputs.
- Complexity guard passes: existing maximum and complexity debt are unchanged.
  Eligibility remains in the existing hint owner; no new helper was introduced.
- Parent review: exact inbound target, committed admission, rejected/duplicate
  suppression, routed chats, onboarding reuse, failed hint isolation, failed
  wake cleanup and acceptance timestamp propagation checked. UX Ready for
  local review. No live delivery or deployment was performed.
- PR review and exact-head CI remain pending. Post-deploy proof must compare
  actual ingress-typing acceptance separately from runtime import and replies;
  this change does not claim faster final answer generation.
