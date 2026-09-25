# Fail hosted-local startup on incompatible Temporal contracts

Status: active
Created: 2026-09-25
Updated: 2026-09-25

## Goal and invariant

Reject an incompatible external Temporal worker before hosted-local starts its
stack or prepares external services. The consumer owns its real parser;
public Murph supplies only its existing synthetic producer corpus.

## Cause and ownership

The current stack requires a package directory but starts the worker without
checking its contract. A valid directory therefore admits an older strict
parser until a later reconciliation request fails. Existing producer fixtures
and the consumer's parser verification provide the correct owners to compose.

## Scope and design

- Add a bounded, abortable startup preflight using the existing producer command
  and a consumer-owned `temporal:check-reconciliation-compatibility` entrypoint.
- Give both commands a credential-free environment and temporary synthetic JSON.
- Fail closed with an actionable error for missing or incompatible consumers;
  disabled Temporal remains unchanged. Remove the temporary directory on exit.
- Exclude production reader discovery, worker orchestration, dependencies,
  version-equality checks, copied parsers, and production connections.
- The private consumer companion adds only a package command that calls its
  existing parser verifier against its source parser. Land consumer first.

## Verification

- Focused tests: compatibility success, rejection before side effects, disabled
  mode, cancellation/time bound, environment filtering, and cleanup.
- Exercise current synthetic fixtures against the actual consumer command and
  prove the historical incompatible parser rejects them.
- Typecheck, complexity review, candidate privacy/ownership audit, exact-head
  ReviewGPT and CI. Cross-repository landing retains human review.

## Tasks

1. Establish isolated public and private checkouts and unchanged authority.
2. Add the consumer command and public startup preflight with focused tests.
3. Run focused proof and prepare separate reviewed pull requests.
4. Keep the issue open until the composed fix is verified on both main branches.

## Candidate evidence

- Public startup preflight implemented; focused stack suite (85 tests) and final
  preflight suite (6 tests) pass. Package typecheck and complexity diff pass.
- The preflight suite proves credential filtering, generation failure, consumer
  failure, timeout, caller cancellation, and temporary-directory cleanup.
- Current producer emits 11 fixtures. The existing consumer verifier accepts
  them through its actual compatibility parser; the historical strict public
  parser rejects the newer workspace fields. Package version equality would
  incorrectly reject a compatible adapter and is not used.
- Existing `startHostedLocalDevStack` complexity remains 123; the added helper
  has complexity 5. Broader stack refactoring is unrelated to this fix.

## Remaining work and landing prerequisite

The consumer companion now exposes the existing verifier through its supported
package command. Actual public preflight to that command passed using the
current 11-fixture producer corpus with no service credentials or connections.
The consumer's real-command regression also passes for valid, incompatible,
and empty corpora. No private implementation or policy is copied here.

Deliver the consumer command before this harness change. Complete configured
exact-head reviews and required CI in both repositories, then obtain the
required cross-repository landing decision. The issue remains open until both
main branches contain the composed fix. Production deployment is not involved.
