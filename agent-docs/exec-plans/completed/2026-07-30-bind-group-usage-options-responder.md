# Bind group usage options to the accepted responder

Status: completed
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Ensure a group member who accepts a low-usage options prompt receives only
  that member's earned options, even when adjacent inputs contain other senders.

## Success criteria

- The request-bearing accepted message is authorized before the referral read.
- Multi-sender runtime context is reduced to that authenticated participant.
- Missing, stale, or foreign authority fails closed.
- Focused tests, package typechecks, docs drift, CI, and ReviewGPT pass.

## Scope

- In scope: group referral reads, existing accepted-message authority, runtime
  sender injection, prompt guidance, focused regression coverage, durable spec.
- Out of scope: new state, queues, identity caches, billing mutations, or
  changes to direct-personal referral ownership.

## Constraints

- Technical constraints: reuse the accepted-message participant resolver and
  preserve direct-personal reads and existing Web actor resolution.
- Product/process constraints: keep the first group heads-up link-free and
  preserve the complete earned-plus-sponsored follow-up.

## Risks and mitigations

1. Risk: grouped inputs expose more than one sender.
   Mitigation: authorize the exact opaque message reference and carry only its
   provider-authenticated participant to the runtime wrapper.
2. Risk: a forged or stale reference targets another member.
   Mitigation: fail closed through the existing cumulative accepted-message
   authorizer.

## Tasks

1. Add optional model-facing `message_ref` for referral reads and require it in
   group turns.
2. Carry the authenticated participant through the existing group-tool port.
3. Derive one channel-specific sender handle at the runtime wrapper.
4. Add two-sender and parser regressions; update the skill and durable spec.
5. Verify, commit, push, rerun CI, and complete the ReviewGPT correction round.

## Decisions

- Reuse the participant authority already used by self-only group effects.
- Keep direct-personal referral reads unchanged.

## Verification

- Commands: focused Vitest suites for assistant-engine, assistant-runtime, and
  hosted-execution; all three package typechecks; `pnpm docs:drift`;
  `git diff --check`; exact-head CI and ReviewGPT correction round.
- Expected outcomes: all pass; no group referral read can infer its owner from
  aggregate turn senders.
Completed: 2026-07-30
