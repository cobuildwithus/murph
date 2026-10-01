# Reduce authenticated dashboard loading latency

Status: completed
Created: 2026-09-15
Updated: 2026-09-15

## Goal and scope

Reduce actual work before authenticated dashboard content is usable. Include the
existing phone-recovery optimization and audit all dashboard routes except Ops.
Open a PR and complete focused proof, required CI, and final ReviewGPT.
Loading placeholders, production deployment, and Ops changes are out of scope.

## Decisions and cause evidence

- Shared page auth already skips full member decryption for non-candidate phone
  recovery; this benefits every authenticated dashboard route.
- Biomarkers currently reads every published overview to build its device list.
  Put the required fields in the existing generated browse index and preserve
  the old output in a composed equivalence test.
- Settings, Connect, and Records have no Browser Vault data consumers. Avoid
  starting the payload loader on these routes. Reuse the disabled provider's
  clearing and fresh-authority behavior when returning to health-data pages.
- Preserve Settings' deliberate sequential database helpers and existing contact
  request deduplication. Health routes already request only needed vault shards.
- Redirect-only routes need no additional work. Ops behavior stays as it is.

## Product UX

Effort: Patch. Result: Ready.
Journeys: established member, newly verified phone, anonymous visit, account-page
navigation, return to health data, consent withdrawal, and changed member.
The rendered pages and interactions stay the same. Returning from an account
page reloads health data behind fresh session authority; no decrypted snapshot
is exposed without authorization.

## Tasks

1. Implement narrow data-work reductions and regression proof.
2. Run focused tests, relevant typechecks/lint, complexity guard, and parent review.
3. Open draft PR, complete evidence/changelog linkage, push stable Ready head.
4. ReviewGPT passed; finish the test-only CI corrections and rerun exact-head CI.

## Verification

- Web focused suites: 172 tests across Browser Vault, biomarker rendering,
  catalog boundaries, and Next tracing; 163 auth/Home/recovery/changelog tests;
  22 phone-welcome tests including one-statement PostgreSQL preflight proof.
- Health Commons runtime, build determinism, and validation: 231 tests passed.
- Web and Health Commons typechecks passed. Focused ESLint passed with two
  existing unused-variable warnings. Complexity guard passed; nine pre-existing
  hotspots remain unchanged. Further splitting would broaden this performance
  patch without removing its demonstrated work.
- Biomarker output matches the old overview-derived list. The real catalog has
  six published device biomarkers; the list removes six overview reads totaling
  37,985 bytes plus the route-index read. The browse index is 225,272 bytes.
- Settings, Connect, Records, and Records Connect execute zero replica fetches,
  recipient-key generation calls, or payload decryptions in provider tests.
  Health routes and Ops retain their load; return from Settings blocks old data
  until fresh authority resolves, including a denied-consent response.
- Parent review: account routes have no Browser Vault consumers, manual export
  retains its separate loader, consent invalidation remains canonical, and
  no auth result is cached across requests. New phones retain live recovery.
- No production timing claim: authenticated production replay and deployment
  are outside this local proof. CI and final ReviewGPT remain pending on the PR.


## Review and CI disposition

- PR: https://github.com/cobuildwithus/murph/pull/3489.
- ReviewGPT round 1 passed on `2433e71d72e76d9dfda13eced0c686b715376c26`
  with zero findings. The managed Mountain lane selected `gpt-6-pro`; matching
  model metadata, attachment, exact response hash, and completion marker were
  verified. The response wait exceeded six minutes. The source-based review
  covered all 21 files and the auth, recovery, replica, and catalog boundaries.
- An additional 91 shared-provider consumer tests passed. CI found two
  test-scaffolding gaps: the local SQL guard rejected CI's `murph_test_gate`
  database name, and a companion route Prisma fixture lacked `findFirst`.
  Both were reproduced and corrected without changing production source.
- Corrected phone SQL suite: 22 passed; companion route suite: 115 passed;
  Web typecheck passed. Total distinct focused tests: 794.
- These isolated proof corrections and plan closure use the review loop's
  non-production exemption; the reviewed production patch is unchanged.
- Existing synthetic Biomarkers rendering was inspected at 1440px and 390px,
  with HTTP 200 and no document overflow. Exact list equivalence covers the
  data-preparation change; no new loading UI or visual changes were introduced.
- Local implementation, parent review, and ReviewGPT are complete. Required CI
  must pass again on the final pushed commit after this archive step. Keep the
  worktree while the PR remains open; no merge or deployment is authorized.
Completed: 2026-09-15
