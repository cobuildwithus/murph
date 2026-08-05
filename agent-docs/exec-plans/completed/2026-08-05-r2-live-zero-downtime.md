# R2 live zero-downtime cutover

Status: completed
Created: 2026-08-05
Updated: 2026-08-05

## Goal

- Move hosted workspace object authority from OC to ENAM without pausing Murph
  replies, workspace checkpoints, or new direct uploads.
- Keep the already-deployed two-bucket bridge as the only runtime migration
  owner and change the cutover proof from frozen bucket equality to bounded
  live convergence after all source writers drain.

## Success criteria

- Source-active warm copying runs while write admission stays open.
- Promotion runs as `destination_active+open`; new runtime writes and direct
  uploads go to ENAM while definitive ENAM misses still read from OC.
- Old source-active Durable Objects and bucket-affine OC upload capabilities may
  finish without making accepted messages wait.
- After every runner converges and the OC upload window expires, the approved
  immutable OC manifest is a byte-size-matching subset of ENAM and remains
  unchanged across two clean reads.
- Account deletion stays maintenance-fenced until late-source convergence and
  its existing dual-bucket deletion canary pass.
- Focused tests, typecheck, exact-head CI, preliminary coverage review, and final
  ReviewGPT all pass with no unresolved accepted findings.

## Scope

- In scope: the temporary R2 cutover bridge, deploy preflight, direct-upload
  bucket affinity, current migration runbook, owner docs, and focused Cloudflare
  regression proof.
- In scope: the production warm copy and live phase promotion after the reviewed
  change lands and bucket-scoped migration credentials are available.
- Out of scope: OC retirement, whole-bucket copying, dual writes, a new copy
  service or journal, mutable or lifecycle-managed object migration, and
  account-deletion redesign.

## Constraints

- Technical constraints: Cloudflare Worker and Durable Object updates can be
  version-skewed; object keys admitted to the managed manifest are immutable;
  source-active direct uploads are bucket-affine; deletion remains source-first
  and dual-bucket; list consumers must not make a source-only late object
  unreachable after promotion.
- Product/process constraints: no accepted message may be dropped or delayed by
  a planned global migration pause; do not expose object keys, member ids,
  credentials, private rows, or local paths in repository or external artifacts.

## Risks and mitigations

1. Risk: a warm Durable Object or already-issued upload capability writes to OC
   after ENAM promotion.
   Mitigation: retain destination-to-source direct read fallback, prove upload
   bucket affinity, wait for every runner and the bounded URL window to drain,
   then copy only approved source-only immutable objects.
2. Risk: a source-only object is discoverable only through bucket listing.
   Mitigation: inventory every production list consumer and either prove it is
   cleanup-only/key-independent or route it through the concrete bucket owner
   needed during coexistence; add focused skew tests.
3. Risk: a failed ENAM promotion cannot safely return to OC after ENAM accepts
   new writes.
   Mitigation: validate ENAM directly before promotion, keep OC fallback and
   account deletion maintenance in place, use forward repair after promotion,
   and retain the bridge through the bounded fallback-observation soak.
4. Risk: live writes make exact source/destination equality impossible.
   Mitigation: require source-to-destination approved-manifest inclusion and
   stable source quiescence after the source-writer drain; classify legitimate
   ENAM-only post-promotion objects instead of treating them as corruption.

## Tasks

1. Trace every wrapped R2 read, write, list, delete, direct-upload, and restore
   path and record the exact live-convergence invariant.
2. Implement the smallest bridge/preflight changes needed for an open-admission
   promotion and update the live runbook and owner docs.
3. Add focused tests for mixed source/destination versions, late OC upload
   completion, ENAM-first fallback reads, list behavior, dual deletion, and live
   convergence failure.
4. Run focused tests, Cloudflare typecheck, direct cutover simulation, privacy
   readback, and diff review.
5. Commit and push the candidate, open a PR, start preliminary coverage and final
   ReviewGPT concurrently with CI, resolve findings, close this plan, and merge.
6. With bucket-scoped credentials available, run the warm copy, live promotion,
   source-writer drain, final tail copy, two clean convergence reads, canaries,
   and account-deletion restoration without pausing write admission.

## Decisions

- Reuse the deployed two-bucket bridge and Cloudflare-managed Super Slurper;
  do not add dual writes or application-owned copy state.
- Treat zero downtime as no planned interruption to messaging, checkpoints, or
  uploads. Account deletion remains explicitly maintenance-fenced for ownership
  stability until convergence.
- Do not reuse the closed custom-copier branch or its retired PR.

## Verification

- Commands to run: focused Vitest files selected after the call-path inventory;
  `pnpm --filter @murphai/cloudflare typecheck`; deploy-preflight tests; a
  production-shaped mixed-version cutover scenario; exact-head GitHub Actions;
  preliminary `completion-specialists`; final ReviewGPT.
- Expected outcomes: new writes never return to OC after converged promotion;
  late old-version writes remain readable and are tail-copied; no approved
  source key is absent or byte-size-mismatched in ENAM; no global write pause is
  required; every required review and CI gate is green.
Completed: 2026-08-05
