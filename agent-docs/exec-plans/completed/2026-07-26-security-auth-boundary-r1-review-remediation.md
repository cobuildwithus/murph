# Security auth-boundary ReviewGPT remediation

Status: completed
Created: 2026-07-26
Updated: 2026-07-27

## Goal

- Resolve final ReviewGPT round-one findings on PR 991 without widening the
  original credential boundary: every supported ordinary hosted Codex sandbox
  must preserve its selected authority while child tools cannot access or
  mutate the host-owned Codex home.

## Success criteria

- Read-only, workspace-write, and danger-full-access hosted targets each map to
  one native guarded permission profile.
- The read-only and workspace profiles retain their matching Codex built-in
  authority; the root profile retains root write and tool-network authority.
- Child tools cannot read or mutate managed credentials or executable config.
- Thread start and resume fail closed when the effective profile, built-in
  parent, or workspace roots differ from the request.
- Focused tests, canonical diff verification, acceptance, native Ubuntu smoke,
  corrected-head CI, and final ReviewGPT correction verification pass.

## Scope

- In scope: hosted permission-profile generation and selection, App Server
  request/attestation checks, hosted sandbox bootstrap persistence, native
  runner smoke/contract, tests, and current owner docs.
- Out of scope: local Codex authority, group-email/output-only behavior,
  narrower one-shot profiles, provider auth lifecycle changes, new state, and
  deployment.

## Constraints

- Technical constraints: use Codex native profiles; custom profiles may extend
  `:read-only` and `:workspace`, while root remains explicit because custom
  profiles cannot extend danger-full-access. Deny the whole managed Codex home.
- Product/process constraints: preserve all accepted sandbox values and
  ordinary warm-thread continuity. Keep the architecture stateless and
  behavior-preserving. Do not merge PR 991.

## Risks and mitigations

1. Risk: a custom profile silently widens or narrows the configured sandbox.
   Mitigation: declare the mapping once, attest the effective built-in parent,
   and prove read/write/network behavior in the native image.
2. Risk: a child changes managed config for a later warm App Server.
   Mitigation: deny the managed Codex home and prove read, overwrite, rename,
   and delete attempts fail while host-owned files remain unchanged.
3. Risk: ARM-hosted AMD64 emulation cannot install restricted-profile seccomp.
   Mitigation: keep the local failure fail-closed and require the native Ubuntu
   CI sandbox job for authoritative restricted-profile proof.

## Tasks

1. Implement and test the three-profile mapping and effective-parent
   attestation.
2. Expand the production-image smoke and persistence coverage.
3. Reconcile security, architecture, protocol, deploy, and testing docs.
4. Run canonical verification and locally inspect the complete correction.
5. Commit, push, update PR 991, run ReviewGPT correction round two alongside
   CI, and resolve any correction-only findings.

## Decisions

- Preserve all three supported hosted sandboxes; deletion would break persisted
  operator configuration and product-critical restricted modes.
- Deny the entire managed Codex home rather than enumerate current sensitive
  files, because executable config and credentials share one host-owned root.
- Keep ordinary profiles warm/resumable; narrower group profiles remain
  ephemeral and one-shot.

## Verification

- Commands to run:
  - focused owner typechecks and tests
  - `pnpm docs:drift && pnpm docs:gardening`
  - `pnpm --dir apps/cloudflare runner:docker:smoke:prepared-base`
  - `pnpm test:diff packages/operator-config packages/assistant-engine packages/assistant-runtime packages/hosted-execution apps/cloudflare`
  - `pnpm verify:acceptance`
  - corrected-head PR CI and ReviewGPT final correction round
- Expected outcomes: all repository checks pass; local emulated Docker may stop
  only at the documented inner-seccomp limitation after the root boundary
  passes; native Ubuntu must prove every profile.
- Focused owner tests and typechecks, documentation checks, the canonical
  five-owner diff command, and the parent privacy/diff review are green.
- `pnpm verify:acceptance` completed every touched-owner check, Web build, and
  Cloudflare verification. Its unchanged Core coverage lane had one transient
  gzip-trailer integration-test failure. The branch has no Core diff, the
  failed test blob is byte-identical to `origin/main`, the exact failed case
  passes in isolation, and the full Core coverage command passes all 44 files
  and 761 tests.
- Final ReviewGPT correction round two and corrected-head CI remain required
  after the closure commit is pushed.
Completed: 2026-07-27
