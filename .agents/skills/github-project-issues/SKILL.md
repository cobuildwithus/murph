---
name: github-project-issues
description: Use when managing GitHub repo issues and organization projects with GitHub CLI. Create or update repo issues, assign collaborators, add issues to projects, convert project draft cards into real issues before assigning, and set project fields such as status or priority.
---

# GitHub Project Issues

Use GitHub issues as the source of truth for work items. Use projects as the board for status, priority, and grouping.

Default workflow:

1. Confirm `gh auth status`.
2. Confirm the repo, project, and whether the target assignee is assignable.
3. If the project already has a matching draft item, convert it into a repo issue instead of creating a duplicate.
4. Assign the issue, apply labels, then place or keep it on the project.
5. Update project fields such as `Status`, `Priority`, or `Size` when the board uses them.

Rules:

- Prefer `issue + project card` over project-only draft items when the work needs an assignee, discussion, PR linkage, or a durable URL.
- Do not create a second issue if the matching work already exists as a project draft item.
- Before assigning, verify assignability with `gh api repos/<owner>/<repo>/assignees/<login>`.
- If project commands fail on scopes, refresh auth with `gh auth refresh -h github.com -s repo,read:org,read:project,project`.
- Keep issue titles action-oriented and issue bodies scoped, with acceptance criteria when the task is more than a one-liner.
- Summarize the final issue URL, assignee, and project status instead of dumping raw CLI output.

Useful commands:

- `gh repo view <owner>/<repo> --json hasIssuesEnabled,viewerPermission,url`
- `gh project view <number> --owner <org> --format json`
- `gh project field-list <number> --owner <org> --format json`
- `gh issue create --repo <owner>/<repo> --title "<title>" --body-file <file>`
- `gh issue edit <number> --repo <owner>/<repo> --add-assignee <login> --add-label <label>`
- `gh project item-add <number> --owner <org> --url <issue-url>`
- `gh project item-edit --id <item-id> --project-id <project-id> --field-id <field-id> --single-select-option-id <option-id>`

Converting a draft card to an issue:

Use the GraphQL mutation below, then assign and edit the resulting issue instead of creating a duplicate:

`gh api graphql -f query='mutation($itemId: ID!, $repositoryId: ID!) { convertProjectV2DraftIssueItemToIssue(input: { itemId: $itemId, repositoryId: $repositoryId }) { item { id content { ... on Issue { number url } } } } }' -F itemId='<project-item-id>' -F repositoryId='<repo-id>'`

Decision heuristic:

- Use `issues only` when the user wants a quick standalone task.
- Use `issues + project` when work is being assigned, prioritized, or tracked across states.
- Use `project draft items` only for rough intake before a real owner is known.

If a local todo list may already be represented on the project board, inspect `gh project item-list <number> --owner <org> --format json` first and convert the matching draft item rather than recreating it.
