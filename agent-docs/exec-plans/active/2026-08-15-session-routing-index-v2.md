# Session routing index v2

Status: active
Created: 2026-08-15
Updated: 2026-08-17

## Goal

- Replace the shared assistant alias/conversation routing maps with one bounded-
  file SQLite projection so ordinary lookup and update work stays proportional
  to the requested routing keys, while preserving bounded recent-session
  listing and automatic recovery from the currently deployed aggregate index.

## Success criteria

- Exact alias and conversation-key updates mutate only their own keyed rows in
  one transaction and do not rewrite unrelated routes.
- Existing valid aggregate indexes migrate directly without losing their exact
  route winners or bounded recent-session behavior; missing or malformed state
  recovers from durable session files.
- Stale routes fail closed against the durable session, while a corrupt or
  unsupported projection is quarantined and rebuilt without replaying a failed
  operation; removed bindings no longer resolve.
- Assistant-engine and runtime-state focused verification, workspace typecheck,
  exact-head CI, preliminary coverage review, and the final ReviewGPT loop pass.
- The PR contains no unresolved accepted finding and remains cleanly mergeable
  with the current base.

## Scope

- In scope: assistant session routing persistence, session resolution reads,
  portable local-state descriptors, migration/rebuild behavior, and focused
  regression coverage.
- Out of scope: canonical vault data, provider/session protocol changes,
  user-facing behavior, database state, and new runtime services or queues.

## Constraints

- Technical constraints: preserve one canonical durable session record per
  session; routing state is a derived operational projection, uses SQLite
  transactions plus atomic rebuild publication, stays one steady-state file,
  and recovers deterministically after partial migration or corruption.
- Product/process constraints: start from current `origin/main`, treat the
  supplied patch as intent, prefer deletion and existing ownership boundaries,
  keep unrelated work untouched, and complete the repository's PR/ReviewGPT
  gates on the exact pushed head.

## Risks and mitigations

1. Risk: a migration or interrupted write leaves routing partially converted.
   Mitigation: build a temporary SQLite projection, publish it with one atomic
   rename, accept a legacy aggregate only as one-way migration input, and make
   first projection publication the runner rollback floor.
2. Risk: a stale route silently rebinds a canonical session.
   Mitigation: validate the expected alias or conversation key against the
   loaded session before applying any binding patch.
3. Risk: routing cardinality creates an unbounded hosted workspace file family.
   Mitigation: keep all exact keyed rows in one existing-helper-backed SQLite
   projection with `DELETE` journaling and close every handle before checkpoint.

## Tasks

1. Rebase the supplied patch onto current `origin/main` and inspect every hunk.
2. Review the state model and simplify the implementation against existing
   assistant/runtime-state ownership contracts.
3. Run focused persistence tests, runtime-state tests, typecheck, and direct
   migration/corruption scenario proof.
4. Commit and push a stable candidate, then open a draft PR with the complete
   intent, architecture, verification, and change-shape contract.
5. Run the preliminary coverage lens and final ReviewGPT round concurrently
   with CI; reproduce and resolve every accepted finding.
6. Perform the parent final review, close this plan with the final scoped
   commit, rerun required gates on the exact head, and prove mergeability.

## Decisions

- Classify as a high-risk persisted-state change: coverage lens and sensitive
  final ReviewGPT gate are required; product, prompt, and frontend lenses are
  not applicable unless the final diff broadens.
- Changelog is not applicable because this is internal assistant runtime
  persistence with no member-visible behavior change.
- ReviewGPT round 1 accepted one complexity-collapse finding: the initial
  per-route JSON design violated the hosted file-count contract. The correction
  replaces that file family with one transactional rebuildable SQLite
  projection and does not add another service, queue, lock, or canonical owner.
- The PR description's initial claim that a schema-valid stale route was
  quarantined was inaccurate. The implementation intentionally fails that route
  closed when the canonical session is loaded; only corrupt or unsupported
  projection files are quarantined and rebuilt.
- ReviewGPT round 2 accepted one original-patch migration finding: a valid v1
  aggregate is the deployed runtime's exact winner when duplicate durable
  sessions still claim one route, so migration must convert that mapping
  directly instead of synthesizing a different winner from timestamps.
- Round-3 retrospective: continue with the same single-projection design. The
  first-reviewed source shape was 409 additions / 157 deletions and the
  round-2 head was 453 / 189. Review remediation removed the unbounded file
  family rather than adding an owner. Direct v1 conversion now deletes the
  valid-migration scan from the foreground path, reuses the deployed aggregate
  schema and existing transaction, and leaves the full scan only for actual
  recovery. The parent audit's `0600` correction similarly reuses the existing
  secure assistant-file adoption primitive. Neither correction adds an owner,
  state machine, dependency, compatibility marker, or reconciliation pass.
- ReviewGPT round 3 accepted one rollback-contract finding: once the SQLite
  projection contains the only persisted effective winner, a pre-projection
  reader can reconstruct a different winner from ambiguous durable claims and
  make it survive roll-forward. Establish projection publication as the hard
  runner rollback floor using the existing immediate-rollout, exact-bundle
  smoke, and stale-runner replacement mechanisms; do not add dual-write,
  markers, reconciliation, or another routing owner.
