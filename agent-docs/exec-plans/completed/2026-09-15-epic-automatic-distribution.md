# Gate hospital-approved Epic imports

Status: completed
Created: 2026-09-15
Updated: 2026-09-15

## Outcome and protected invariants

Default Epic imports use only a reviewed USCDI-v3 automatic-distribution API
set. A default-empty provider-ID feature flag enables the broader catalog only
for specifically provisioned organizations, using a separate Epic client.
Preserve labs, reports, lifetime query slices, patient binding, consent,
checkpoint identity, partial outcomes and existing canonical import semantics.
No Epic registration or production configuration is mutated by this PR.

## Owner and evidence

Web's existing Epic policy owns query selection; control-plane owns OAuth and
run admission; retrieval owns provider egress. The full catalog currently
expands every granted family into every variant, including non-USCDI APIs.
Epic's automatic-distribution appendix, public current API catalog and per-API
specifications establish eligibility. Conflicting or unverified eligibility
stays gated. Registration remains an external prerequisite: filtering requests
cannot convert a manually distributed client into an automatic client.

## Design

- Keep the existing full query catalog and frozen-plan wire format.
- Derive a reviewed default query subset from registration API keys.
- Use a default-empty provider allowlist as the feature flag, with separate
  required hospital-approved production/non-production client IDs and no fallback.
- Check the selected client again at callback; a configuration change requires
  a new authorization instead of widening an in-flight grant.
- Gate page and document requests against the current provider policy so older
  broad frozen plans cannot bypass a disabled flag. Saved records remain intact.
- No database migration, new queue, importer variant, UI switch or dependency.

## Product UX

- Effort: Product change.
- Entry: existing private medical-record connection flow.
- Promise: patient authorization imports supported available clinical records.
- Journeys: default labs/clinical history; explicitly enabled hospital; partial
  grant; configuration change during OAuth; old broad plan after flag removal;
  eligible and gated linked-document reads.
- Proof: composed Web authorization and retrieval tests, policy eligibility
  coverage and Web typecheck. Live Epic authorization is an external launch gate.

## Tasks and verification

1. Cross-check all current registrations against official Epic sources and
   record public API identifiers, naming aliases and conservative exclusions.
2. Implement default selection, scoped opt-in and callback/egress enforcement.
3. Test default and opted-in requests, grant subsets, resume and document gates.
4. Update current owner docs and environment examples; run focused tests,
   Web typecheck, complexity diff and parent review.
5. Open a PR; run required exact-head CI and final ReviewGPT concurrently.

## Deployment

Web-only policy change; existing runner accepts subsets of frozen query slices.
Provision an automatically distributed Epic client for the default configuration.
Keep broad client IDs only in the separately named opt-in configuration. Deploy
Web before enabling consumer entry points; flag removal blocks future restricted
egress without deleting saved evidence. An older Web deployment ignores this
policy, so disable admission before any rollback below this gate.

## Changelog decision

No public release claim: prelaunch provider-registration gating does not make
Epic access live. The integration remains behind its existing discovery posture
and requires separate registration and live verification before announcement.

## Implementation and verification results

- Cross-checked all 70 registrations using Epic's distribution appendix, current
  public catalog and linked patient-read specifications. Default retains 42 APIs
  and 24 queries across 16 families; conflicting evidence remains gated.
- Composed start/callback tests prove selected clients, real SMART scope selection,
  partial-plan admission and configuration-change rejection. Retrieval tests prove
  restricted frozen plans and previously issued document tickets stop before egress.
- Full clinical-record suite: 240 passed, 10 integration tests skipped by the local
  test configuration. Focused control-plane/retrieval tests: 100 passed.
  Web typecheck passed.
- Scoped ESLint passed with two pre-existing unused-destructuring warnings.
- Documentation drift and whitespace checks passed. Privacy scan passed.
- Complexity diff passed with unchanged debt. The page-fetch function remains 21
  after consolidating duplicate control-plane-error handling; the existing outcome
  transaction is 33 and unchanged. Further extraction would expand unrelated scope.
- Parent review checked OAuth/client binding, default lab/document dependencies,
  sandbox separation, frozen-plan compatibility and the external registration gate.
- Live Epic authorization and registration edits remain external launch work.
  PR CI and required final ReviewGPT run on the pushed candidate.
Completed: 2026-09-15
