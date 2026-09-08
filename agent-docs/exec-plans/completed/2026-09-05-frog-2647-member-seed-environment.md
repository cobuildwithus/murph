# Serialize hosted member seed environments

## Outcome and owner

Concurrent synthetic hosted member seeds must retain their own environment through routing and disconnect, then restore the caller environment. The existing test-only `withHostedMemberSeedEnvironment` owns environment and cached-global setup. Production owners and databases are unchanged.

## Evidence and approach

The helper currently applies process-wide environment values, awaits a seed operation, and restores values without coordinating another invocation. Two overlapping calls can observe or restore the peer environment. Serialize the existing environment scope with one module-local promise tail; evaluate ambient input only after the preceding scope restores, and release after both success and failure. No durable state, production queue, new dependency, or generic lock abstraction.

The only composed seed call invokes `seedHostedActiveLinqMember` before entering a separate environment scope, so no nested scope waits on itself. Other public helpers enter the same scope directly.

## Verification plan

- Reproduce with the public Linq seed helper and synthetic mocked storage/crypto boundaries, pausing the first member creation and checking actual routing environment.
- Cover successful and failing predecessors, disconnect, restoration, and queued default/explicit ambient environment.
- Focused hosted-Web tests, relevant typecheck/lint, complexity diff, privacy/diff review.
- Push scoped draft PR, user-requested exact-head ReviewGPT concurrently with required CI, and land only after all authorized low-risk gates pass.

## Progress

- Diagnosis and call-graph review complete. Four public-helper regressions failed on the original code: overlapping explicit input replaced the active fingerprint; ambient input restored an earlier temporary value.
- Corrected existing scope with a promise tail. The same four regressions now pass, including failed predecessor recovery and both ambient-input forms. Frozen install and Frog intake passed.
- Focused regression passed4/4 after final fixture edit; scoped ESLint and canonical Web prepared typecheck passed. The typecheck first needed the declared device-syncd build for an existing service export; that build passed without source changes.
- Complexity guard passed (test tree excluded by its policy); manual review found one scoped promise tail, no nested lock acquisition, and no production owner change. Privacy and diff checks passed.
- Implementation candidate complete; user-requested exact-head ReviewGPT and required CI are the remaining PR landing gates.
Status: completed
Updated: 2026-09-05
Completed: 2026-09-05
