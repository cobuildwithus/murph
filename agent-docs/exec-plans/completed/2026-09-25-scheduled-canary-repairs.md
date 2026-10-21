# Repair scheduled native, Frog, and Garmin canaries

Status: completed

## Outcome and boundaries

Repair Android SDK admission, intermittent iOS authentication proof, Frog
reconciliation timeouts, and Garmin browser authorization. The Garmin canary
account has no activity yet: accept a confirmed empty provider result as an
explicit no-data outcome, never as canonical ingestion proof. Preserve real
errors, positive-data matching, connection/disconnection, and cleanup checks.
Linq and the retired assistant real-model CI are out of scope.

## Owners and plan

- Native source tags and public controller pins must move together after
  focused verification. Preserve non-destructive existing-identity mode.
- Garmin's public test producer and private receipt consumer must agree on
  data-matched versus no-data outcomes; deploy the reader before the writer.
- Frog must reuse its issue index across publish batches without changing
  per-run mutation ceilings or trusted-author deduplication.
- Prove the iOS failure cause before changing login behavior or retries.

## Verification

Run focused browser/data-oracle, native-controller, and Frog behavior tests,
relevant typechecks, and private-repository verification. Keep external
provider proof distinct from synthetic proof. Review exact pushed heads with
required CI and ReviewGPT; report missing hosted acceptance honestly.

## Implementation and evidence

- Android source tag `native-android-e2e-v24-20260925` points to reviewed
  `929d9493e178d12523ac4705963326199bae37a3` with the SDK package fix;
  10 source-contract tests passed.
- iOS source tag `native-ios-e2e-v3-20260925-r13` points to reviewed
  `ce4664fc32a0bd0158a078a681e436bb7021c034`, including the merged native
  OTP editing-buffer fix and current journey selectors. Fourteen contract
  tests and 43 focused simulator authentication/input tests passed. A live
  scheduled run must still confirm whether the intermittent OTP failure is
  resolved; previous bounded failure summaries did not expose its substage.
- All 36 public native/wearable controller tests passed.
- Garmin browser authorization revalidates route trust after login-form
  navigation; 65 browser tests passed. Six data-oracle tests passed, including
  explicit empty responses, provider errors, malformed records, cancellation,
  and independent canonical value/provenance matching. Seven configuration
  boundary tests passed without live provider calls.
- Frog registry patch shares matcher and newly-created issue indexes across
  batches within one invocation, partitioned by repository, label, and trusted
  author. Five publisher/guard tests passed, including duplicate-title filing
  across batches without a duplicate issue. Frozen installation succeeded.
- Tools, Web, and the declared Cloudflare typecheck passed. An initial direct
  check of Cloudflare's base tsconfig selected the wrong module mode; its
  package-owned `typecheck` command is the authoritative passing check.
- Docs drift, whitespace, and complexity checks passed. Existing browser
  hotspots remain at 35 and 26 with no added complexity debt. No broad browser
  rewrite is warranted for this navigation fix.
- Private Garmin reader verification covers deployed v1 matched receipts and
  v2 `matched`/`no_provider_data` receipts, with strict field rejection. The
  private reader must land before the public producer. Runtime data, member
  behavior, and model input are unchanged; no public changelog is needed.
- Hosted acceptance remains separate: source rotations and the public/private
  canary changes must land before protected manual/scheduled execution. Keep
  the reviewed candidate and rollout evidence in the linked PRs.
Updated: 2026-09-25
Completed: 2026-09-25
