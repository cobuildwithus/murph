Goal (incl. success criteria):
- Habitat phase 2 per `agent-docs/product-specs/habitat.md`: make the assistant aware of habitat and able to use it in conversations. Success means: a compact habitat coverage block appears in the assistant's per-turn context snapshot; system-prompt guidance defines contextual collection behavior (use known facts first, ask contextually within the current topic, never cold interviews, never re-ask declined, passive capture, photos only if member sends one unprompted); habitat CLI commands are discoverable in the assistant CLI contract; onboarding skill captures habitat facts passively with at most one optional light environment question; prompt/runtime tests pass.

Constraints/Assumptions:
- No scheduled nudges, no UI, no asking members for photos, no lengthening onboarding (phase 3+/4 per spec).
- Questions are contextual: grounded in the member's current topic (bad sleep → temperature/window/screens is fine); never random unprompted interviews.
- Keep the prompt addition small (token budget).
- Preserve unrelated working-tree edits and ledger rows.

Key decisions:
- Coverage block computed from existing vault read in the runtime snapshot path; pure derivation, no new state.
- Guidance is a static prompt section (stable layer), not per-turn logic.

State:
- Complete. Coverage line ships in the assistant context snapshot (new `habitat` dirty domain, schema version 3); habitat guidance section added to the stable system-prompt layer (contextual asks only, passive capture, declined respected, photos never requested); onboarding skill captures habitat facts passively with at most one optional environment question; habitat CLI commands flow into the assistant CLI contract automatically via the `--llms` manifest (verified).

Done:
- Phase 1 foundation landed (family, catalog, coverage, CLI) — commits 18f0239a4/15bebde48/c1ae1e890.

Now:
- Ready for scoped commit. Verified: assistant-engine suite 1822 pass + new habitat snapshot test; assistant-runtime suite 1236 pass; typechecks clean; habitat present in `vault-cli --llms` manifest output.

Next:
- Phase 3: environment UI page + handoff CTA.

Open questions (UNCONFIRMED if needed):
- None blocking.

Working set (files/ids/commands):
- packages/assistant-engine/src/assistant/system-prompt.ts (+tests)
- packages/assistant-runtime/src/hosted-runtime/* (context snapshot producer)
- packages/operator-config/src/assistant-cli-contracts.ts
- packages/assistant-engine/skills/murph-onboarding/SKILL.md
Status: completed
Updated: 2026-07-08
Completed: 2026-07-08
