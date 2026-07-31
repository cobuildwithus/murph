# Hosted provider wake signal

Status: completed
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Make a committed provider change wake an active private runtime through
  Temporal even when Web reconciliation reports no mailbox or scheduled work.
  Preserve the quiet Settings save state and the existing provider-entry
  correctness gate.

## Success criteria

- A pointer-only provider-change wake is durably coalesced by the existing
  per-user Temporal workflow.
- The workflow asks the existing Cloudflare execution adapter to process that
  wake once even when reconciliation facts are idle.
- A live stale invocation checkpoints and releases before the next reply; an
  inactive runtime can no-op through an ordinary no-work invocation.
- The next reply runs through a fresh invocation configured for the saved
  provider, with the selected provider credential present in its direct Codex
  child and no stale-provider request during handoff.
- Existing runtime recheck signals retain their facts-read-only semantics.
- Focused contract, workflow, route, runtime, and hosted-local proof passes.

## Scope

- In scope:
  - Add one payload-free runtime wake signal to the existing orchestration
    contract and coalesce it as one Temporal-owned boolean.
  - Route effective Settings provider changes through that signal after commit.
  - Preserve the existing runtime mismatch/checkpoint/release behavior.
  - Correct the warm-reuse E2E to save while the second invocation is still
    active, then prove the third reply uses the fresh provider. The local
    recorder observes Murph's canonical product model; existing Worker tests
    own proof of provider-specific Venice translation at production egress.
- Out of scope:
  - New queues, mailbox items, provider preference replicas, direct Cloudflare
    wake APIs, provider fallback, or provider-specific workflow state.
  - Changing model-only or reasoning-only save behavior.

## Constraints

- Technical constraints:
  - Postgres remains provider-preference authority; Temporal stores only a
    payload-free coalesced wake bit.
  - Workflow changes must remain deterministic for histories that predate the
    new signal.
  - Provider entry remains fail-closed when live Web authority is unavailable.
- Product/process constraints:
  - Do not restore visible success subtext or reserved space.
  - Deploy Cloudflare runtime support and the Temporal worker before Web emits
    the new signal.

## Risks and mitigations

1. Risk: changing the existing recheck signal could wake idle runtimes for
   unrelated billing, status, and retention facts.
   Mitigation: add a separate payload-free wake kind and leave recheck semantics
   unchanged.
2. Risk: a signal received during an accepted execution could be lost.
   Mitigation: clear the coalesced bit only when no newer wake signal arrived
   during that execution.
3. Risk: a blocked member could retain a useless wake indefinitely.
   Mitigation: discard the wake when current Web facts are blocked; later access
   changes or foreground input retain their existing recovery paths.
4. Risk: the runtime prepares Venice correctly but the direct Codex child drops
   its credential or warm-resumes an OpenAI process.
   Mitigation: project only the selected provider credential, include provider
   selection in process launch identity, and keep local test provider ids
   distinct so the exact E2E exercises the production resume boundary.

## Tasks

1. Add the pointer-only signal/state contract and workflow regressions.
2. Route effective provider saves through the new signal and update focused Web
   tests.
3. Correct and run the hosted-local warm-reuse/provider-switch journey.
4. Update durable ownership/deployment docs and run scoped verification.
5. Push the corrected exact head, rerun CI and final ReviewGPT, and reconcile
   the PR intent contract.

## Decisions

- Rejected the original `runtime_recheck_requested` design after the
  production-faithful scenario proved that it only re-read idle facts and never
  reached Cloudflare.
- Prefer one coalesced Temporal wake bit over a mailbox item or direct-wake
  subsystem because Temporal already owns durable wake orchestration.
- Production evidence and a focused child-env test proved the provider runtime
  prepared Venice while the direct Codex projection still allowed only the
  hard-coded OpenAI key. The fix derives the one forwarded credential from the
  registered selected provider instead of adding another provider-specific
  branch.
- The local recorder originally collapsed OpenAI and Venice onto one reserved
  provider id, so a restarted process could resume the old provider context and
  hide production's distinct-id handoff. The harness now uses distinct reserved
  ids while retaining one shared local recorder origin.

## Verification

- Local outcomes:
  - Focused assistant-engine tests: 71 passed.
  - Focused assistant-runtime tests: 310 passed, 2 skipped.
  - Hosted-execution contract tests: 7 passed.
  - Hosted Temporal workflow tests: 24 passed.
  - Focused Web route, signal, status, component, and preference tests:
    87 passed.
  - Hosted-local harness tests: 164 passed.
  - Cloudflare full-stack scenario helper tests: 8 passed.
  - Typechecks passed for Web, Cloudflare, assistant-engine,
    assistant-runtime, hosted-execution, hosted-local-harness, Temporal, and
    operator-config.
  - Web lint passed with zero errors; only unrelated existing warnings remain.
  - Scenario-integrity and frontend design-proof guards passed.
  - The full-stack scenario observes the immediate release edge while the second
    invocation is active, no extra OpenAI request during handoff, and a
    Venice-configured third reply.
  - `pnpm hosted-local e2e warm-reuse-egress --profile e2e:stub` passed on
    2026-07-30, including warm reuse before the switch, a launch-identity
    replacement at the handoff, and exactly one provider request for the third
    reply.
- Remaining remote gates:
  - Exact-head CI and final ReviewGPT.
Completed: 2026-07-30