- Round-4 retrospective: narrow the rollback requirement rather than build a
  second compatibility system. The accepted round-3 scenario proves that
  arbitrary pre-projection rollback cannot preserve the effective winner after
  projection publication without dual-writing the aggregate, persisting a
  compatibility marker, reconciling duplicate canonical claims, or adding a
  new owner. Those options contradict the single-projection direction and the
  task's complexity priority. The existing immediate container rollout, exact
  bundle smoke, and stale warm-runner replacement already implement the needed
  deployment floor. The correction changes the contract and focused proof but
  adds no production state, branch, dependency, or runtime mechanism.
- ReviewGPT round 4 accepted one review-induced recovery finding: the generic
  database wrapper quarantined and rebuilt the valid projection after any
  operation or open error, so a transient failure could destroy its precise
  route winner. Remove callback retry/recovery, propagate ordinary failures,
  and quarantine only positively identified corrupt, structurally invalid, or
  unsupported projections.
- Round-5 retrospective: the round-4 correction fixed transient callback
  failures by removing callback recovery entirely, but that left positively
  identified corruption recoverable only when opening or validating SQLite.
  Corruption first reported by an exact read, bounded recent-list read, or
  transactional write therefore preserved the known-bad projection forever.
  The root cause is two contradictory recovery boundaries rather than a missing
  isolated catch. Continue with one classification contract across open,
  configuration, schema validation, reads, lists, and writes: unsupported or
  structurally invalid projection state and SQLite primary corruption codes 11
  and 26 are quarantined; locking, permission, read-only, capacity, and ordinary
  I/O failures preserve the projection and surface unchanged.
- Operation-time corruption quarantines the closed database and fails that
  request once. The next ordinary attempt performs the existing atomic rebuild;
  the wrapper never replays a callback, especially a transactional write whose
  commit outcome may be ambiguous. This uses the existing quarantine and rebuild
  owners and adds no retry state or second recovery mechanism.
- Genuine loss of the only effective-winner projection cannot promise the same
  winner when multiple durable sessions claim one route. Recovery stays bounded
  and truthful: durable sessions remain canonical, reconstruction uses the
  existing deterministic timestamp order, and the next caller validates the
  selected route against that session. Exact winner continuity is guaranteed
  for valid projections, migrations, and above-floor restores, but not after
  positively proven irrecoverable projection corruption. Preserving that winner
  through true projection loss would require a second durable authority or
  reconciliation system, which this design deliberately rejects.

## Verification

- Commands to run: focused assistant persistence Vitest, runtime-state focused
  Vitest, `pnpm typecheck`, `git diff --check`, exact-head required CI,
  preliminary `completion-specialists`, final `pr-review`, and
  `git merge-tree --write-tree` against current `origin/main`.
- Expected outcomes: all commands pass; migration, transactional update,
  bounded-file, timestamp-order, stale-route, and corruption regression tests
  exercise production persistence code; ReviewGPT returns its required
  completion markers with no unresolved accepted findings.

## Progress evidence

- ReviewGPT preliminary specialist: pass on the first pushed head with no
  coverage gap or finding.
- ReviewGPT substantive round 1: one accepted complexity-collapse finding for
  the per-route portable file family; no other finding.
- ReviewGPT substantive round 2: the round-1 mechanism is resolved; one accepted
  original-patch finding for loss of the effective route winner during valid v1
  migration. The response exceeded the trust floor and carried the configured
  Pro model evidence and completion marker.
- ReviewGPT substantive round 3: the prior forward-migration mechanism is
  resolved; one accepted original-patch finding for the advertised
  pre-projection rollback path losing its effective winner.
- Corrected implementation: one 4.1 MB SQLite projection after a measured cold
  rebuild from 10,000 durable sessions in 48.9 seconds; the requested route
  resolved and the state directory contained exactly one file.
- Round-2 migration correction: direct conversion of 10,000 exact legacy alias
  and conversation routes completed in 681 milliseconds, preserved the selected
  route, removed the aggregate, produced one 4.1 MB `0600` database, and left
  exactly one routing-state file.
- Corrected-head local verification: assistant persistence 25/25, runtime-state
  coverage 212/212, runtime-state and assistant-engine typechecks, scenario
  integrity for 206 scenarios, and `git diff --check` all pass.
- Round-3 rollback correction verification: assistant persistence 26/26,
  focused Cloudflare rollout/runner tests 209/209, and assistant-engine,
  runtime-state, and Cloudflare typechecks all pass.
- Round-4 recovery correction verification: assistant persistence 29/29,
  runtime-state SQLite helpers 6/6, and assistant-engine and runtime-state
  typechecks all pass.
- ReviewGPT substantive round 5: the round-4 transient-failure mechanism is
  resolved; one repeated-mechanism finding requires unified operation-time
  corruption recovery and the retrospective above before implementation.
- Round-5 correction verification: one real route-index leaf was damaged after
  schema creation so version and both shape probes still passed while the exact
  production lookup and transactional write returned SQLite primary corruption
  code 11. Each request failed once, the projection was quarantined once, and
  the next ordinary operation rebuilt from durable sessions without callback
  replay. Invalid persisted route and recent rows follow the same deferred-
  rebuild policy, while the existing transient-open and non-corruption-write
  tests continue to preserve the active file. The shared transaction helper
  also preserves the original operation error if rollback itself fails, so the
  recovery classifier retains its evidence.
- Corrected-head local verification: assistant persistence 30/30; exact final
  recovery cases 2/2; runtime-state SQLite helpers 6/6; assistant-engine and
  runtime-state package typechecks; and `git diff --check` all pass.
