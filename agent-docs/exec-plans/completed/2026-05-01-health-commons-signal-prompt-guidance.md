# Health Commons Signal Prompt Guidance

Status: completed
Created: 2026-05-01
Updated: 2026-05-01

## Goal

- Update the Health Commons research workflow guidance for protocol `expectedSignalDescriptions` so Pro/research prompts prioritize concise mechanism copy, measurable downstream markers, and best-effort estimated changes.

## Success criteria

- The research workflow skill and live prompt templates describe the new expected-signal guidance.
- Guidance discourages tautological exposure/adherence metrics as outcome wins.
- Guidance prefers objectively measurable wearable, sensor, home-device, or lab-test markers when credible.
- Docs-only verification/readback passes.

## Scope

- In scope: research workflow skill text and live research/reducer prompt templates that reference expected signal guidance.
- Out of scope: editing protocol content directly in this docs pass, changing Review GPT browser automation, or editing immutable completed execution-plan snapshots.

## Constraints

- Keep the guidance direct and concise.
- Preserve source-key privacy rules and existing Health Commons evidence discipline.
- Do not include local user identifiers in docs or commits.

## Tasks

1. Locate live expected-signal guidance.
2. Patch the skill and live prompt docs.
3. Read back touched docs and run docs-only checks.
4. Commit the scoped docs update if verification is clean or only blocked by unrelated work.

## Verification

- Direct readback of touched files passed.
- `bash -n scripts/research.sh` passed.
- `git diff --check` passed for the touched files.
- `pnpm typecheck` passed.
Completed: 2026-05-01
