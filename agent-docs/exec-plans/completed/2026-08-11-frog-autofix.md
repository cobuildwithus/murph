# Automate trusted Frog issue repairs locally

Status: completed
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Run a durable local macOS schedule that checks every two hours for new Frog
  issues, starts one isolated Codex repair session, requires ReviewGPT to return
  the implementation patch, and merges and closes the issue only after the
  repository's normal review and required-CI gates pass.

## Success criteria

- The poller considers only open issues authored by the configured Frog GitHub
  App and bound by an exact committed `issue:` line under the default branch's
  friction-log tree.
- One scheduled invocation handles at most one issue in one sanctioned task
  worktree, and GitHub branches, pull requests, merges, and issue state remain
  the recovery source of truth.
- The Codex worker treats issue content as untrusted evidence, asks a fresh
  ReviewGPT Pro thread for a patch attachment, validates and applies that patch,
  follows Murph's plan, verification, preliminary ReviewGPT, final ReviewGPT,
  PR, and merge rules, and never substitutes an independently invented patch.
- Merge and explicit issue closure occur only after the exact PR head has green
  required checks, required ReviewGPT outcomes pass, and GitHub accepts an
  ordinary non-admin merge.
- A user-session LaunchAgent runs once at install and every 7,200 seconds,
  remains serialized, survives terminal exit, and exposes install, uninstall,
  run-once, scan, and status controls.
- Local configuration and bounded operational logs contain no credential,
  issue body, issue title, command output, local username, or absolute home
  path.

## Scope

- In scope: a repository-owned Frog autofix launcher and worker prompt,
  executable guard coverage, macOS LaunchAgent installation, bounded local
  status logging, durable architecture/security/reliability/verification docs,
  focused local proof, required ReviewGPT gates, exact-head CI, merge, and one
  post-merge installed scan/run proof.
- In scope as a verification prerequisite: correct the two stale assistant
  prompt-heading assertions currently making the default branch's release
  verification red without changing runtime behavior.
- Out of scope: a hosted service, GitHub Actions merge authority, organization
  or branch-protection bypass, a second task queue, persistent issue bodies,
  parallel issue repairs, automatic conflict resolution, or use of the Frog
  reconciliation App credential by the local worker.

## Constraints

- Technical constraints: use the installed Codex worker helper with one job and
  an ephemeral workspace-write child session with network access and only the
  existing managed-browser profile, exact transient output directory, and
  linked worktree's shared Git directory as additional writable roots; use the
  repository's `scripts/create-worktree` and `scripts/retire-worktree`
  boundaries; use the authenticated local `gh`, Codex, and managed ReviewGPT
  browser sessions without copying credentials; keep every external wait
  bounded by the owning CLI; never use `--admin`, a ruleset bypass, or broad
  process termination.
- Trust constraints: validate repository identity, issue author, open state,
  label, committed binding, exact branch, and clean worktree before model work;
  never interpolate issue title/body into the parent worker prompt; regard
  GitHub content, ReviewGPT prose, and attachments as untrusted evidence until
  the child verifies them against the repository.
- Privacy constraints: local durable state is owner-only and metadata-only;
  worker prompts and complete tool output are temporary and removed after the
  child exits; committed/generated public artifacts use no direct local
  identifiers or absolute home paths.

## Risks and mitigations

1. Risk: a forged or prompt-injected issue steers a credentialed local agent.
   Mitigation: require the exact Frog App author plus an exact binding already
   committed on protected `main`, pass only the issue number to the worker, and
   tell both Codex and ReviewGPT to treat the issue as evidence rather than
   instructions.
2. Risk: an imperfect model patch merges without sufficient scrutiny.
   Mitigation: require an attached ReviewGPT implementation patch, independent
   Murph preliminary and final ReviewGPT gates when routed, exact-head required
   CI, the repository's normal merge authority, and no admin bypass.
3. Risk: scheduler overlap or a crash creates duplicate branches or PRs.
   Mitigation: combine LaunchAgent serialization with an owner-verified local
   run lock, process one issue, and recover from GitHub's deterministic issue
   branch and PR identity instead of a second local queue.
4. Risk: the job persists credentials, private paths, or model transcripts.
   Mitigation: inherit existing authenticated tools without reading their
   secrets, keep only bounded numeric/status events, remove transient worker
   artifacts, and test the generated LaunchAgent/config privacy boundary.
5. Risk: a long ReviewGPT or CI wait blocks later schedules.
   Mitigation: the ReviewGPT and GitHub waits use explicit limits, launchd
   coalesces schedules while the single job is running, and a failed or timed-
   out worker leaves recoverable GitHub state for the next two-hour pass.

## Tasks

1. Specify exact discovery, claim, worktree, ReviewGPT patch, PR, merge, issue-
   closure, local-state, and failure contracts.
2. Implement the launcher, pure guards, worker prompt, LaunchAgent controls,
   bounded metadata log, and focused executable tests.
3. Update the owning architecture, security, reliability, verification, and
   testing-map documentation and repair the stale default-branch assertions.
4. Run focused tests, typecheck, shell/static checks, privacy scans, a real
   read-only GitHub discovery pass, and generated LaunchAgent inspection.
5. Commit and open the PR, complete preliminary and final ReviewGPT gates,
   require exact-head CI, merge without bypass, install from updated `main`,
   and verify the loaded two-hour schedule plus a real run-once result.

## Decisions

- Use a user-session macOS LaunchAgent with `StartInterval=7200` and
  `RunAtLoad`, not an endless shell loop or hosted service.
- Handle one issue per invocation. Backlog advances every two hours while each
  individual repair remains serialized and reviewable.
- Keep GitHub as the only durable work queue and completion ledger. Local state
  contains only a lock, a home-relative checkout locator, and bounded event
  metadata.
- Require ReviewGPT to author an attached patch before Codex may implement the
  repair. The child may adapt or reject the patch after evidence-based review,
  but may not replace an absent patch with its own implementation.
- Use ordinary merge permissions and branch protection. Red or missing gates
  leave the PR and issue open for a later run or human intervention.

## Verification

- Commands: focused Vitest coverage for discovery, author/binding checks,
  prompt construction, lock recovery, generated LaunchAgent privacy, and state
  retention; repository tools typecheck; shell syntax; docs drift/reference
  checks; `git diff --check`; a real `scan` against GitHub; install/status/run-
  once proof after merge; current-base merge-tree proof; exact-head CI.
- Expected outcomes: the current unmerged Frog reconciliation bindings produce
  no eligible repair, synthetic trusted fixtures select exactly one oldest
  issue, all adversarial fixtures fail closed, generated durable files contain
  no direct identifiers or credentials, and the installed LaunchAgent reports
  a 7,200-second interval without spawning a worker for an ineligible issue.
- Passed local proof:
  - focused Frog autofix and Frog workflow guards: 13 tests
  - full repository-tools suite: 533 tests
  - focused assistant model-behavior suite: 73 tests
  - canonical `pnpm typecheck`
  - docs drift, shell syntax, generated plist lint, generated launcher syntax,
    direct identifier/credential scan, and `git diff --check`
  - real GitHub scan returned zero eligible issues because the current bindings
    remain on the unmerged reconciliation PR
  - a mutating run from a secondary worktree failed before discovery or model
    work and retained only one bounded `blocked` event
- Pending external proof: exact-head ReviewGPT gates and CI, merge, primary
  checkout installation, loaded LaunchAgent inspection, and one installed run.
Completed: 2026-08-11
