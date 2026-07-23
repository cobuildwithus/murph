# Hosted Ask natural continuation

## Outcome

Remove the PR-specific Ask coordinator and repair the two scheduling gaps around the existing owners: start joined-group reads promptly in the detached group runtime, then resume the existing natural private-Murph continuation before a later personal reply. Preserve the separate reviewed-exact policy for consented group-to-member disclosures.

## Constraints

- Keep the hosted mailbox as transport only; do not add another queue, scheduler, or persisted lifecycle owner.
- Do not keep an Ask-specific exact-message outbox coordinator.
- A joined-group completion supplies untrusted result context to the private Murph; Murph composes the user-facing reply through the ordinary assistant delivery path.
- A consented member disclosure remains an exact reviewed response to the originating group; it is a separate product and authority boundary.
- Do not run the routine idle checkpoint early. A checkpoint may occur only when already required by normal durable mailbox/outbox commit semantics.
- Preserve unrelated work and the current PR lineage.

## Plan

1. Remove the prior Ask-specific coordinator and its documentation/tests.
2. Admit joined-group Ask requests through the existing pre-checkpoint safe system prefix so the detached read starts without advancing the routine idle snapshot.
3. Admit an older joined-group completion through the existing foreground-causal system-mailbox phase before a later personal input, using the existing natural continuation and outbox owners.
4. Add focused regression coverage for detached start timing, natural continuation ordering, replay idempotency, delayed-first-attempt observability, and the checkpoint floor.
5. Run required verification, coverage review, parent final review, commit, push, CI, and an exact-head ReviewGPT round when authorized.

## Verification

- Focused assistant-runtime Ask completion/system-mailbox/workspace-phase regressions passed.
- `pnpm test:diff ARCHITECTURE.md agent-docs/references/hosted-runtime-protocol.md packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts` passed on an isolated Testbox: 1,789 assistant-runtime tests and 1,852 Cloudflare reverse-dependent tests passed.
- `pnpm docs:drift` passed.
- Required `coverage-write` completion audit passed with one test-only checkpoint-floor strengthening and no production finding.
- Full `pnpm verify:acceptance` was not selected because the routed assistant-runtime matrix accepts a truthful `test:diff` owner and reverse-dependent lane.
- Exact pushed-head CI and ReviewGPT gate remain after the commit and push; a seventh ReviewGPT round requires explicit authorization.

## Deployment

Runtime-only behavior change. No schema migration, Web producer change, Temporal command-order change, or Cloudflare API change is intended.
Status: completed
Updated: 2026-07-22
Completed: 2026-07-22
