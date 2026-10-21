# Recover structured facts from retained clinical source records

Status: completed
Created: 2026-09-29
Updated: 2026-09-29

## Outcome and scope

Improve the runtime importer, with the deterministic coverage changes in PR
#3765 as the base. Add bounded model extraction for eligible structured FHIR
records retained as source notes. Original evidence stays intact. Local private
exports are diagnostic examples only and are not a deliverable or fixture.

## Proven gap and owners

Retrieval currently enqueues enrichment only for downloaded attachments.
Unmapped observations and source history notes never enter that path. Extend
that same portable job, cursor, frozen proposals, canonical apply and mailbox
wake. The importer selects source-note candidates after deterministic mapping;
the vault owner attests manifest/page/patient, exact resource and live parent.
No new queue, service, provider credential, database or canonical state owner.

## Design and invariants

One bounded resource at a time, one combined-family read-only Luna extraction
turn. Missing date provenance is held without another model call. Successful
structured mappings do not call the model. Cache and source identity include
the exact resource, not merely its containing page. Replay applies frozen
proposals. Raw source notes remain; structured derived facts carry parent
revision and evidence. Canonical parent withdrawals and corrections retire
facts through existing ownership. No guessed dates/units, model writes,
automatic historical tombstone revival or permission/status bypass.

## Product UX

Outcome: more queryable clinical facts after an ordinary authorized import.
Reaches: supported deterministic records, retained source notes, ambiguous
records, provider failure/restart and corrected/withdrawn records.
Proof: synthetic retrieval through enqueue, read-only extraction, frozen apply
and canonical readback; exact call count and no resampling on restart.
Model output remains uncertain; unsupported facts remain held and do not
establish complete chart coverage. No presentation changes are planned.

## Verification and delivery

Focused importer, contracts, vault usecases, runtime and extraction tests;
relevant typechecks; focused synthetic Luna proof via local subscription only.
Review full diff, complexity, docs and privacy; open a separate stacked PR.
Start required ReviewGPT with exact-head CI. Existing PR work stays untouched.
Do not merge or deploy under this task without the applicable authority.

## Progress

- Isolated branch starts from PR #3765 candidate 372fe35074.
- Existing attachment-only admission and source-note gap confirmed.

- Implemented single-resource selection, v2 enrichment cursors, one combined
  Luna turn, frozen canonical application and parent facet invalidation.
- Source text excludes routing identifiers and revision metadata; shell tools
  are disabled. Existing source notes are never duplicated as summary notes.
- Focused proof passes: importer 129, core facets 11, clinical schema 8,
  vault usecases 72, extraction/ask 40, composed runtime 85 and workspace
  checkpoint 2 tests. Six affected package typechecks and scenario manifest
  coverage pass. Complexity has no increased debt; existing import/sync hotspots
  are unchanged, and the shared read-only runner's debt decreases.
- Synthetic GPT-5.6 Luna medium journey passed through local subscription:
  one provider request, supported vital recovered, missing unit held, education
  and neighboring evidence excluded, no writes. 8,329 input and 431 output tokens
  (including 245 reasoning) imply about $1.09 per 500 similar API calls at
  $0.20/M input and $1.20/M output, before retries/infrastructure.
- Product UX replay: Ready for the covered import/recovery paths. Complete chart
  coverage and automatic repair of previously completed imports remain excluded.
- PR #3810 and member-facing changelog are published on the existing stacked base.
- Final ReviewGPT round 1 passed on ccfe5ca69b6f085e077205c2b87a7b8df9060e06:
  zero findings received, accepted or rejected; no remediation or retrospective.
  The managed Hercules lane requested GPT-6 Pro and captured the exact-turn
  completed response after approximately eleven minutes. The substantive review
  traced the full patch, source attestation, frozen replay, canonical writes,
  correction/withdrawal and legacy attachment compatibility. Capture metadata
  binds the accepted user turn and response; local artifacts remain untracked.
- Parent final review confirmed the changed production owners and synthetic
  regression proof. Runtime behavior is unchanged by the final documentation
  closeout, so the existing review remains applicable under the docs exemption.
- Broad CI passed on the reviewed implementation head. The final plan-closeout
  commit still requires its own CI; the PR is the live owner of that gate.
- Deployment concerns: new v2 jobs require upgraded exclusive runtime owners;
  retain a v2-capable reader for rollback. No deployment or merge was performed.
Completed: 2026-09-29
