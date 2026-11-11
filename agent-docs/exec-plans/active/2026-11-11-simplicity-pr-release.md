# Review and release the simplicity cleanup

Status: active
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
- Per-PR focused verification: fresh builds/typechecks and focused owner proof passed; the games PostgreSQL invocation was corrected to match canonical serial CI execution. ReviewGPT and exact-head CI are in progress.
- Merges: pending.
- Single Cloudflare deployment and post-deploy evidence: pending.

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

Data, devices and runtime have validated GPT-6 Pro review receipts. The initial
other three answers were recovered against their exact accepted turns, but
model attestation remained unavailable. They do not count as passes; preserve
those receipts and retry round one on the corrected stable candidates. The
separate early-response attestation gap is recorded in the task's Frog entry.
