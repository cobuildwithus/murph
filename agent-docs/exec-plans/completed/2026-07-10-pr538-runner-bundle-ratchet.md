Goal (incl. success criteria):
- Resolve PR #538's final-head hosted runner bundle budget failure without hiding unrelated boot-path growth.
- Success means the static-closure baseline records the CI-measured intentional closure for the interruptible blood-test summary, the ratchet/tolerance remain unchanged, focused bundle proof passes, and final-head CI reruns green.

Constraints/Assumptions:
- Preserve the fixed total ceiling and both existing tolerance bands.
- Do not add a new exception, disable the budget, or broaden Cloudflare runtime behavior.
- Use the exact CI-measured static closure from both failing jobs: 6,820,054 bytes.

Key decisions:
- Treat the closure growth as intentional: the background snapshot now reaches a narrow core streaming reader instead of the uninterruptible query projection.
- Update only the reviewed static-closure baseline and its measurement comment.

State:
- Complete.

Done:
- Confirmed both failing GitHub Actions jobs stop at the same static boot-closure budget check.
- Confirmed all other final-head local guards/typechecks and the affected core/runtime suites passed.
- Recorded the exact 6,820,054-byte CI baseline while preserving both tolerances and the fixed 9,300,000-byte total ceiling.
- Passed the 27-test focused bundle suite, Cloudflare typecheck, and production bundle assembly with all parity probes.
- Coverage-write found no proof gap; security/privacy review found no medium-or-higher findings.

Now:
- None.

Next:
- Commit and publish the CI follow-up, then rerun the PR review loop and final-head CI.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/cloudflare/scripts/runner-bundle/bundle-entrypoint.ts
- apps/cloudflare/test/runner-bundle-entrypoint-bundle.test.ts
- pnpm --dir apps/cloudflare runner:bundle:hosted-local
Status: completed
Updated: 2026-07-10
Completed: 2026-07-10
