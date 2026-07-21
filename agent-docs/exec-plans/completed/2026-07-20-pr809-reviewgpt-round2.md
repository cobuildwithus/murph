# PR 809 ReviewGPT round-two remediation

Status: completed
Created: 2026-07-20
Updated: 2026-07-20

## Goal

- Keep dense-memo onboarding responsive while ensuring the voice-only labs
  closer has a provider-fence-safe transcript fallback.

## Success criteria

- The three accepted onboarding children are acknowledged immediately through
  the existing progress-update effect, without a completion claim.
- The final labs response carries only the generated voice memo when available;
  its transcript is the existing channel fallback rather than duplicate text.
- Linq gives that fallback a distinct stable provider-effect identity derived
  from the persisted delivery key or attachment identity.
- Focused tests, package typechecks, diff verification, CI, prompt review, and
  the next ReviewGPT round pass on the exact pushed head.

## Scope

- Onboarding skill, global progress guidance, and durable onboarding contract.
- Linq voice-memo fallback identity in the existing channel adapter.
- Focused assistant-engine, hosted-runtime, and hosted-web boundary tests.
- Matching reliability and documentation index updates.

## Constraints

- Add no queue, schema, retry manager, lifecycle state, or new delivery owner.
- Keep the acknowledgement and final voice delivery as separate existing
  effects.
- Preserve the immutable first-reviewed PR head and review only the remediation
  delta in the next ReviewGPT round.

## Tasks

1. Separate the post-spawn acknowledgement from the voice-only final reply.
2. Derive a stable transcript-fallback identity at the existing channel owner.
3. Prove the fallback through the hosted runtime and web dispatch fence.
4. Complete verification, commit, push, CI, and ReviewGPT round three.

## Verification

- Focused assistant-engine prompt/channel tests passed (116 tests).
- Full assistant-engine suite passed (2,529 tests; five skipped).
- Full assistant-runtime suite passed (1,738 tests; two skipped).
- Focused hosted-web Linq authority suite passed (32 tests).
- Assistant-engine, assistant-runtime, and hosted-web typechecks passed.
- Required local prompt review passed with no findings.
- `pnpm docs:drift` and `pnpm test:diff` passed.
- Exact-head CI and ReviewGPT round three remain pending after push.
Completed: 2026-07-20
