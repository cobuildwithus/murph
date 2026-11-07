# Bound hosted runtime churn without delaying real input

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Goal

Explain why the existing no-progress backoff failed to contain repeated interrupted system work, then strengthen the existing owner and composed CI regression so a similar failure has bounded cost without delaying real conversation or losing durable work.

## Success criteria

- Establish the original amplification chain from bounded read-only evidence and current source, separating verified facts from hypotheses.
- Reproduce any remaining protection gap before changing production behavior.
- Demonstrate bounded processing under unchanged durable work across invocations and wake signals, with timely admission of actual foreground input and eventual background recovery.
- Pass relevant tests, typecheck, candidate review, and exact-head CI for a scoped PR.

## Scope

- In scope: runtime wake/checkpoint projections, existing Temporal progress gate and admission, cross-boundary regression coverage, durable contract and CI-map updates as needed.
- Out of scope: unrelated open PRs, new scheduler or queue, production data repair, rollback, and unrelated infrastructure tuning.

## Constraints

- Preserve canonical mailbox handling, semantic progress ownership, write fences, consent, foreground priority, and Temporal replay compatibility.
- Production evidence stays aggregate or redacted; fixtures are synthetic.
- Use isolated owned checkouts. No production Temporal mutation is authorized for this investigation.

## Risks and mitigations

1. Suppressing useful work while reducing calls. Test real conversation, genuine progress, future deadlines, and eventual recovery alongside no-progress cases.
2. Adding duplicate admission machinery. Trace the existing progress gate first; repair its owning boundary where possible.
3. Inferring history from current state. Label source-derived hypotheses and verify the original interval independently.

## Tasks

1. Reconstruct the interruption, checkpoint, completion callback, reconciliation, and processing cycle.
2. Identify why existing semantic-progress backoff did not contain the incident; inspect existing composed tests and CI selection.
3. Add a failing regression at the highest practical composed boundary; make the smallest maintainable correction.
4. Run focused tests and relevant typecheck, review final diff, update contract/test ownership, and submit the scoped candidate through required review and CI.

## Decisions

- PR #3226 already fixed empty wake hints interrupting independent completion. This follow-up investigates containment beyond that trigger.
- Existing Temporal backoff already uses semantic progress and handled frontier; another general throttle is not justified without identifying its escape path.
- Historical read-only Temporal facts confirmed unchanged semantic generation and handled frontier, changing checkpoint versions, and a default wake whose reason was device reconciliation. The progress and scheduling patches were active. Temporal requested default passes; runtime logs recorded system passes. Cloudflare's existing usage guard narrows those default requests to system execution.
- The producer classified sequence-less local device timers as default-owned even though the independent owner executes them as model-free work. The earlier independent-work change exposed this timer classification. Empty wake hints then interrupted recording; the bad default projection let each unchanged retry bypass system backoff. PR #3226 fixed interruption; this follow-up fixes the producer and contains older bad projections in the private Temporal owner.
- CI tested the components but preserved the wrong assumption: a runtime fixture explicitly required sequence-less model-free work to use the default owner. Temporal progress tests supplied null default wakes. The separate recurring-reminder fairness scenario exercises positive progress, not this bad projection/retry combination.
- Runtime classification now reuses the execution predicate without a sequence-number gate. Temporal uses one replay-versioned check that denies device reasons default-wake bypass authority; no protocol, schema, queue, dependency, or new retry state is added.

## Product UX

- Outcome: delayed scheduled device work can finish through its background owner; repeated unchanged work remains bounded.
- Reaches: scheduled and imported device work, legacy restored local system work, and conversations or deliveries arriving during retries.
- Proof: real runtime timer completion, persisted-state ownership, native Temporal restart/recovery, unchanged-progress churn, and positive foreground/progress admission tests. Status: focused journeys Ready; review and CI pending.

## Verification

- Producer regressions failed on the prior code: both pending and recording local timers advertised default device wakes; legacy model-free maintenance used the same wrong owner.
- Scheduler regression failed on the prior code with twenty immediate admissions and no clock advance. With the fix it admits eight passes across 52.5 simulated minutes, retains the unchanged semantic fingerprint across Continue-As-New, and caps retries at ten minutes.
- Public focused proof: 36 mailbox-state cases, 104 runtime system/preemption/concurrency cases, and both imported-device and locally materialized timer completion variants passed. Runtime and Web typechecks, ten changelog rendering cases, docs drift, and the complexity diff guard passed.
- Private focused proof: 399 workflow-machine cases, three replay cases (including the new old-default-loop fixture), entrypoint tests and three native quiescence E2E cases passed. Removing the replay guard intentionally makes the new fixture fail at the old second admission; the production guard was restored afterward.
- Candidate review: source/test/doc readback and privacy review passed; the production change removes the duplicate ownership prerequisite and adds no new state or dependency.
- Candidates: public PR #3260 corrects the producer; private PR #132 contains older projections. Private required `pnpm verify`, required ReviewGPT and exact-head CI remain pending; no production mutation was performed.
Completed: 2026-09-11
