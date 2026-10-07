# Research batch first-rejection telemetry

## Proven scope and owners

Natural `research scout-batch` failures share `research_scout_invalid_batch_payload / unknown`.
Synthetic owner tests show many distinct invalid bodies yield that same pair, so no behavior
cause is proved and a prompt/guidance change is unjustified. This adds one optional finite
`rejection` category for the schema's **first** issue so a later natural singleton can select
a concrete synthetic reproduction. Telemetry only.

- Classification: `packages/cli/src/commands/research.ts` (`researchScoutBatchRejection`), from
  the existing `safeParse` first issue's code and schema-owned path shape; attached as a
  non-enumerable own data property on the unchanged `VaultCliError`.
- Vocabulary, observer, normalizer, merge identity: `packages/runtime-state/src/cli-timing.ts`
  and `src/node/cli-timing.ts`; existing hosted/engine readers inherit it.
- Contract, rollout, query and decision threshold: `docs/hosted-runtime-log-database.md`.

Unchanged: schema/acceptance, validation order, prompt and tool text, error code/message/hint,
RPC and output bytes, exits, provider calls, writes, retries, scheduled silence. No new event,
stream, sink, await or state owner. No paths, indices, keys, labels, values or messages retained.
Live assistant journey: not applicable; member-visible bytes are proved unchanged by tests.

## Compatibility

Reader before writer. Pre-change base for history-backed old-reader tests:
`MURPH_CLI_RESEARCH_REJECTION_COMPAT_BASE=ec9ede5a5e756d356d24e492d9457e25310b6284`
(runtime-state `cli-timing.test.ts`, assistant-engine `cli-timing-profile.test.ts`).
Old readers drop only the category; counts, phases, outcomes and tokens are preserved.

## Verification (2026-10-07)

Parent candidate review (parent-reported, not rerun by the implementer): focused production
parser and real-CLI loopback tests PASS; both history-backed old-reader tests (runtime-state
portable reader and assistant-engine hosted reader, base above) PASS; runtime-state, CLI and
assistant-engine typechecks PASS; docs drift, complexity and whitespace PASS.

Review revision: the proxy guarantee is stated precisely (own-descriptor read, no getter,
coercion or prototype traversal; a proxy's descriptor trap may run but only a fixed literal
can leave; throwing traps omit detail), with a source-proxy test. The usage body-fit owner
test now carries a full set of rejection variants through fitting unchanged; UDP sender
normalize/trim is exercised by the real-CLI loopback test.

## Status

Implementation complete. The parent owns final review, commit, CI and closeout via
`scripts/finish-task`.
Status: completed
Updated: 2026-10-07
Completed: 2026-10-07
