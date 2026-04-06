Repository bootstrap:

- Before editing, read `AGENTS.md` and follow it.
- Treat that file as required worker bootstrap, not optional background context.
- If it points to additional repo docs, follow the stated read order before making code changes.
- If it requires coordination or audit workflow steps, do those explicitly rather than assuming the parent wrapper handled them.

This prompt is for the final proof lane and should run only after the Batch 3 cleanup is integrated.

You own the final scenario proof. Bias heavily toward tests and narrow test-helper cleanup rather than runtime refactors.

Constraints:

- Preserve unrelated dirty-tree edits.
- Prefer end-to-end-ish and integration-style coverage over new abstractions.
- Do not reintroduce wide-row assumptions in fixtures or helpers.
- Avoid production-code edits unless a failing proof exposes a tiny missing seam or testability issue.

Goals:

- Add proof for:
  - phone invite to Privy completion to checkout
  - active Linq inbound routing
  - active Telegram inbound routing
  - verified email sync without Prisma email identity storage
  - Stripe reconciliation through `HostedMemberBillingRef`
- Delete or rewrite tests that still assume the old wide `HostedMember` shape.

Primary files:

- focused tests under `apps/web/test/**`
- docs only if the proof changes a durable claim

Acceptance:

- The privacy split is proven by scenario coverage rather than just local unit assumptions.
- Old wide-row test assumptions are removed.
