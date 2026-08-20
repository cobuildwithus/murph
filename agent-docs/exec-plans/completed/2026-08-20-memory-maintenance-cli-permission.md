# Restore hosted memory maintenance through a host-owned tool

Status: completed
Created: 2026-08-20
Updated: 2026-08-20

## Goal

- Restore the existing silent hosted memory-maintenance job by moving its
  canonical-memory reads and writes behind one host-owned dynamic tool, with
  shell access disabled and the vault workspace denied to the model runtime.

## Success criteria

- Only the exact engine-authorized overnight automation receives the memory
  maintenance tool and its write authority.
- The maintenance turn has shell, apps, plugins, web search, native memories,
  and workspace access disabled while network remains denied.
- Focused runtime proof reads and writes canonical memory through the trusted
  host boundary, including a copy of the downloaded affected vault.
- Focused tests and affected typechecks pass, exact-head CI is green, and both
  required ReviewGPT gates have no unresolved accepted findings.
- Production deploy uses immediate runner convergence and reports the new
  bundle fingerprint before the incident is moved to monitoring.

## Scope

- In scope: the managed automation prompt, exact maintenance-tool planning and
  execution authority, the existing permission-profile owner, focused runtime
  and profile coverage, release documentation, and the public reliability
  recovery note.
- Out of scope: automation schedules, ordinary assistant prompts, delivery behavior, retries,
  database schema, Web runtime behavior, ordinary-turn memory behavior, and
  member data.

## Constraints

- Technical constraints: reuse canonical `@murphai/core` memory operations and
  the existing tool-only maintenance-turn pattern; preserve the dedicated
  network-denied profile while removing shell and workspace authority.
- Product/process constraints: Product UX Patch; the job remains private and
  silent, no member message is introduced, and production evidence stays out
  of repository artifacts.

## Risks and mitigations

1. Risk: exposing canonical-memory mutation to an ordinary or forged turn.
   Mitigation: offer the tool only for the exact managed automation id and
   require the same immutable authorization at execution.
2. Risk: retaining a hidden shell or filesystem dependency.
   Mitigation: use the shared native-capabilities-disabled thread config, deny
   the complete workspace in the dedicated profile, and prove shell suppression
   through the real Codex App Server scripted runtime.
3. Risk: a stale warm runner keeps the broken bundle after deploy.
   Mitigation: use immediate container rollout and require managed-container
   fingerprint convergence plus the protected runner smoke.

## Tasks

1. Add one member-memory dynamic tool backed by canonical core operations and
   gate it to the exact managed maintenance authority.
2. Offer only that tool to member-memory maintenance, disable native
   capabilities, and reduce its permission profile to workspace and network
   denial.
3. Update focused planning, dispatch, real App Server, profile, and release
   smoke coverage; prove the affected downloaded vault through a private copy.
4. Run focused tests, affected typechecks, and production-shaped direct proof.
5. Push an exact candidate, complete preliminary and final ReviewGPT gates with
   CI, merge, and deploy through the protected production workflow.
6. Verify convergence and recovery, update the incident, and retire the task
   worktree.

## Decisions

- Reuse the existing group room-model maintenance architecture: the trusted
  host owns canonical writes and Codex receives only a narrowly described tool.
  No new service, scheduler, retry, state owner, or broad filesystem authority
  is warranted.
- Reject directory-wide `bank` write access. Canonical memory uses atomic
  replacement and audited lock/operation files, so a shell filesystem allowlist
  cannot both authorize the real write and remain file-scoped.
- Treat the member experience as a Patch: scheduled private context maintenance
  works again without changing its timing, destination, or silent behavior.

## Product UX Patch

- Outcome: Murph can again keep relevant private saved context current during
  the existing scheduled maintenance pass.
- Reaches: an established hosted member whose silent maintenance occurrence
  needs to read or update the canonical memory document; sparse or unchanged
  memory continues to complete silently with no member delivery.
- Proof: the real App Server suppresses shell execution while the offered
  host-owned tool reads and updates canonical memory through core, and the
  dedicated profile denies the model direct workspace and network access.

## Product UX Walkthrough

- Established history: the scheduled occurrence receives its existing bounded
  conversation evidence, reads the populated canonical memory document through
  the host-owned tool, and may update only that document. No audience or
  delivery is introduced.
- Sparse or unchanged history: the existing no-op/skip path remains unchanged
  and sends no message.
- Failure and recovery: a missing vault or rejected canonical write returns a
  generic failed tool result and makes no update; the model cannot fall back to
  shell or arbitrary vault reads.
- Result: Ready. This Patch changes only the private maintenance mechanism and
  removes the invalid shell permission path without changing schedule,
  evidence, saved-memory semantics, or delivery.

## Verification

- Commands to run: focused assistant-engine App Server/planning/tool tests,
  hosted-execution and Cloudflare contract tests, affected package/app
  typechecks, `git diff --check`, the final-image runner smoke on native AMD64
  CI, exact-head required CI, and protected deploy smoke.
- Expected outcomes: only the exact automation receives `murph.member_memory`,
  the turn uses the native-capabilities-disabled config and workspace-denied
  profile, core reads/writes succeed, and the deployed smoke reports the
  expected bundle fingerprint.
- Local results: assistant-engine focused planning, authorization, provider,
  replay-barrier, prompt, and managed-automation tests passed 270/270; the real
  App Server tool-only scenario passed 1/1 with shell suppression and a
  canonical host write; hosted-execution profile tests passed 4/4;
  assistant-runtime config tests passed 44/44 with 4 skipped; Cloudflare
  container contracts passed 11/11; changelog tests passed 45/45. The
  assistant-engine dependency build and assistant-engine, hosted-execution,
  assistant-runtime, Cloudflare, and Web typechecks passed; `git diff --check`
  passed.
- Private data proof: the host tool read, added, and updated canonical memory on
  temporary copies of both distinct downloaded vault variants; the original
  downloads were never mutated and no saved content was emitted.
- Native AMD64 root-cause proof: read-only `/app` advanced the command to
  sandbox startup, where the file-scoped writable memory path caused a Rust
  panic involving bubblewrap synthetic mounts. Content-free diagnostics proved
  `rustPanic`, `bubblewrap`, `syntheticMount`, and `mount`, with no ordinary
  permission, missing-file, module, or seccomp error. This confirms the
  file-as-directory sandbox construction rather than a CLI or vault-data bug.
- Exact-head CI result: every PR-owned gate passed at
  `e165694e7645c83f2c0bdb81ca0c639e0b0de650`, including native AMD64 runner
  sandbox proof, both host matrices, release build and app verification, all
  four coverage lanes, billing and Stripe boundaries, reply cardinality,
  repository hygiene, PR evidence, and Vercel's intentional ignored build.
- Review result: the preliminary specialist and final round 1 both found the
  missing downstream expectation required by the first `/app` candidate. The
  finding was valid for that reviewed baseline and was superseded by the
  host-owned-tool architecture, which deletes `/app` and shell mutation. The
  specialist artifact was test-only and had its declared hash, but correctly
  failed `git apply --check` on the current head because it would assert the
  deleted permission. Final round 2 received a full guarded snapshot of the
  current head, explicitly verified the prior finding as resolved, and returned
  `ROUND_OUTCOME: PASS` with no qualifying findings. Parent final review found
  no remaining correctness, security, reliability, privacy, or complexity
  defect.
- Closure boundary: this execution plan closes on the reviewed merge candidate.
  The live incident workflow continues to own the single current-base
  reconciliation, required exact-head CI, merge, protected production deploy,
  post-deploy convergence proof, incident transition, and worktree retirement.
Completed: 2026-08-20
