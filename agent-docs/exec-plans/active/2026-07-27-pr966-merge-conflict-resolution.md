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
- Active.

Done:
- Read the current workflow, architecture, invariant, security, reliability, frontend, verification, and PR-review guidance.
- Located the clean existing PR worktree and fetched the latest PR branch and `origin/main`.
- Confirmed PR 966 is open, draft, and currently conflicting with `main`.
- Confirmed ReviewGPT round 8 passed on the pre-merge head and that manual conflict resolution requires the ordinary next-round path.

Now:
- Merge `origin/main`, inventory every conflict and affected call path, and resolve each conflict against current owner docs and tests.

Next:
- Run focused and canonical verification, inspect the full resolved diff, commit and push the merge, complete design proof, run ReviewGPT correction review and CI, then mark the PR ready when all merge gates are green.

Open questions:
- Whether the prescribed Cloudflare Images design-proof upload credentials are now available locally without printing or persisting them.

Working set:
- Every path reported unmerged by the normal `origin/main` merge.
- Directly affected private-media, generated-delivery, group-avatar, experiment-card, account-deletion, deploy, and verification owners.
- PR 966 body and local ignored design-proof artifacts.

Status: active
Updated: 2026-07-27
