# PR 570 Percentage Usage Follow-up

## Outcome

PR #570 communicates monthly allowance consumption consistently as a percentage
across member-facing conversation/outbound messages and hosted web UI. Exact
currency amounts remain internal billing inputs and do not appear as usage
progress copy.

## Scope

- Merge current `origin/main` into the PR head and resolve conflicts
  semantically.
- Inventory every member-facing usage string and formatter in the PR patch.
- Derive one bounded percentage from the existing usage/allowance owner data.
- Render the same percentage semantics in assistant tool output, outbound
  notices, the home limit banner, and hosted billing settings.
- Update focused tests and durable hosted-plan-usage documentation.
- Run scoped/full verification, mandatory specialist audits, exact-head CI,
  and ReviewGPT before returning the PR to ready state.

## Invariants

- Currency-denominated usage and allowance data remain available only to the
  internal metering/billing owners that require them.
- Percentages are finite, non-negative, and understandable at zero allowance
  and overage boundaries.
- Usage gating, sponsorship authority, and billing-period ownership do not
  change.
- iMessage/SMS copy remains conversational and does not become broadcast-shaped.

## Completion

- [ ] Latest `origin/main` merged and conflicts resolved.
- [ ] UI and conversation/outbound usage progress use percentage language.
- [ ] Focused tests and direct stale-string checks pass.
- [ ] Required local audits have no accepted findings.
- [ ] Scoped/full verification passes.
- [ ] Commit is pushed to PR #570 and exact-head CI plus ReviewGPT are green.
- [ ] PR is merged under the user's standing instruction.
