# Temporal Worker Binding Admission

Status: completed
Updated: 2026-08-22

## Goal

Ship the two authenticated owner admissions required by the private
versioned-blue/green Temporal worker, then deploy the public owners before
arming the exact private merge SHA so worker capacity moves without standby or
downtime.

## Constraints

- Reuse the existing callback signing key, timestamp, nonce, and replay
  protection; add no bearer token, service, queue, scheduler, or schema.
- Keep Web and Cloudflare as narrow owner attestations. Neither route may own
  Temporal routing, readiness, member state, or rollout decisions.
- Keep both responses uncached and restricted to the five `bindings-v1`
  contract fields expected by the private worker.
- Deploy Web and Cloudflare before activating an inactive Render color, and
  retain the previous live worker until the versioned controller proves Current
  convergence.
- Run no additional ReviewGPT rounds, per the user's explicit instruction.

## Plan

1. Add the shared binding-admission response contract.
2. Add memberless signed Web and Cloudflare `GET` routes using existing replay
   owners and focused regression coverage.
3. Update the durable architecture and deployment contracts.
4. Run focused tests, app/package typechecks, architecture/docs guards, exact
   diff inspection, and required GitHub CI.
5. Commit, open, merge, and deploy the public prerequisite in safe order.
6. Configure the exact production owner URLs, arm the private merge SHA, and
   verify the blue/green controller reaches Current without dropping live
   worker capacity.

## Verification

- Web callback and route tests: 11 passed.
- Cloudflare route suite: 117 passed.
- Hosted-execution, Web, and Cloudflare typechecks passed.
- Hosted Temporal architecture guard passed.
- Documentation drift and privacy/diff guards passed.
- Dependency policy passed. Workspace-boundary verification remains blocked by
  two pre-existing imports outside this task's changed paths.
- Pending PR CI, owner deploys, and live versioned worker convergence proof.
Completed: 2026-08-22
