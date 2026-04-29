{{SHARED_HEADER}}

TASK: Safety QA blocker review.

Goal:
Block unsafe or under-specified protocol guidance.

Review:
- protocol package draft from:
{{PROTOCOL_PACKAGE_DRAFT_SOURCE}}
- protocol steps
- stop conditions
- safety block
- adverse-event source findings and safety evidence appraisals from: {{SAFETY_FINDINGS_SOURCE}}
- contraindication sources
- population boundaries
- user-facing wording

Output:
1. Missing avoid or ask-clinician groups
2. Missing stop conditions
3. Instructions that could encourage unsafe behavior
4. Populations that require separate clinical variants
5. Confounders that must be logged
6. Exact text edits
7. Safety claims needing citations

Rules:
- Safety boundaries should not depend only on efficacy studies.
- Case reports, guidelines, and clinical reviews can support safety boundaries.
- Keep clinician-guided variants separate from ordinary wellness experiments.
- Replacement safety wording must not include raw `source_artifact:*` keys, `sourceKeys`, or `Source keys:` labels in user-facing prose. Keep citation keys in structured fields only.
- Do not reintroduce source-local `protocolEvidence`.
