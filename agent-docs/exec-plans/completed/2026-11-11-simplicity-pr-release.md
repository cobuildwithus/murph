# Prepared and reviewed the simplicity release

Status: completed
Created: 2026-11-11
Updated: 2026-11-11

## Outcome and authority

Split the verified local cleanup into coherent pull requests, obtain GPT-6 Pro
ReviewGPT review for every PR, resolve accepted findings, pass required checks,
merge all components, and deploy Cloudflare once after the final merge. The user
explicitly permits normal Vercel deployments between merges. No temporary
integration branch or production deployment-setting changes are needed.

The local checkpoint is recorded in the completed radical-simplicity plan and
the codebase simplicity audit. Preserve live-game editing, numerical oxygen
summaries, canonical state ownership, privacy, financial identity, and meaningful
behavioral proof. The 500,000-test-line target was not achieved; do not enlarge
this release with speculative cuts to meet that number.

## Component plan

| Order | Scope | Key dependency |
| --- | --- | --- |
| 1 | Canonical data, query, metrics, importers, parsers and CLI | Move parser test consumers and both lock owners together; remove coverage floors with their explicit callers. |
| 2 | Devices, clinical sync, email and messaging proof | Include runtime device diagnostics and trusted email receipt consumers. |
| 3 | Assistant engine, runtime and Cloudflare simplification | Follow parser/device changes; retain existing v2-only admission and legacy object cleanup. |
| 4 | Billing, purchase locks and account-deletion progress | Preserve old deployment-pinned Stripe execution; no schema contraction. |
| 5 | Live games, Connect and settings recovery | Preserve editing/voting, identity changes and late-response behavior. |
| 6 | Remaining test/tooling reductions and audit documentation | Keep executable security, release and exact-head CI gates. |

Use isolated worktrees and scoped commits. Establish each PR's exact base/head
and unchanged source provenance before reusing local evidence. Keep dependent
PRs stacked until their prerequisites merge, preserving commit ancestry through
ordinary merge commits. Retarget to main and establish applicable exact-head
checks before merging. The parent owns all review disposition and final release.

## Review and verification

- Reconciled main through `f74bdcc990eff3d7f31f67f4bab1b30a0035f9b7`.
  New notification/runtime overlap: 125 tests passed; storage-guard proof: 87
  passed; assistant-engine and assistant-runtime typechecks passed.
- Preserve the checkpoint's focused owner and synthetic PostgreSQL evidence;
  run typechecks and focused proof for each split boundary and every later fix.
- Open drafts first. Mark Ready only after focused proof and parent review.
  Run ReviewGPT concurrently with CI from each PR's clean pushed checkout.
- Use GPT-6 Pro with verified model/power and one completion owner. No images
  or image payloads enter review packets. Serialize browser sends as needed;
  allow independent generations to run concurrently.
- Validate each response and record every accepted/rejected finding with actual
  path evidence. Prefer deletion, reordering and existing owners in repairs.
  Another review round is needed only under the established substantive-change
  rules, not merely to reconfirm a tested correction.
- Keep historical completed plans immutable. Update this active release record
  with PRs, reviewed heads, evidence, merge commits and deployment outcome.

## Deployment

Vercel's existing protected-main candidate/admission path remains unchanged.
Keep older Vercel deployments executable until their pinned Stripe Workflows
settle; application receipt state alone is not drain evidence. Do not delete
deployments, reset completed receipts or contract schemas during this release.

Cloudflare deploys through the protected manual workflow in private Murph Cloud,
with full predeploy gates, exact public-main source, gradual rollout and normal
smoke/convergence checks. Dispatch only after all cleanup PRs merge and the final
public release checks pass. Do not dispatch an intermediate Cloudflare release,
skip gates, use local production secrets or perform an unapproved rollback.

## Progress

