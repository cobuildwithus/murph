# Preload hosted crypto standby keys

Status: active
Created: 2026-08-07
Updated: 2026-08-07

## Goal

- Make hosted domain-root cryptography ready for a later safe rotation without
  interrupting existing Web or Worker reads, then securely generate and
  preload one standby authority-signing version and one standby Cloudflare
  automation recipient keypair without changing either active key.

## Success criteria

- The public Cloudflare deploy renderer forwards the optional authority verify
  keyring and Cloudflare automation private keyring through the existing
  private workflow mappings, with focused regression coverage.
- A live rotation runbook documents ownership, safe deploy order, rollback
  floor, secret handling, the boundary before activation, and the proof needed
  by a future envelope migration and retirement.
- Exact-head CI, preliminary specialist ReviewGPT, and final ReviewGPT pass
  with no unresolved accepted finding.
- New key material is generated with platform or operating-system CSPRNGs;
  authority private material remains non-exportable in GCP KMS, and the
  Cloudflare private JWK is never printed, placed in command arguments, or
  written into tracked or review artifacts. Its only plaintext-file hop is the
  ignored, permission-restricted Wrangler secrets payload on the ephemeral
  deploy worker.
- Web and Worker retain the current active generation while accepting the new
  generation only in non-active standby states.
- Aggregate database proof shows that preloading did not alter active envelope
  key references.
- Live Vercel and Cloudflare checks prove the intended active/keyring binding
  names and healthy production behavior without reading secret values.

## Scope

- In scope:
  - Public deploy-contract code, focused tests, and durable security/deploy
    documentation.
  - Existing private `murph-cloud` workflow mapping/contract verification when
    needed by the public contract change.
  - Vercel Production, the protected GitHub Production Environment,
    Cloudflare Worker bindings, and GCP KMS key-version creation for the
    non-active standby generation.
- Out of scope:
  - Unrelated provider-secret cleanup, preview-environment construction,
    Cloudflare bucket cleanup, or general deploy-workflow refactors.
  - Introducing a new key-management service, rotation daemon, or persisted
    product-state owner.
  - Switching active keys, re-signing or rewrapping stored envelopes, or
    retiring current key material. The repository has no production mutation
    owner for those operations, so they require a separately designed and
    reviewed change.

## Constraints

- Technical constraints:
  - Old and new readers must overlap before any future writer switch; old
    material stays readable until a separately implemented database drain
    proves retirement safe.
  - GCP KMS owns authority private signing material. Cloudflare automation uses
    P-256 ECDH JWKs, with private material confined to secure local transfer,
    GitHub Environment secrets, Worker secrets, and the ignored mode-`0600`
    Wrangler secrets payload on a mode-`0700` ephemeral deploy directory.
  - Provider audits show names/scopes only. No `.env` contents, key values, or
    production row contents may enter logs or durable artifacts.
- Product/process constraints:
  - Use a task worktree and PR. Run focused local proof, exact-head CI, the
    preliminary specialist pass, and the final ReviewGPT loop before merge.
  - Do not weaken crypto, deploy, or runtime invariants to make rollout easier.
  - Stop after standby preload. Do not activate a key, mutate envelopes, or
    retire material without an explicit production mutation owner and proof
    that the current Cloudflare private key remains available throughout the
    compatibility window.

## Risks and mitigations

1. Risk: A writer starts using a key that one reader cannot resolve.
   Mitigation: deploy compatibility code first, preload both generations on
   Web and Worker, and directly prove old/new parsing before changing active
   identifiers.
2. Risk: Existing envelopes become unreadable after an early active switch or
   old-key removal.
   Mitigation: this plan performs neither operation. The runbook requires a
   future bounded migration, retained `verify_only`/`decrypt_only` entries, and
   zero-reference aggregate proof before retirement.
3. Risk: Exportable Cloudflare private material leaks through shell history,
   arguments, files, logs, or review artifacts.
   Mitigation: generate in memory, persist only in an approved secure store,
   stream values over stdin/API bodies, restrict the canonical Wrangler
   secrets payload to its ignored mode-`0600` file on the ephemeral deploy
   worker, remove that exact file after any direct/local deploy, and verify
   provider metadata only.
4. Risk: Web and Worker deploy skew breaks production during preload.
   Mitigation: land the missing deploy contract first, preserve the existing
   required active single-key variables, add only non-active keyring entries,
   and check both live surfaces after each provider update.

## Tasks

1. Revalidate the current source-to-runtime path, provider capabilities,
   credential availability, and aggregate production key state.
2. Add the two missing public Worker deploy-contract names, regression tests,
   and a durable rotation runbook.
3. Run focused proof, commit/push the candidate, open the PR, and complete
   required ReviewGPT and CI gates.
4. Merge and deploy the keyring contract; verify live Web/Worker readiness.
5. Create a new non-exportable GCP authority-signing key version and new P-256
   Cloudflare automation keypair; preload both generations without switching
   active writers.
6. Verify live bindings and unchanged production envelope references, record
   the separately blocked activation phase, and archive the plan/worktree.

## Decisions

- Keep the existing runtime keyring abstractions and private workflow mappings;
  fix the missing public renderer boundary instead of adding another owner.
- Generate and preload keys only after the exact pushed implementation head has
  passed focused proof, CI, and both ReviewGPT gates. Merge the reviewed
  contract to public `main`, deploy from the protected private workflow's
  public-`main` checkout, complete standby preload and live proof, then archive
  this plan in a follow-up docs-only PR.

## Verification

- Commands to run:
  - Focused deploy-automation and hosted-crypto tests selected from the current
    testing map.
  - Public/private exact-head deploy environment contract check.
  - Exact-head GitHub Actions plus preliminary and final ReviewGPT gates.
  - Names/scopes-only Vercel, GitHub Environment, and Wrangler checks.
  - Privacy-safe aggregate SQL for authority/recipient key distribution before
    and after preload.
- Expected outcomes:
  - Generated Worker config and secret payload include configured keyrings and
    omit them cleanly when unset.
  - The current active generation remains readable while the new generation is
    configured only as standby.
  - Final production aggregates are unchanged by preload and all live
    health/smoke checks pass.
