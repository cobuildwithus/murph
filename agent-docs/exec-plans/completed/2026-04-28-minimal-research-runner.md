# Minimal Research Runner

Status: completed
Created: 2026-04-28
Updated: 2026-04-28

## Goal

Simplify the Health Commons research runner back to a thin wrapper over `review:gpt`:

- `send` stages one prompt in a named browser lane and records the resulting ChatGPT URL plus lane metadata.
- `harvest` reads the recorded URL/lane and uses that same lane for wake/export/download/normalization.
- no resend bypass, no cross-lane exploration, and no global workspace URL ownership scan in the normal path.

## Scope

In scope:

- `scripts/research-run.mjs`
- `scripts/review-gpt-browser-profile.sh`
- `scripts/research-init.test.ts`
- `.agents/skills/health-commons-research/SKILL.md`
- this plan and the coordination ledger row

Out of scope:

- Changing generated research workspace outputs.
- Changing Health Commons content pages.
- Reworking `review:gpt` internals.
- Building a new orchestrator or global lane lease system.

## Current State

The current runner contains several recovery-oriented mechanisms that made normal operation harder to reason about:

- `RESEARCH_ALLOW_RESEND_WITH_EXISTING_CHAT_URL=1`
- `--explore-lane`
- cross-workspace URL ownership scans
- browser-target visibility probing inside `research-run`
- automatic browser restart/repair behavior in the profile helper

## Desired Shape

- Max browser budget remains about 30 ChatGPT tabs per managed profile.
- Sending does not replace an existing seam URL. A failed or stale seam must be quarantined/cleared explicitly first.
- Harvesting sticks to the recorded lane and recorded URL.
- Profile helper may open a tab or ensure an endpoint, but should not restart a lane unless invoked through an explicit manual command.

## Verification

Completed:

- `node --check scripts/research-run.mjs`
- `bash -n scripts/review-gpt-browser-profile.sh`
- `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/research-init.test.ts`
- `git diff --check` on touched files

Blocked:

- `pnpm typecheck` is blocked by unrelated active `apps/web` AuthButton work:
  - `apps/web/src/components/ui/auth-button.tsx`
  - `apps/web/test/auth-button.test.ts`
Completed: 2026-04-28
