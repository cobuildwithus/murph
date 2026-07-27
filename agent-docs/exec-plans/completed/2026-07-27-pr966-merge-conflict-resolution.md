Goal (incl. success criteria):
- Reconcile PR 966 with the latest `origin/main` without regressing private media delivery, group avatars, automated progress cards, account-deletion serialization, or current mainline behavior.
- Success means the PR branch merges cleanly, every conflict is resolved at the current owning boundary, required verification and ReviewGPT correction review pass, CI is green, hosted design proof is complete, and the PR is ready for merge.

Constraints/Assumptions:
- Preserve the vault as the sole durable media owner and encrypted, lifecycle-bound R2 staging as the temporary Linq avatar-ingress seam.
- Preserve private vault attachments for generated message images and automated experiment progress cards.
- Preserve the UserRunner serialization between private-media staging and account deletion.
- Use a normal merge from `origin/main`; do not rewrite the immutable ReviewGPT baseline or historical completed plans.
- Treat manual conflict resolution as behavior-bearing and rerun the required verification and correction-review gate.
- Do not add new state owners, compatibility machinery, or feature scope unless a proven conflict makes the existing owners insufficient.

State:
- Implementation and local verification complete; exact-head ReviewGPT correction review and CI remain post-push gates.

Done:
- Read the current workflow, architecture, invariant, security, reliability, frontend, verification, and PR-review guidance.
- Located the clean existing PR worktree and fetched the latest PR branch and `origin/main`.
- Confirmed PR 966 is open and draft.
- Confirmed ReviewGPT round 8 passed on the pre-merge head and that manual conflict resolution requires the ordinary next-round path.
- Resolved all 11 behavior-bearing conflicts while preserving private vault attachments, encrypted temporary R2 avatar staging, account-deletion serialization, async image wakeup, and the obsolete public-route tombstones.
- Merged the later changelog base update cleanly and recorded current `origin/main` as a branch ancestor.
- Published and verified synthetic desktop/mobile design-catalog screenshots, then added the hosted Markdown image links and required design-proof metadata to the PR body.
- Passed focused assistant-engine, assistant-runtime, Cloudflare Node, and hosted-local image-media-delivery checks.
- Passed affected owner and reverse-dependent typechecks.
- Passed canonical `pnpm test:diff ...`, including all affected package suites, hosted-web tests/lint/dev smoke/production build, and Cloudflare Node/Workers verification.
- Passed canonical `pnpm verify:acceptance`, including all workspace typechecks, package coverage and package-boundary checks, fixture coverage, hosted-web tests/lint/dev smoke/production build, and Cloudflare Node/Workers verification.

Now:
- Close this plan and push the exact locally verified head.

Next:
- Run the required ReviewGPT correction round concurrently with CI, remediate any qualifying finding, confirm the latest base remains an ancestor, and mark PR 966 ready only when every required check is green.

Open questions:
- None.

Working set:
- Every path reported unmerged by the normal `origin/main` merge.
- Directly affected private-media, generated-delivery, group-avatar, experiment-card, account-deletion, deploy, and verification owners.
- PR 966 body and local ignored design-proof artifacts.

Status: completed
Updated: 2026-07-27
Completed: 2026-07-27
