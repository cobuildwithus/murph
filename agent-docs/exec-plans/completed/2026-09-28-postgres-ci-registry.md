# Use the upstream PostgreSQL image for hosted CI

Status: completed
Created: 2026-09-28
Updated: 2026-09-28

## Goal and protected invariant

Hosted CI can initialize the existing PostgreSQL 17 service without exhausting
an anonymous mirror's data allowance. Preserve service configuration, health
checks, credentials, workflow permissions and every required proof gate.

## Root cause and existing owner

Multiple independent exact-head jobs fail before checkout when ECR Public
returns a data-limit error. AWS documents a 500 GB monthly anonymous limit;
GitHub documents its hosted public Docker Hub pulls are exempt from Docker Hub
rate limiting. The public owner has two Host Support image references and one
scheduled Stripe service reference. Replace only those three image values with
the official upstream `postgres:17`, and retain the existing service owners.

## Version and provenance proof

On 2026-09-28, read-only public manifest inspection found identical upstream and
mirror OCI index bytes (SHA-256
`d74eeac9a635390a49bc21bd49fccd973de707e2a53a76ac49b552b8712ec46f`).
Both reference Linux amd64 manifest
`sha256:e31e3d5327d1806f6177827c9710643e4f35f7ab3f14d26d05332753d3e95ee0`.
This is current evidence of image equivalence, not a promise that mutable tags
will remain synchronized. No image was run and no registry login was added.
Reuse committed Frog report `20260928140031-required-web-ci`, introduced by
main commit `00001e1f796f5fa17dfba94e3a38215b0a87d656`.

## Proof and completion

- Existing source-owner assertions reject the mirrored service image before
  the patch and pass with the upstream reference. All 25 CI policy tests pass.
- Stripe proof also checks the actual hosted runner, database, health probe,
  port binding and absence of registry login configuration.
- Verify the workflow diff contains only three image substitutions; run docs,
  complexity, parent review and required exact-head CI.
- This GitHub Actions change requires independent review and human merge.
  No autonomous merge, deployment or credential change is authorized here.

## Completion evidence

All 25 source-owner CI policy tests pass; both affected owner tests rejected the
old image reference before the change. A byte-level comparison proves the
workflow diff contains exactly the three image replacements. Complexity and
documentation guards pass. Parent review verified the diff, image evidence and
official limit documentation. Required external review and exact-head CI remain
landing gates, followed by explicit human merge authorization.
Completed: 2026-09-28
