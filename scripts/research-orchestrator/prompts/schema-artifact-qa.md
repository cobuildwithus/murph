{{SHARED_HEADER}}

TASK: Schema and artifact QA.

Goal:
Check whether the package can land in Health Commons safely.

Review:
- protocol package draft from:
{{PROTOCOL_PACKAGE_DRAFT_SOURCE}}
- artifact manifest draft from: {{ARTIFACT_MANIFEST_SOURCE}}
- Markdown frontmatter shape
- source page metadata
- protocol page required fields
- artifact manifest JSON
- source keys and relation targets
- generated catalog expectations

Output:
1. Schema blockers
2. Missing required protocol fields
3. Missing required source fields
4. Bad source keys or slugs
5. Duplicate source keys
6. Artifact rights blockers
7. Manifest entries that should be non-redistributable
8. Commands to run after landing
9. Exact patch-level corrections

Rules:
- Journal PDFs stay outside Git.
- Default uncertain artifacts to permission_required or unknown plus redistributable=false.
- Do not mark redistributable=true unless rights are clear.