- Partition and branch preparation: complete. All six initial component trees compose exactly to the reconciled checkpoint; later changelog provenance is scoped to each owning PR.
- Per-PR focused verification: fresh builds/typechecks and focused owner proof passed; the games PostgreSQL invocation was corrected to match canonical serial CI execution. All six GPT-6 Pro reviews are valid and resolved. Exact-head CI is in progress.
- Merges at this snapshot: data PR #4861 merged as `a8b55825091f72ebc5e41d7718fdc4014eb7126f`; remaining components await exact-head CI and ordered merge.
- Single Cloudflare deployment and post-deploy evidence: pending. The original completion owner continues delivery; final merge and release receipts are recorded on [PR #4866](https://github.com/cobuildwithus/murph/pull/4866). This archived code-preparation record does not claim deployment completion.

## Pull requests

| Component | PR | Initial candidate source |
| --- | --- | --- |
| data | [#4861](https://github.com/cobuildwithus/murph/pull/4861) | `84d7c098a05371c64eacd01d90586d910e86bede` |
| devices | [#4862](https://github.com/cobuildwithus/murph/pull/4862) | `97c8e2633ddb4c289f15884b910db41fbdab1136` |
| runtime | [#4863](https://github.com/cobuildwithus/murph/pull/4863) | `078947d6a225657a758946ab67f37287b66d83fe` |
| authority | [#4864](https://github.com/cobuildwithus/murph/pull/4864) | `d29b5722dc392cb60489eeeb8450a18d36b990c1` |
| experience | [#4865](https://github.com/cobuildwithus/murph/pull/4865) | `8eeb1e7845a09c933999018dff72f38075179623` |
| tooling | [#4866](https://github.com/cobuildwithus/murph/pull/4866) | `488a659f73028857b32204b60866a126b46f77e2` |

These heads identify the prepared candidates; accepted review fixes and final
merge/deployment evidence are recorded below as they occur. Reviews run on the
actual pushed heads, including changelog provenance.


## Review corrections

- Data: accepted deletion of unused collector family buckets and duplicate result
  types. The existing entity collection is sufficient. Net 93 lines removed;
  134 focused tests, typecheck, complexity guard and real-file base/head
  comparison passed. Three CSV scenario strings were corrected to stop naming
  the retired preset option; scenario integrity and CLI typecheck passed.
- Runtime: accepted the smoke runner home-directory mismatch. Restore the
  existing `home` path while keeping the obsolete restore wrapper deleted.
  Ten focused tests and Cloudflare typecheck passed; native confinement remains
  a required corrected-head CI check.
- Devices: accepted the collision between member documents named `manifest.json`
  and system metadata. Resolve manifest paths through the existing canonical
  document evidence owner; retain damaged-metadata rejection and replay proof.
- Experience: remove redundant effect state resets; the existing member-keyed
  page owner resets Connect UI. All 120 Connect cases, focused lint and Web
  typecheck passed, including logout, relogin and replacement-member behavior.
- Authority: CI exposed six fixtures without an activation transport. Preserve
  the production acknowledgement requirement; acknowledge and verify the real
  persisted mailbox pointer at the fixture's external transport boundary.
- Tooling: add the audit to the canonical documentation index. Doc gardening
  reports zero issues.

The initial authority, experience and tooling responses were recovered but failed model attestation. They were excluded; replacement round-one reviews below passed. Original captures remain unchanged. The separate early-response attestation gap is recorded in the task's Frog entry.

## Validated review receipts

| Component | Reviewed head | Outcome | Review |
| --- | --- | --- | --- |
| data | `84d7c098a05371c64eacd01d90586d910e86bede` | One finding accepted, fixed and verified | [GPT-6 Pro](https://chatgpt.com/c/6af4eede-9694-83ea-92fd-634484985fcb) |
| devices | `97c8e2633ddb4c289f15884b910db41fbdab1136` | One finding accepted, fixed and verified | [GPT-6 Pro](https://chatgpt.com/c/6af4ef27-0d48-8326-b34c-2358ae7f50a6) |
| runtime | `078947d6a225657a758946ab67f37287b66d83fe` | One finding accepted, fixed and verified | [GPT-6 Pro](https://chatgpt.com/c/6af4eeb7-faf0-832a-b485-74b440c82075) |
| authority | `8be2b06725fe46c82141202e9b93d99f6b73db16` | PASS; no qualifying findings | [GPT-6 Pro](https://chatgpt.com/c/6af4f686-0584-8332-b398-0df7ce0d6f0c) |
| experience | `5da4d6c0e01bd5514b757f2f2c891d8989e9cd50` | PASS; no qualifying findings | [GPT-6 Pro](https://chatgpt.com/c/6af4f684-f2e8-83ea-ae7e-843467136dd9) |
| tooling | `43c660229ccfb6aebdd62f959dd7662f03b1b4d0` | PASS; no qualifying findings | [GPT-6 Pro](https://chatgpt.com/c/6af4f6c0-a1e4-832f-999f-56b5b66e4cc7) |

The final combined source passed a fresh prepared build, full workspace typecheck
and scenario-integrity check after prerequisite fixes and current main were
merged. The last documentation commit records this evidence and closes the
implementation plan; it adds no behavior and requires no new review round.

The release candidate at `43c660229ccfb6aebdd62f959dd7662f03b1b4d0`, compared
with pre-merge main `1485217c1942e8ea938f4c993c572617590c0ca3`, removes 68,623 net
lines across 462 paths: 62,114 test/fixture lines and 6,258 source lines under
the report's classification. Final documentation closure may change doc counts.
The requested 500,000-test-line target remains unmet. Retained behavioral proof
and current product requirements govern deletions.
Completed: 2026-11-11
