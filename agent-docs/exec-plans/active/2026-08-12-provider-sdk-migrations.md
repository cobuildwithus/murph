# Replace handwritten provider transports with official SDKs

Status: active
Created: 2026-08-12
Updated: 2026-08-13

## Goal

- Have independent ReviewGPT implementation passes replace the identified
  handwritten Junction, Linq, OpenAI, Resend, ElevenLabs, Exa, Lob, and Google
  Cloud KMS provider calls with provider-maintained clients.
- Preserve Murph's stricter validation, timeout, retry, response-size, privacy,
  credential, and hosted-egress invariants around those clients.

## Success criteria

- Each in-scope API operation uses the official provider SDK except raw
  presigned upload/download byte transfer, where plain fetch remains the
  provider-documented transport.
- AgentMail remains unchanged.
- Every new manifest dependency uses an exact version and the committed
  lockfile is updated through the repository's supply-chain controls.
- Focused tests and typechecks, dependency checks, exact-head CI, preliminary
  ReviewGPT specialists, and the final ReviewGPT loop pass.

## Scope

- In scope:
  - Junction clients in Web and device-syncd.
  - Linq API operations in Web, operator-config, and Cloudflare.
  - OpenAI Responses and Images calls in hosted onboarding and assistant image
    generation.
  - Resend plain-text send and batch operations.
  - ElevenLabs text-to-speech and music calls, including operational scripts.
  - Exa research-scout search operations.
  - Lob letter creation and lookup.
  - Google Cloud KMS and Google Auth operations, treated as an independent
    security-sensitive boundary.
- Out of scope:
  - AgentMail.
  - Provider behavior, user-visible copy, provider credentials, egress policy,
    or retry-policy changes beyond what is required to preserve current
    behavior when adopting the SDK.

## Constraints

- Technical constraints:
  - ReviewGPT authors the implementation patches; the parent inspects, applies,
    integrates, and verifies them.
  - Keep SDK dependency specs exact, retain local Zod and defensive response
    validation, and avoid broad compatibility wrappers.
  - Preserve injected fetch and hosted-egress routing where the current
    security boundary requires it.
- Product/process constraints:
  - Run multiple isolated ReviewGPT implementation sessions with bounded,
    non-overlapping provider scopes.
  - Treat all returned patches as untrusted intent and inspect every hunk before
    application.
  - Keep direct identifiers, credentials, private provider payloads, and local
    filesystem paths out of durable artifacts.

## Risks and mitigations

1. Risk: SDK defaults alter retries, timeouts, base URLs, or error behavior.
   Mitigation: Preserve the current transport policies explicitly and add
   focused request-shape and failure-path proof.
2. Risk: concurrent provider patches overlap shared manifests or the lockfile.
   Mitigation: apply source/test hunks by provider, reconcile exact manifest
   entries once, and regenerate the lockfile from the combined manifests.
3. Risk: KMS migration weakens credential scoping or key/resource validation.
   Mitigation: keep it isolated, inspect provider types and auth construction,
   and require security-focused direct tests plus final cross-cutting review.
4. Risk: an SDK omits a currently used operation or cannot preserve the hosted
   fetch boundary.
   Mitigation: prove the package surface first; retain only the smallest
   documented raw-byte exception or report a concrete SDK blocker.

## Tasks

1. [x] Inventory current calls, package ownership, tests, SDK versions, and
   provider-specific invariants.
2. [x] Run parallel ReviewGPT implementation passes and retrieve their patch
   artifacts.
3. [x] Inspect, apply, and integrate accepted patches with exact dependency
   pins and one combined lockfile update.
4. [x] Run focused tests, typechecks, dependency checks, and parent diff review.
5. [ ] Push the exact candidate, run preliminary and final ReviewGPT audits
   concurrently with CI, remediate findings through subsequent ReviewGPT
   rounds, and close the plan.

## Decisions

- AgentMail is explicitly excluded by the user.
- Operational `.mjs` scripts are included because the reported guard blind
  spot otherwise leaves ElevenLabs migrations incomplete.
- The change is internal-only provider-boundary maintenance; changelog is not
  applicable unless implementation reveals a member-visible behavior change.
- Junction 1.2.0 owns request construction and typed responses. Device-syncd
  retains one bounded successful-response fallback only when the SDK rejects a
  provider response shape that the deployed client already accepts. The
  fallback is capped at 32 MiB and is never used for non-2xx responses.
- KMS credential refresh uses its own bounded no-retry lifecycle so one caller
  cannot cancel a refresh shared by another operation. Individual KMS RPCs
  remain caller-cancellable and use the official generated client boundary.

## Review anomaly retrospective

The candidate is intentionally larger than the ordinary source-churn threshold:
it replaces eight independent external-provider boundaries, their owner-package
manifests, and the guard that previously missed raw provider HTTP. Most churn is
the KMS security boundary, Junction compatibility boundary, and Linq adapters
plus direct proof. These providers could have landed as separate PRs, but the
user requested one audited provider-client correction and the combined exact
lockfile/release-shape/guard proof is shared. The final design deletes the old
operation-level transports; it keeps only demonstrated SDK adapters for
response caps, cancellation, hosted fetch ownership, and Junction's bounded
legacy-success compatibility. No new queue, persistence owner, retry loop, or
provider abstraction was introduced.

## Verification

- Commands to run:
  - Provider-focused unit tests and owner-package typechecks.
  - `pnpm provider-requests:guard` and its focused tests.
  - `pnpm deps:guard`, `pnpm deps:audit`, `pnpm deps:ignored-builds`, and a
    frozen-lockfile install check.
  - `git diff --check`, secret-safe identifier scans, exact-head CI, and the
    routed ReviewGPT passes.
- Expected outcomes:
  - Existing request semantics and defensive validation remain intact while
    request and response construction is owned by pinned provider SDKs.
  - No raw provider operation remains at an in-scope call site except approved
    presigned byte transfers.

- Completed local evidence:
  - Web full suite: 775 files considered, 728 passed / 47 skipped; 10,171 tests
    considered, 9,768 passed / 403 skipped.
  - Device-syncd full suite: 46 files and 979 tests passed. Final Junction
    focused suite: 226 tests passed after the streamed response-cap correction.
  - Repository tooling suite: 35 files and 540 tests passed.
  - Web, Cloudflare, operator-config, CLI, assistant-engine, device-syncd, and
    hosted-execution owner typechecks passed.
  - Frozen-lockfile install, provider request guard, dependency policy,
    ignored-build inventory, release-target verification, and diff hygiene
    passed.
  - Dependency audit still reports the repository baseline of 76 transitive
    findings (6 low, 38 moderate, 31 high, 1 critical); none names an SDK added
    by this migration.
  - Exact-head CI plus preliminary and final ReviewGPT completion gates remain
    pending until the candidate is pushed.
