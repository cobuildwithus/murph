# Let Web Luna finish the opening exchange

Status: active
Created: 2026-09-24
Updated: 2026-09-24

## Outcome and architecture

Web Luna acknowledges a plain identity answer and asks the first aspiration
question without waiting for the full runtime. Reuse encrypted conversation
import and existing reply suppression. The next full assistant turn uses its
existing native leaf to save exact identity facts from the retained transcript.
Canonical memory is deferred if the member stops; conversation evidence remains
durable. No Web memory writer, extracted-identity protocol, queue, or extra model
turn is needed. Existing memory writers remain the sole canonical owner.

## Product UX

Effort: Product change. Plain complete/partial identity or skipping only identity
gets one warm aspiration question. Concrete requests, supplied aspirations,
ambiguity, safety concerns, and stopping onboarding hand off to the runtime.
The next real turn saves identity without repeating the Web question or claiming
unverified writes. Later corrections outrank earlier supplied details.

## Protected boundaries

- At most three opening replies from existing delivery rows under the chat lock.
- Third reply requires the immediately preceding confirmed bundled question.
- Preserve access, private routing, current account lifetime, replay, and delivery.
- No new network operation; existing bounded generation and fallback remain.
- Deploy runtime guidance before Web expansion. Old Web with new runtime works;
  new Web requires the catch-up guidance before sending a third reply.

## Tasks and proof

1. Extend current opening admission and prompt; use one transient opening context.
2. Extend the existing model-owned identity save rule to imported opening history.
3. Prove third-reply admission, cap, replay, handoffs, and composed canonical saves.
4. Run focused Web tests and typecheck, engine prompt/native journeys and typecheck.
5. Compare actual Luna/Sol third-reply quality using production prompt and synthetic
   full, partial, skip, mixed-intent, and safety examples. Review replies directly.
6. Update owner docs/changelog; review, CI, staged deployment, and production canary.

## Current evidence

Web implementation is isolated here. PR #3686 owns the prerequisite runtime
catch-up instruction together with the GPT-6 defaults; deploy and verify that
consumer before merging this Web producer. A production-config baseline probe
missed the child; the candidate Luna/Sol proofs verify canonical readback.
The initial history-aware prompt could repeat an earlier goal. Delete that extra
read: second-turn acceptance now hands substantive goals to the full runtime.
A short bounded acknowledgement structure replaces unconstrained prose that
could unnecessarily reintroduce Murph. Final GPT-6 Luna and Sol comparisons passed all eight opening scenarios; replies reviewed Ready.
Web claim/delivery/dispatch coverage passed 260 tests, including third-reply replay
and cap checks. Web typecheck, focused lint, complexity guard, and docs drift
passed. Final review, exact-head CI, prerequisite rollout, and production canary
remain pending. No user-visible latency claim is made from local Codex timing.
