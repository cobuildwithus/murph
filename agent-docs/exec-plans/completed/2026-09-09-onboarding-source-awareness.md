# Acknowledge connected health sources during onboarding

Status: completed
Created: 2026-09-09
Updated: 2026-09-09

## Goal and scope

Update the existing onboarding skill to acknowledge connected sources before
asking for missing wearable context. Apple Health alone is not evidence of
wearable ownership. Keep the existing hosted device tool and canonical memory
owners; no runtime, provider, persistence, or authorization changes.

## Product UX and success criteria

Patch effort. Replay synthetic private onboarding journeys: Apple Health with
unknown wearable use asks once about a watch or ring; an already answered
negative moves on; an identified wearable moves on; no accounts permits the
ordinary discovery question; lookup failure stays unknown. Current evidence
avoids a lookup, otherwise at most one unfiltered read precedes the reply.
Never reconnect an established source, infer fresh data, or require a wearable.

## Tasks

1. Remove the unconditional wearable question from the park example and update
   the data-source checkpoint and Apple Health setup exclusion.
2. Add deterministic policy proof and production-derived real-Codex journeys.
3. Run focused tests, relevant typecheck, changelog validation, and complexity
   review; inspect every synthetic reply and the complete diff.
4. Add a public outcome changelog, close this plan, and make a scoped commit.

## Verification

- Passed: `pnpm --dir packages/assistant-engine test test/assistant-skill-assets.test.ts -t onboarding` (4 tests).
- Passed: `pnpm --dir packages/assistant-engine typecheck`.
- Passed: `pnpm --dir apps/web test changelog-page.test.tsx` (10 tests).
- Passed: `pnpm --dir apps/web typecheck`.
- Passed: `pnpm complexity:diff`; runtime implementation is Markdown, with no
  authored JavaScript/TypeScript source changes. Test branches cover distinct
  product outcomes and need no production abstraction.
- Passed: five individually selected `pnpm test:assistant:live -- --test
  "onboarding source awareness: .*<case>"` journeys, using `gpt-5.6-terra`
  with local subscription auth. Cases: `unknown wearable use`,
  `wearable use already answered`, `an identified wearable`,
  `no connected sources`, and `an unavailable account lookup`.
- A working authenticated local profile was selected under the documented
  retry contract after pre-action authentication/startup failures. No auth
  material was copied or persisted by this task.
- Exact effects: one unfiltered account read in each unknown-state case;
  zero reads with current Apple Health evidence and an earlier negative
  answer. Zero connection mutations or hosted device CLI fallbacks.
- Reply review: Ready for all five journeys. Apple Health is acknowledged
  before a watch/ring question only when wearable use remains unknown;
  identified wearables and earlier answers advance to the foundation memo;
  no accounts permits discovery; unavailable lookup remains explicitly
  unknown with no retry or reconnect suggestion.
- The failure journey initially exposed a second read following the generic
  tool error hint. The onboarding owner now explicitly keeps its optional
  one-read limit after any result, and the same journey passed on rerun.
- The identified-wearable journey accepts a truthful connection acknowledgement
  without requiring the incidental adjective “connected.” Its exact action
  and forbidden-claim assertions remain in place; the rerun passed.
- Passed: final diff whitespace and personal-identifier scans. All fixtures and
  release notes are synthetic and contain no private feedback or account rows.

## Review and delivery

The runtime implementation is one onboarding reference. Existing account reads,
conversation evidence, and optional connection paths remain the owners. There
is at most one on-demand hosted account read at the data-source checkpoint;
no background snapshot or per-message read is added. Initial provider input
and group behavior are unchanged because this reference is read on demand in
private onboarding. A failed read preserves uncertainty and continues without
retry or a connection mutation.

Prompt-primary work qualifies for the ReviewGPT exemption. No PR, push,
deployment, or production mutation is part of this task. The changelog fragment
has no source PR number because this task produces a local scoped commit.
Completed: 2026-09-09
