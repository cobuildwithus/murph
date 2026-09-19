# Starter image egress review correction

Status: completed
Created: 2026-09-11

## Outcome

Finish PR 3225 with the personal Starter card requirement enforced before image spending, including native image tools carried through OpenAI Responses. Preserve ordinary text, paid image access, and existing native-memory accounting. Complete the required review and checks without production deployment.

## Evidence and scope

- A synthetic request with a valid runtime provider credential and a Responses image-generation tool reached the upstream mock even when the card-access owner would deny it. The new regression expected 403 and received 200.
- The Images API path already checks current card access. Responses HTTP bodies and WebSocket client frames need the same decision before an image request is forwarded.
- Reuse the existing Web access owner and WebSocket transport implementation; do not add cached card authority or gate ordinary text on Stripe.
- Preserve the original review snapshot and completed plan. This correction requires another substantive review after the first valid review completes.

## Work

1. Add bounded image-tool detection to Responses HTTP and WebSocket forwarding, including authenticated native-memory traffic.
2. Prove denied image requests never reach upstream, allowed images still work, text never awaits the card callback, and memory accounting remains intact.
3. Update the durable contract, run relevant tests/typechecks and complexity review, commit, and finish PR review plus exact-head CI.

## Product disposition

Ready for the corrected implementation candidate. SMS rollout remains disabled
pending deployment sequencing. Final external review and exact-head CI remain
PR completion gates owned by the original session.

## Implementation and verification

- Responses HTTP bodies and WebSocket client frames now use the existing signed Web image-access decision. Text requests perform bounded local inspection without a card callback. Missing card access or an unavailable owner blocks the image before upstream forwarding.
- Generalized the existing WebSocket relay instead of introducing another transport owner. Native-memory accounting remains conditional on authenticated memory traffic; binary JSON request metadata also preserves that accounting. Ordinary text streams can coexist, and every image frame rechecks current card access.
- Pending client frames share the existing 32 MiB message budget while asynchronous authorization is outstanding. Overflow closes both relay legs and cannot forward the pending image after shutdown.
- The gateway, relay, pinned-Codex conformance, and hosted-local composed suites passed 314 tests. The final relay suite passed all 14 tests after adding binary-frame accounting proof. The Worker runtime suites passed 19 tests; the final six-test WebSocket Worker suite passed after configuring the synthetic provider to receive binary frames as ArrayBuffers. Cloudflare typecheck, docs drift, and whitespace checks passed.
- Complexity guard passed across 24 changed source files; the OpenAI interceptor is 31 versus the base's 34. The shared relay introduces no above-threshold function debt. Parent reviewed authorization ownership, bounded pending work, failed-card behavior, ordinary stream preservation, privacy, and the complete correction diff.
- The existing real-Codex card-recovery reply proof remains applicable because this correction changes no assistant prompt, tool schema, or reply renderer. The composed pinned-Codex gateway proof was rerun for the changed transport boundary.
- Round 1 completed against the original immutable snapshot after same-thread recovery. Its captured answer had a completion marker, matching GPT-6 Pro response-model evidence, and more than thirteen minutes of generation time. It found no qualifying issues. The alternate image-path gap was independently reproduced by the parent and this production correction requires the next review.

This plan records the completed implementation correction and local proof. PR
review and CI results will be recorded on the PR after the corrected candidate
is pushed; neither production deployment nor merge is included.
Updated: 2026-09-10
Completed: 2026-09-10
