# Preload hosted crypto standby keys

Status: completed
Created: 2026-08-07
Updated: 2026-08-09

## Outcome

- The reviewed keyring contract merged to public `main` after exact-head CI,
  the completion-specialist pass, and final ReviewGPT round 8 passed.
- One new non-exportable authority-signing version and one new P-256
  Cloudflare automation recipient generation were created with approved
  platform or operating-system randomness.
- Vercel Production was deployed first with the non-active authority and public
  recipient keyrings. Signed live crypto-context reads succeeded against the
  current production envelopes before the Worker changed.
- The protected production deploy then synchronized the non-active authority
  and private recipient keyrings to Cloudflare. All hosted-local gates,
  deploy preflight, bundle validation, Worker deployment, managed-container
  smoke, direct-R2 proof, and the live model turn passed.
- Privacy-safe aggregate checks before and after both deploys showed one active
  authority generation, one active Cloudflare recipient generation, complete
  active recipient-wrap coverage, no non-active envelope history, no references
  to either proposed generation, and no active reference drift.
- Live metadata inspection confirmed that the existing active bindings remain
  present, both standby bindings are present on Web and Worker, Worker traffic
  is fully on the deployed version, and the authority standby version remains
  enabled in KMS without being selected as active.
- Activation, envelope migration, key retirement, and removal of the current
  active material remain intentionally blocked on a separate reviewed
  production mutation owner.

## Goal

- Make hosted domain-root cryptography ready for a later safe rotation without
  interrupting existing Web or Worker reads, then securely generate and
  preload one standby authority-signing version and one standby Cloudflare
  automation recipient keypair without changing either active key.

## Success criteria

- The public Cloudflare deploy renderer forwards the optional authority verify
  keyring and Cloudflare automation private keyring through the existing
  private workflow mappings, with focused regression coverage.
- Web build and Worker deploy preflight share one standby-keyring acceptance
  contract; complete preload validates all three payloads and matches the
  Cloudflare public/private pair before any provider mutation.
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
   record the current ready Web deployment, deploy Web first, prove its active
   crypto-context path before Worker mutation, and check both live surfaces
   after each provider update.
5. Risk: validating only the Worker plane allows malformed Web standby
   configuration to pass deployment and later poison Web crypto-context refresh.
   Mitigation: the repeated-mechanism ReviewGPT finding keeps the end-to-end
   preload scope and moves the existing pure standby acceptance contract into
   shared runtime-state ownership. The Web build and Worker preflight both use
   it, while complete-preload mode requires all payloads and a matching P-256
   public/private pair before provider mutation. Focused tests cover the Web
   crypto-context owner and Worker unwrap owner; rollback remains the recorded
   ready Web deployment with all active single-key variables unchanged.
6. Risk: isolated JSON validation reports completion for a proposed entry whose
   ID is overwritten by the required active overlay or whose status cannot
   verify/decrypt a future standby envelope.
   Mitigation: final ReviewGPT round 3 identified this review-induced gap. Keep
   the same shared pure owner, pass the existing active IDs into both provider
   gates, and reject optional collisions. Complete mode additionally takes two
   explicit non-secret proposed IDs, requires their exact `verify_only` /
   `disabled` / `decrypt_only` states, constructs the effective runtime rings,
   and proves a synthetic envelope with the proposed signer and recipient.
7. Risk: lossy parsing drops sibling private material from the validated Web
   projection, or first-match validation approves one raw entry while a later
   whitespace-equivalent ID replaces it in the effective runtime map.
   Mitigation: final ReviewGPT round 4 identified both as review-induced. Keep
   validation in the same shared owner, close the Web public entry/JWK schemas,
   reject duplicate normalized identifiers in every ring, and resolve proposed
   entries only from the resulting unique maps. Field-only errors and the
   effective-ring proposed-generation proof remain unchanged.
8. Risk: duplicate raw JSON member names are collapsed before closed-schema
   validation, leaving an earlier private-bearing member in provider-bound text
   while the parsed projection appears public-only.
   Mitigation: final ReviewGPT round 5 identified this continuation of the same
   review-induced mechanism. Scan all three raw ring strings for duplicate JSON
   object members before the first ordinary parse, retain field-only errors, and
   cover top-level and nested duplicate private canaries in normal and complete
   Web validation.
9. Risk: structurally valid exact payloads contain a malformed authority PEM,
   invalid public point, or corrupt/mismatched private scalar, while complete
   preload reports success because it compares only public coordinates.
   Mitigation: final ReviewGPT round 6 identified this as review-induced. Keep
   normal provider gates synchronous and structural, but make the one-shot
   complete command import the exact authority PEM and wrap then unwrap an
   ephemeral challenge through the exact proposed Cloudflare JWKs. Mask every
   failure with the existing field-only errors and retain the same stateless
   runtime-state owner.

## Tasks

1. [x] Revalidate the current source-to-runtime path, provider capabilities,
   credential availability, and aggregate production key state.
2. [x] Add the two missing public Worker deploy-contract names, regression tests,
   and a durable rotation runbook.
3. [x] Run focused proof, commit/push the candidate, open the PR, and complete
   required ReviewGPT and CI gates.
4. [x] Add the shared Web/Worker standby validation found in final ReviewGPT round
   2, then complete the final ReviewGPT and CI gates on the remediated head.
5. [x] Merge and deploy the keyring contract; verify live Web/Worker readiness.
6. [x] Create a new non-exportable GCP authority-signing key version and new P-256
   Cloudflare automation keypair; preload both generations without switching
   active writers.
7. [x] Verify live bindings and unchanged production envelope references, record
   the separately blocked activation phase, and archive the plan. Guarded
   worktree retirement was attempted and remains fail-closed because an
   ownership-ambiguous orphan process still holds its working directory there;
   no process was signaled.

## Decisions

- Keep the existing runtime keyring abstractions and private workflow mappings;
  fix the missing public renderer boundary instead of adding another owner.
- Keep the end-to-end preload rather than narrowing it to Worker configuration.
  The round-2 retrospective identified one shared lower contract, a Web build
  gate, a Worker deploy gate, and complete-pair acceptance as the smallest
  correction for the repeated validation-boundary mechanism.
- Continue that same decision after the round-3 review-induced finding: prove
  the proposed generation survives the existing active overlay and is usable,
  without adding a deployment owner, persisted state, or rotation lifecycle.
- Continue it after round 4 as well: exact raw-payload validation and unique
  normalized IDs tighten the existing boundary without creating another owner
  or compatibility mechanism.
- Continue it after round 5: duplicate-aware scanning completes that same raw
  acceptance boundary without substring matching, a dependency, or a new
  lifecycle owner.
- Continue it after round 6: the asynchronous exact-material challenge belongs
  only to the one-shot complete command, reuses production crypto primitives,
  and adds no provider state or lifecycle owner.
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
Completed: 2026-08-09
