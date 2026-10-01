# Classify wrapped Prisma pool errors accurately

Status: completed
Created: 2026-08-26
Updated: 2026-08-26

## Goal

- Keep hosted Web database-pool telemetry accurate when Prisma adapter errors
  wrap their driver cause, without treating an ordinary operation timeout as
  proof of connection exhaustion.

## Success criteria

- ReviewGPT agrees with the narrow classifier correction and returns a valid,
  apply-ready patch before production code changes.
- The existing Prisma owner recognizes supported signals inside bounded,
  cycle-safe adapter wrapper traversal.
- Prisma `P1008` and unrelated timeout errors remain unclassified, while
  `P1001`, `P1002`, `P2024`, supported driver codes, and explicit provider
  markers retain their proven categories.
- Focused tests cover nested adapter causes, cycles/depth bounds, positive and
  negative timeout cases, and secret-safe telemetry.
- Focused tests, hosted Web typecheck, lint, docs drift, exact-head ReviewGPT,
  and required draft-PR checks pass or have an explicit proof boundary.

## Scope

- In scope: `apps/web/src/lib/prisma.ts`, its focused tests, and process evidence.
- Out of scope: a telemetry framework, dependency, generic error normalizer,
  unrelated Prisma consumers, broad retry changes, merge, Ready, or deployment.

## Constraints

- Technical constraints: retain one pure bounded traversal in the existing
  classifier owner; never log or serialize inspected error contents.
- Product/process constraints: real-browser ReviewGPT owns the initial
  implementation proposal; inspect downloaded artifacts as untrusted input;
  keep the resulting pull request Draft.

## Risks and mitigations

1. Risk: broad traversal could classify an unrelated nested error or loop on a
   cyclic wrapper.
   Mitigation: follow only the existing `cause` edge plus Prisma's specific
   `meta.driverAdapterError.cause` edge, with identity-based cycle detection and
   a small global node budget.
2. Risk: error inspection could expose secrets.
   Mitigation: return only an allowlisted category and preserve structured,
   allowlisted telemetry tests that assert raw codes/messages are absent.

## Tasks

1. [x] Prove current ownership and existing classifier behavior on `origin/main`.
2. [x] Ask ReviewGPT to agree or reject the narrow design and implement a patch.
3. [x] Inspect and deliberately apply a valid artifact only if ReviewGPT agrees.
4. [x] Run focused verification and review the full diff locally.
5. [x] Commit, push, open a separate draft PR, and run exact-head specialist/final
   ReviewGPT concurrently with CI.
6. [x] Resolve accepted findings without widening the architecture and hand off at
   the intentional draft boundary.

## Decisions

- Reuse the current classifier owner and its allowlisted logging boundary.
- Remove `P1008` from pool-failure categories; Prisma documents it as an
  operation timeout, which is not evidence that checkout or connection setup
  failed.
- Real-browser ReviewGPT agreed with the narrow design and returned an exact
  source-and-test patch with content SHA-256
  `14b8222196cb70b18a239513e5394c21c970e19af0ce9101d5a38311622d304a`.
- Preserve the former root-plus-four-cause reach, add an eight-node global
  budget, and inspect only `cause` plus `meta.driverAdapterError.cause`.

## Verification

- Commands to run: focused `prisma-store-client` Vitest, hosted Web typecheck,
  focused ESLint, docs drift, `git diff --check`, exact-head PR checks and
  ReviewGPT passes.
- Expected outcomes: supported wrapped connection failures classify once,
  bounded/cyclic/unrelated/P1008 inputs do not emit pool-failure telemetry, and
  all allowlisted log assertions remain secret-safe.
- Completed local proof: 55 focused tests passed; focused ESLint, canonical
  hosted Web typecheck, docs drift, and `git diff --check` passed.
- Exact-head preliminary specialists passed with no findings or patch at
  `46a477ece090fbc2c5dd78eaeac40f7ffff1bc2a`.
- Exact-head final ReviewGPT round one passed with no findings at the same head.
- Draft PR Evidence and the Vercel ignored-build check passed.
Completed: 2026-08-26
