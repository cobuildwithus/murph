# Preserve attachment typing handoff across the runtime abort guard

Status: completed
Created: 2026-09-13
Updated: 2026-09-13

## Product UX

- Outcome: restore typing through an attachment reply and subsequent turns.
- Reaches: authorized Linq direct and group attachment conversations.
- Proof: reuse one typing session, release it after delivery, and preserve
  wrong-authority and aborted-invocation denial.

## Cause and scope

The bridge importer starts attachment typing with the original provider fetch.
The runtime wraps that function with its abort guard before assistant execution.
The handoff's function-identity check rejects the different wrapper, retaining
the typing claim and suppressing new sessions through its cooldown.
A synthetic reproduction confirmed fifteen minutes of suppression.

Pass the existing guarded provider fetch through the mailbox import context.
Keep exact handoff matching, explicit missing-provider denial, and standalone
bridge behavior. Add no state, retries, timers, network calls, or model guidance.
The separate model-turn latency observation is outside this deterministic fix.

## Tasks and verification

1. Add a regression through the runtime entrypoint and mailbox bridge; observe
   the handoff failure before changing production code.
2. Correct the provider-function transport and rerun the composed regression,
   attachment authority/cancellation tests, and channel-activity tests.
3. Run assistant-runtime typecheck, changelog rendering, and complexity diff.
4. Review privacy, authority, and the complete diff; commit the scoped change.
5. Hosted deployment and live typing acceptance remain separate operational proof.

## Decisions

- No real-model journey: the change is deterministic transport wiring and does
  not change interpretation, prompts, tool selection, silence, or reply prose.
- Preserve the current provider identity check; do not substitute diagnostic
  identifiers or remove invocation-bound authority.

## Progress

- In-memory synthetic reproduction passed before implementation.
- The composed runtime-entrypoint/bridge regression failed at attachment
  handoff before the production change.
- The corrected import context retains the exact guarded provider function.
  Explicit null overrides any original bridge provider.
- Focused runtime proof passed: 38 tests across
  `hosted-runtime-typing-handoff.test.ts`,
  `hosted-runtime-attachment-typing.test.ts`, and
  `hosted-runtime-channel-activity.test.ts`.
- `pnpm --dir packages/assistant-runtime typecheck` passed.
- Changelog generation and the repository-root changelog-page suite passed
  (10 tests). The app-directory command and missing generated module reproduced
  existing Frog entry `20260912202546-changelog-focused-test`; its documented
  generation/root-command workaround succeeded. No new friction entry needed.
- `pnpm complexity:diff` passed: unchanged complexity debt in both source
  files. Existing large runtime functions are outside this narrow wiring fix;
  splitting them would not simplify the changed operation.
- Parent review: Ready for the deterministic transport patch. No provider
  request, wait, retry, or persisted state was added. Wrong-function authority
  still fails closed; successful handoff reuses one session and releases it
  before the next reply; abort and missing-provider cases pass.
- Local implementation is complete. No PR or production mutation was requested
  or performed; final PR review, CI, release, and live typing proof belong to
  that subsequent delivery lane. Changelog source PRs remain empty until then.
Completed: 2026-09-13
