# Preserve typing preparation through import handoff

Status: active
Created: 2026-10-11
Updated: 2026-10-11

## Goal

Keep an admitted iMessage typing preparation alive when its mailbox import pass
yields before the foreground reply turn takes ownership.

## Success criteria

- A completed import can abort its temporary pass without stopping typing.
- The foreground turn reuses the accepted provider handle without another start.
- Turn cancellation, import failure, and invocation termination still clean up.
- Focused lifecycle coverage, type checking, complexity and repository checks pass.
- The exact PR head receives the required external review and CI before merge.

## Scope

- In scope: import-context cancellation lifetime, synthetic lifecycle proof,
  reliability contract, and a public member-outcome changelog fragment.
- Out of scope: provider retry policy, alert thresholds, model input, production
  traffic replay, runtime scheduling redesign, and unrelated rollout changes.

## Constraints

- Reuse the existing invocation controller and per-chat preparation owner.
- Keep provider authority and explicit failed-import cleanup unchanged.
- Production observations remain private; committed evidence is synthetic.
- Coordinate the shared runtime rollout with the parent task.

## Risks and mitigations

1. Longer preparation lifetime could retain typing after failure or shutdown.
   Mitigation: retain explicit unadmitted cleanup and test invocation/turn stop.
2. Fixing one reproducible defect could overstate resolution of measured latency.
   Mitigation: distinguish lifecycle correctness from startup and network timing;
   this change makes no latency-bound guarantee.

## Tasks

1. Trace existing import, cancellation, typing handoff, and final-delivery owners.
2. Reproduce completed-import cancellation stopping an unclaimed preparation.
3. Pass invocation lifetime specifically to typing preparation, retaining the
   temporary signal for import cancellation.
4. Run focused proof, inspect the full diff, and complete review and CI gates.

## Decisions

- Add an optional typing signal to the existing import context. Standalone
  callers retain their existing import-signal fallback.
- Resolve the fallback in the existing typing-start helper, keeping the large
  staging owner's complexity unchanged and introducing no new abstraction.
- No live-model journey: prompts, tools, reply selection, and content are
  unchanged. The claim is a deterministic resource-lifetime invariant.

## Verification

- New regression failed on the original implementation: aborting a completed
  import stopped the provider handle before foreground handoff.
- Focused importer, attachment-typing, and runtime-handoff tests cover success,
  failures, cancellation, provider authority, reuse, and final cleanup.
- Run assistant-runtime typecheck, complexity diff, docs checks, changelog
  generation and focused archive rendering proof before the candidate is Ready.
- Record exact-head external review and CI evidence in the PR.
