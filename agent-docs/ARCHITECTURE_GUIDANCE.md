# Architecture Guidance

## Purpose

Use this guide before planning a non-trivial repository change. It turns the
repository's architecture and product rules into a short decision sequence. It
does not replace the canonical owners linked below.

## Decision Sequence

### 1. State the outcome and protected invariant

- Describe the user-visible or operational outcome, not the proposed mechanism.
- Name the product or system invariant that must remain true.
- If the outcome or invariant is unclear, investigate before designing.

Product behavior is owned by `agent-docs/PRODUCT_SENSE.md` and
`agent-docs/PRODUCT_CONSTITUTION.md`. System invariants are owned by
`docs/contracts/00-invariants.md`.

### 2. Find the current owner and trace the data

- Name the existing owner for each accepted input, state transition, durable
  fact, query, and external effect in the affected flow.
- Trace the path from admission through persistence, reads, side effects,
  failure, and recovery. Keep authority and privacy boundaries explicit.
- Put user-facing or queryable truth through the persisted-state placement gate;
  do not start it in assistant runtime state.

Current topology and source-of-truth rules live in `ARCHITECTURE.md`. Persisted
state placement is owned by
`agent-docs/operations/agent-workflow-routing.md`.

### 3. Prove the actual gap

- Treat a suspected cause as a question until code-path, data, runtime,
  reproduction, or test evidence proves it.
- Separate the observed defect from adjacent cleanup opportunities.
- When evidence is missing, make the next plan step a bounded investigation or
  diagnostic probe instead of a speculative fix.

### 4. Choose the smallest durable correction

Consider these options in order:

1. Delete obsolete behavior or state.
2. Reorder an existing transition so the invariant holds.
3. Derive dependent state from its current canonical owner.
4. Extend the current owner at its public boundary.
5. Add a new abstraction, dependency, queue, service, or state owner only when
   a current product, security, test, or measured performance need proves the
   simpler choices insufficient.

Do not solve review findings by adding machinery that creates another source of
truth. Do not preserve obsolete code through a compatibility layer unless a
current legacy consumer requires it.

### 5. Design failure and evolution with the happy path

- Preserve product-critical flows while fixing safety or reliability defects.
- Bound retries, concurrency, retention, and replay; make idempotency and
  recovery ownership explicit.
- State authorization and privacy behavior at every external boundary.
- If independently deployed components or persisted schemas can disagree, name
  the compatibility window, rollback floor, and convergence proof.

Use `agent-docs/SECURITY.md`, `agent-docs/RELIABILITY.md`, and the deployment
compatibility rules in `docs/contracts/00-invariants.md` for the detailed
contracts.

### 6. Plan the proof

- Name the focused proof that would fail before the change and pass after it.
- Select the smallest truthful tests, typecheck, runtime, browser, or deployment
  checks for every touched owner.
- Keep confidence honest: distinguish proven behavior, inference, and remaining
  operational gaps.

Verification selection and completion gates are owned by
`agent-docs/operations/verification-and-runtime.md` and
`agent-docs/operations/completion-workflow.md`.

## Architecture-First Plan Contract

A non-trivial implementation plan should answer these questions before listing
file edits:

1. What outcome and invariant define success?
2. Which current owner and public boundary should change?
3. What evidence proves the gap or root cause?
4. What can be deleted, reordered, or derived instead of added?
5. Where will authoritative state live, and how will dependent state converge?
6. What happens on failure, retry, rollback, and deploy skew?
7. What focused proof closes the task?

If the plan cannot answer the owner, evidence, or state questions, its next step
is investigation—not implementation.
