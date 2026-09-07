# Reduce warm-turn control-route startup work

Status: completed
Created: 2026-09-07
Updated: 2026-09-07

## Outcome and boundaries

Outcome: reduce avoidable startup work in the internal reads used before a warm reply.
Reaches: established conversations, saved provider changes, and active, suspended, missing, or revoked-consent members.
Proof: existing route and parser behavior, cold import boundary measurements, focused typechecks, exact-head CI and ReviewGPT. Production latency requires post-deploy observation.

## Evidence and current owner

Metadata-only traces show seconds in signed Web health-data admission and assistant-configuration reads while the runner is already resident. Local prompt planning is short. First-use pool logs and delay before callback authentication suggest Web startup contributes; they do not isolate all network and database time.
Web owns live consent, suspension and saved configuration. Runtime's early provider check supports payloadless Settings handoff, and its provider-entry check catches changes during preparation. Both remain required. No private trace rows or identifiers are retained here.

## Simplification plan

1. Delete output re-parsing in the health-data route; statically check its locally derived response against the existing type. This removes its dependency on the global runtime parser graph.
2. Move the existing assistant-configuration parser family to the existing assistant-model entrypoint and preserve former exports. Reuse the primitive assertion owner. Web can validate the same request without importing unrelated runtime and device-sync code.
3. Load mailbox mutation authority only in the configuration update branch, before the transaction. Normal reads retain the full existing response contract.
4. Prove cold import dependency removal and unchanged public parsing, auth, consent, update authority, and live provider semantics. Do not add caches, state, services, dependencies, configuration, or wire changes.

## Risks and proof

- Preserve every request rejection and compatibility default through existing parser tests and export parity.
- Retain signed callback authentication and nonce replay protection; test denied consent, missing and suspended members.
- Preserve update validation and exact mailbox authority before mutation.
- Keep lazy module evaluation outside transactions. An update import failure must fail the update without mutation.
- Rollout is behavior and wire compatible; independently deployed consumers keep the old parser exports.
- Do not claim that local import measurements quantify production latency or eliminate provider delivery delay.

## Progress

- Design review approved the bounded plan: https://chatgpt.com/c/6a9e4347-bfdc-83ea-86a4-8da0593362ed. Captured model metadata confirms gpt-6-pro; the response self-label was UNKNOWN, so this is design guidance rather than a final gate receipt.
- Fresh isolated worktree and dependencies prepared; Prisma client generated.
- Initial local test invocations exposed command selection and generated-client prerequisites; corrected to the existing app config and generation command, without repository workarounds.

## Candidate evidence

- Both new route dependency regressions failed on baseline because importing either read initialized device-sync execution; both pass after the reduction.
- All 19 focused Web route/handler tests pass. Existing checks cover missing, suspended, revoked and legacy consent, strict configuration inputs, and mutation authority/order.
- The full configuration parser family and allowed-key helper are byte-identical relocations, verified against the base source. Product choice, compatibility defaults, errors and both live runtime reads are unchanged.
- Same fresh-process esbuild source-resolution fixture (workspace aliases, external third-party packages, static edges only) reports eager internal modules: consent 166 to 19; configuration 225 to 35. Internal source bytes: 2,463,351 to 167,508 and 3,184,289 to 456,635. Both routes now reach zero device-sync modules, and configuration no longer eagerly reaches the mailbox store. These are dependency-closure metrics, not Vercel bundle timings or production latency savings.
- No prompt, tool availability/schema, model input, or delivery-policy changes; real-Codex reply-quality proof and public changelog are not applicable to this internal dependency correction.

## Local completion

- 94 unique focused tests passed: 19 Web route/handler/import-boundary cases, 38 model-preference cases, and 37 hosted runtime-control/parser cases. The health fixtures also pass unchanged through the retained consumer parser; legacy configuration exports are the same function objects as the narrow entrypoint.
- Hosted-execution and Web typechecks passed after the final test additions.
- Complexity guard passes with unchanged debt. The pre-existing group request/response/projection parser hotspots are unaffected and outside this bounded change.
- Docs drift, whitespace, privacy scan, and manual review passed. Product UX: Ready at the deterministic behavior boundary; production latency comparison remains a post-deploy observation.
- Final external review and exact-head CI are tracked on the task PR. No deployment mutation was used for diagnosis.
Completed: 2026-09-07
