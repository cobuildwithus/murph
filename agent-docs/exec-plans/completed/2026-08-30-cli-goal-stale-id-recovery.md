# Preserve goal identity through stale-ID recovery

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Preserve the member's exact intended goal identity after typed
  `goal save --id` reports a stale ID: inspection may reveal other goals, but
  Murph must not write one of them without explicit confirmation of that exact
  alternative target.

## Success criteria

- The typed CLI hint explicitly permits inspection and prohibits retrying with
  another ID unless the member confirms that exact target.
- Without that confirmation, Murph asks whether to update another existing
  goal or create a new one and performs no second goal write.
- The public changelog claim is limited to typed `goal save --id`; it does not
  imply that `goal import-json` or ordinary core upserts gained the guard.
- A deterministic CLI assertion and one focused production-derived real-Codex
  journey prove the changed recovery boundary and truthful reply.
- Focused CLI and Web checks plus affected typechecks pass on the final diff.

## Scope

- In scope:
  - the typed stale-ID CLI recovery hint;
  - its CLI regression assertion;
  - one synthetic same-slug/different-ID real-Codex journey;
  - narrow, truthful changelog copy and PR evidence.
- Out of scope:
  - changing `goal import-json` or ordinary `upsertGoal` semantics;
  - adding another goal mutation owner or broad assistant prompt machinery;
  - rerunning the completed preliminary specialist pass or starting ReviewGPT.

## Constraints

- Technical constraints:
  - retain the canonical locked first-write rejection already on the branch;
  - build the live journey from production CLI policy and real command output;
  - assert no write to the same-slug goal with a different ID.
- Product/process constraints:
  - Product UX Patch.
  - Outcome: stale goal recovery preserves the member's intended target.
  - Reaches: agents using typed `goal save --id` after the saved ID disappears.
  - Proof: complete hint assertion plus a focused live same-slug/different-ID
    journey whose actual reply is reviewed as Ready.

## Risks and mitigations

1. Risk: inspection of the goal list is misread as permission to retarget the
   write.
   Mitigation: make the prohibition and confirmation boundary explicit in the
   production hint and assert both prohibited effects and recovery prose live.
2. Risk: public copy implies broader protection than the typed command owns.
   Mitigation: name typed goal ID updates and preserve the import-json
   exclusion in the changelog details.
3. Risk: a model-level test passes while using a simplified non-production
   instruction.
   Mitigation: extend the established live fixture with the production CLI
   access guidance and actual command/error envelope shape.

## Tasks

1. Inspect the production CLI hint, assistant CLI policy, and live-journey
   fixture; make the smallest identity-preserving copy correction.
2. Strengthen deterministic CLI proof and add one focused stale-ID real-Codex
   journey with same-slug/different-ID list output.
3. Narrow the changelog claim, run the deterministic and live proof, review
   the actual reply, and complete exact-head PR evidence.

## Decisions

- Keep the alternate-ID confirmation rule in the error hint already consumed
  by the assistant instead of adding a second prompt or state machine.
- Keep inspection available because it helps the agent explain current state;
  inspection alone does not authorize a different target.
- Correct the existing changelog fragment instead of widening import-json.

## Verification

- Commands to run:
  - `pnpm exec vitest run --config packages/cli/vitest.config.ts --no-coverage packages/cli/test/health-goal-save.test.ts`;
  - `pnpm test:assistant:live -- --test "stale typed goal id preserves the intended target"`;
  - `pnpm --dir packages/cli typecheck`;
  - `pnpm --dir packages/assistant-engine typecheck`;
  - `pnpm --dir apps/web test -- changelog-page.test.tsx`;
  - `pnpm --dir apps/web typecheck`.
- Expected outcomes:
  - CLI missing-ID proof asserts the complete bounded recovery hint;
  - the live journey lists a same-slug/different-ID goal, performs no second
    `goal save`, and asks for confirmation or creation choice truthfully;
  - changelog rendering and all affected TypeScript graphs pass.

## Outcome

- Product UX walkthrough verdict: Ready. The exact stale-ID update fails
  closed, the agent lists the current goals, makes no second write, and asks
  one clear question offering the exact listed-goal update or a new goal.
- The focused real-Codex journey passed with `gpt-5.6-terra` through a local
  subscription after the bounded authenticated-home fallback. Its command
  trace contained one stale-ID `goal save` and one `goal list`, with no
  `goal import-json`, alternate-ID save, goal mutation, or write metadata.
- The focused CLI test passed with four assertions, the changelog page test
  passed with nine assertions, and the CLI, Assistant Engine, and Web
  typechecks passed.
Completed: 2026-08-30
