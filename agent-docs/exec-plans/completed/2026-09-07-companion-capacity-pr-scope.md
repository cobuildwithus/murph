# Keep companion capacity separate from concurrent runtime recovery

Status: completed
Created: 2026-09-07

## Scope and ownership

PR #3025 appeared during completion and independently addresses the same
provider-fanout checkpoint failure. It retains every accepted continuation,
including queues with more than 100 non-reconstructible jobs. Preserve that
active PR's ownership and narrow PR #3020 to companion admission at 500.

The earlier completed plans remain immutable evidence of the investigation and
reviewed candidate. Their runtime implementation and tests are removed from the
final PR diff; this scope supersedes their shipping description. The current
reliability owner and release note describe only the capacity increase.

## Verification and release

Retain the 17/500 acceptance cases, rejection at 501 and replay at 500. Run the
focused Web wake and changelog tests, Web typecheck, complexity and docs checks.
Run final review and CI on the narrowed candidate. Deploy runtime recovery from
#3025 before or alongside the capacity increase. No merge or deployment of the
other session's active PR is performed here.

## Results

All 210 focused Web tests and Web typecheck pass. Complexity, docs drift and
whitespace checks pass. Parent review confirms the sole production change is
the existing capacity constant and comment. Runtime recovery remains owned by
#3025; no other active PR was modified. Final scoped review and CI follow the
pushed candidate.
Updated: 2026-09-07
Completed: 2026-09-07
