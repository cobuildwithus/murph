# Recover scheduled automation capacity failures

Status: completed
Created: 2026-10-20
Updated: 2026-10-20

## Outcome and invariants

Scheduled member-facing work must recover from unavailable Flex capacity through
Standard processing. Preserve occurrence freshness, exact delivery authority,
foreground priority, private maintenance replay barriers and duplicate prevention.

## Ownership and evidence

The cron execution owner currently selects Flex for every retry of five managed
automations. Canonical cron state already retains consecutive failures and bounded
retry timing; derive the tier from that state without adding persistence or timers.
Structured Codex serverOverloaded is incorrectly classified as a connection loss,
and flexUnavailable is marked non-retryable. Use the existing capacity retry owner
and preserve bounded structured diagnostics instead of matching provider prose.

## Scope and decisions

- First attempt uses Flex; subsequent non-maintenance attempts request Standard.
- Keep the existing six-hour managed occurrence window and ordinary reminder window.
- Private memory and room-model maintenance retain their existing Flex/replay policy.
- Capacity errors retain the general provider failure code, become retryable, and
  use the existing five-minute foreground capacity retry without connectivity advice.
- No migrations, new scheduler, model changes, provider replay loop or production replay.
- Mixed readers accept existing state unchanged. Old runtimes keep old tier behavior
  until replaced; deployment is a separate action.

## Product UX

Outcome: recover eligible scheduled updates during Flex shortages.
Reaches: managed scheduled updates, ordinary reminders and private maintenance.
Proof: synthetic cron attempts through terminal state, silence, repeated scans,
next-occurrence reset, maintenance retries and structured failure recovery.
Prompts, tools and model reply policy are unchanged; no stochastic journey is
required for a deterministic service-tier and diagnostic classification correction.

## Tasks

1. Correct tier selection and capacity classifications at their existing owners.
2. Extend deterministic regression coverage and update architecture/changelog.
3. Run focused tests, typecheck, complexity/privacy review and completion review.
4. Close this plan and create a scoped commit; report deployment status separately.

## Verification

- Focused cron, Codex failure and failure-observability suites: 352 tests passed.
- Assistant-engine typecheck passed.
- Changelog generation and production archive rendering: 10 tests passed.
- Complexity guard passed; existing cron orchestration hotspots unchanged.
- Product UX: Ready for the deterministic boundary. First-attempt Flex, immediate
  Standard delivery, delayed Standard silence, no repeat on a second scan,
  next-occurrence Flex reset, and maintenance Flex retries all passed.
- Initial package-script invocation forwarded an extra argument separator and ran
  the broader suite; it was stopped after unrelated missing-build fixture failures.
  The corrected explicit Vitest invocation selected only the three intended files.
- Parent review found no new state owner, added I/O, prompt change or duplicate
  delivery path. Production capacity and actual message delivery remain post-deploy
  observations, not claims established by synthetic proof.
- Final ReviewGPT and exact-head CI remain the PR completion gates.
Completed: 2026-10-20
