# Reduce first-use crypto and warm wake latency

Status: completed
Created: 2026-09-24
Updated: 2026-09-24

## Goal

- Reduce first-use crypto and warm wake latency while preserving encryption,
  recipient/runtime authority, bounded retries, cancellation and durable admission.

## Success criteria

- Remove unnecessary KMS RPC initialization; prove the four REST wire operations,
  official Google auth refresh, integrity checks and concurrent cancellation.
- Diagnose the remaining wake gap before changing its behavior.

## Scope

- In scope: Web crypto transport and demonstrated wake-path overhead.
- Out of scope: new typing owners, weaker crypto, production mutations.

## Constraints

- Reuse the Google authentication owner and existing crypto validation/retry seam.
- Keep private production evidence out of repository artifacts.
- Outcome: Earlier typing without changing reply decisions or recipients.
- Reaches: Fresh/reused Web clients, ordinary messages and concurrent failures.
- Proof: Synthetic wire tests, real-auth tests, typecheck and initialization benchmark.

## Risks and mitigations

1. REST transport changes encoding and error/cancellation behavior.
   Mitigation: Preserve the outer integrity/deadline owner and exercise actual fetch.

## Tasks

1. Replace unnecessary KMS RPC machinery with bounded HTTPS requests.
2. Investigate wake transport and remove only proved redundant work.
3. Run focused proof, review the diff, update owner docs and commit.

## Decisions

- Existing transport owns four unary operations; Google auth retains shared refresh.
- Production evidence localized startup cost to crypto preparation. Exact private
  event data remains outside this plan.

## Verification

- Focused crypto, real-auth, lazy import and ingress cache tests; Web typecheck.
- Parent review and complexity check; routed final ReviewGPT and exact-head CI
  remain required for a subsequent PR before merge.
- Production timing improvement requires deployment and bounded observation.

## Implementation and review

- Replaced the four unary KMS SDK calls with HTTPS REST at the existing crypto
  transport seam. Removed the KMS dependency and its unused dependency closure.
  Google auth still owns workload identity refresh and concurrent sharing.
- Preserved request checksums, returned-resource binding, response CRC checks,
  cancellation, ten-second attempts and the 25-second decrypt aggregate deadline.
  The transport rejects redirects and consumes at most 128 KiB per response.
- Parent review reproduced three REST retry regressions: a native connection reset,
  an unstructured HTTP 503 and an unstructured HTTP 504 failed without retry.
  Boundary normalization fixes all three while retaining at most two decrypt
  attempts and single-attempt encrypt/sign/MAC. TLS failures remain terminal.
- Added bounded native connection timing to the existing Web control Agent.
  No additional request, retry, wait, state owner or routing change was added.
  The undifferentiated wake gap remains an observation question; diagnostics
  distinguish connection setup from the remaining transport/handling interval.
- The existing callProvider hotspot remains 24, unchanged from base. Keeping one
  deadline/retry owner avoids duplicating cancellation and auth failure handling.
- Dependency refresh caused unrelated peer-snapshot churn covered by existing
  Frog entry 20260831182059-pnpm-patch-commit. Preserved the base's unrelated
  resolutions; frozen-lockfile validation passes. No new Frog entry was needed.

## Local evidence

- Seven fresh Node 24.14.1 processes per variant, using synthetic static auth and
  no network operations: KMS SDK import/client initialization median 101.6 ms
  (99.7–107.3 ms), 298 loaded CommonJS modules; Google-auth-only construction
  median 17.4 ms (17.1–20.0 ms), 72 modules. Each baseline constructs OAuth2Client,
  sets a synthetic token, imports KeyManagementServiceClient, initializes it and
  closes it. The candidate constructs the same OAuth2Client without KMS SDK work.
  These are local module/client setup measurements, not deployed request timings.
- Focused Vitest: 112 tests across GCP KMS transport/integrity, installed Google
  auth, lazy loading, ingress-root cache, control connection and changelog suites.
- `pnpm --dir apps/web typecheck`: passed, including generated prerequisites.
- ESLint over both changed source files and four changed test files: passed.
- `pnpm complexity:diff`: passed, no added complexity debt.
- `pnpm install --lockfile-only --frozen-lockfile --ignore-scripts`: passed.
- `git diff --check`: passed. Authored changes reviewed for private identifiers.

## Product walkthrough and release boundary

- Patch outcome: less first-operation crypto setup before message processing.
  Fresh and concurrent operations preserve authenticated encryption and sharing;
  cached ingress reads remain local. Synthetic failures prove bounded recovery,
  independent cancellation and fail-closed integrity checks. Ready for code review.
- No assistant instructions, tool selection, recipient policy, model invocation,
  individual/group provider input or persisted ciphertext format changed.
- The changelog describes reduced startup work without a numeric timing promise.
  Its source PR list is empty because this local implementation has no PR yet.
- No production mutation or deployment was performed. Final ReviewGPT and required
  exact-head CI remain merge gates for a subsequent PR. Web can deploy independently
  of Worker/container versions; no migration or encrypted-data rewrite is required.
- After rollout, compare crypto preparation and connection records with typing
  milestones. A sub-three-second production result is still unverified; neither
  the local benchmark nor the diagnostic proves that target has been achieved.
Completed: 2026-09-24
