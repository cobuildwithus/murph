# PR 784 scheduled-turn authority redesign

Status: completed
Created: 2026-07-18
Updated: 2026-07-18

## Goal

- Complete PR #784 without another presentation-, prompt-, or environment-level
  authority patch: scheduled notification turns retain the task-owned reads and
  canonical writes needed for useful reminders and group challenges, while
  automation/future-schedule/device lifecycle effects remain unreachable from
  unattended model execution at a non-model-controlled boundary.

## Success criteria

- The round-3 ambient marker, leaf guards, and redundant command enumeration are
  deleted rather than expanded.
- Ordinary attended turns preserve their existing warm Codex App Server.
  Every scheduled model occurrence instead uses an exact-owned one-shot process
  whose restricted launch identity is derived only from the trusted
  `scheduledExecution` request fact.
- Production-faithful proof covers direct and indirect protected effects,
  scheduled task-owned reads/writes, interactive parity, and warm-process reuse.
- Required owner verification, coverage review, parent final review, exact-head
  CI, and ReviewGPT return green with `ROUND_OUTCOME: PASS` and zero accepted
  findings.

## Scope

- In scope: PR #784 prompt parity; local and hosted scheduled-turn execution
  planning; the native Codex execution/permission seam if it is the smallest
  enforceable boundary; automation, scheduled-log/food recurrence, and device
  lifecycle reachability; focused tests and matching durable architecture,
  security, reliability, and verification docs.
- Out of scope: a new queue, daemon, scheduler, policy manager, lifecycle store,
  general authorization framework, broad CLI redesign, or unrelated hardening
  of authenticated inbound/operator turns.

## Constraints

- Technical constraints: danger-full-access shell state is model-controlled;
  env/argv/prompt/command-name markers are not authority. Canonical ownership
  remains in current owner packages, dependencies stay acyclic, and task-owned
  canonical writes must remain available.
- Product/process constraints: preserve scheduled reminders/challenges and the
  shared prompt-layer simplification. Respect overlapping assistant-engine work
  recorded in the coordination ledger. The ReviewGPT five-round cap and anomaly
  retrospective rules remain in force.

## Risks and mitigations

1. Risk: a confinement design silently removes required scheduled behavior.
   Mitigation: inventory actual scheduled task operations first and prove each
   allowed path through the production adapter.
2. Risk: the scheduled process-wide restrictions leak into attended turns.
   Mitigation: keep the restricted catalog in an exact-owned one-shot child and
   prove the attended warm-process identity and native tool graph are unchanged
   before and after scheduled occurrences.
3. Risk: the fix grows into a second control plane.
   Mitigation: prefer deletion and an existing native/owner primitive; stop if a
   new service, durable state owner, or compatibility lifecycle appears necessary.

## Tasks

1. Reconstruct round 3, the exact executable effect graph, and current Codex
   App Server thread/turn permission capabilities.
2. Choose and document the smallest enforceable design, including why shrink,
   sandbox/confinement, or owner-boundary alternatives do or do not satisfy the
   user-visible goal.
3. Implement the design with focused production-path regressions and delete the
   round-3 marker/guard machinery.
4. Run scoped/full verification, required coverage-write audit, parent final
   review, plan closure, scoped commit, push, PR-description refresh, and CI.
5. Run the next ReviewGPT correction round concurrently with CI; triage and
   remediate until PASS or the repository's explicit cap requires a new user
   decision.

## Decisions

- Round 3 is accepted: model-visible environment state and command-family
  enumeration cannot enforce unattended-turn authority.
- No fourth same-mechanism patch will be attempted.
- Scheduled model execution receives no native execution environment. An empty
  `environments` list removes shell, patch, image-read, and permission-request
  handlers at Codex's native tool registry. The parent resolves the ordinary
  model catalog, clones it into the occurrence's private temporary directory,
  and forces every model to native `tool_mode: "direct"` and
  `multi_agent_version: "disabled"` before starting the one-shot App Server.
- Notification and maintenance runs use isolated ephemeral Codex threads in
  sterile temporary working directories and preserve the attended process and
  conversation resume state. Bounded committed transcript history reconstructs
  conversational context instead of native resume. Shared Codex-home prompt
  instructions may still influence reasoning, but cannot restore an effect
  handler or widen a typed task capability.
- Current demonstrated reads, writes, and bounded external reads move through
  typed parent-owned tools: authority-scoped canonical and bundled-skill reads,
  occurrence-keyed knowledge updates, maintenance memory updates, research
  scout, and the two canonical product feeds. The
  immutable group-challenge task binding also owns its exact shared-data
  projection and either up to four bounded prompt-only images for its existing
  comic flow or one voice memo or song, never image and audio media together;
  generic scheduled notifications remain text-only until a typed media
  policy exists. Experiment progress media is prepared by the lifecycle owner
  and attached by delivery rather than selected by the model. Device,
  automation, browser, app, plugin, subagent, permission-escalation, and general
  media tools remain absent.
- After initialization and before `thread/start`, the scheduled parent reads the
  effective Codex config and fails closed if generic MCP configuration is
  enabled or malformed. This scoped preflight preserves ordinary attended MCP
  behavior and avoids a second hosted-image policy layer.
- The contracts package owns the lifecycle invariant for typed scheduled tasks:
  preserve continuity, finite `activeUntil`, a time-driven schedule, and an
  explicit non-direct route. Core retains create-only/immutable task identity;
  query and hosted runtime consume the same pure constraint result.
- Every group-challenge provider/media/delivery boundary revalidates the exact
  automation revision and active challenge page. Terminal sent evidence is
  appended once under a canonical multi-resource lock. For an exact active final
  source, the effect owner archives the page as the fail-closed gate, removes the
  exact memory pointer, and then atomically archives only the exact automation
  revision. Replays finish interrupted cleanup from that still-active revision;
  an archived source is accepted only as a no-op after exact delivery evidence
  and completed page/pointer cleanup are already present.
- Newsletter recipient state and occurrence identity have one pure family
  classifier. A family whose unfinished recipients are all safely replayable
  retains the occurrence with backoff and recreates only those children from the
  immutable sent parent; any ambiguous or retry-exhausted recipient terminalizes
  the occurrence as a partial failure.
- Onboarding completion is complete-if-open under the existing assistant runtime
  write lock, with scheduled source validation inside the same critical section.

## Verification

- Commands to run: focused production-path Vitest while iterating; final
  `pnpm verify:acceptance`; fresh coverage-write review; relevant built/native
  Codex smoke; PR-head preflight; GitHub CI; ReviewGPT correction round.
- Expected outcomes: all checks green, direct protected-effect attempts fail at
  the non-model-controlled boundary, allowed scheduled task behavior succeeds,
  warm App Server reuse holds, and ReviewGPT returns PASS.
Completed: 2026-07-18
