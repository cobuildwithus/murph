#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ "${1:-}" == '--' ]]; then
  shift
fi

if [[ "${1:-}" == '-h' || "${1:-}" == '--help' ]]; then
  echo "Usage: scripts/open-exec-plan.sh <slug> [title]"
  exit 0
fi

if [[ $# -lt 1 ]]; then
  echo "Usage: scripts/open-exec-plan.sh <slug> [title]"
  exit 1
fi

slug="$1"
shift || true
title="${*:-$slug}"

if ! [[ "$slug" =~ ^[a-z0-9-]+$ ]]; then
  echo "Slug must be kebab-case: lowercase letters, numbers, hyphens"
  exit 1
fi

date_stamp="$(date +%Y-%m-%d)"
plan_path="agent-docs/exec-plans/active/${date_stamp}-${slug}.md"

if [[ -e "$plan_path" ]]; then
  echo "Plan already exists: $plan_path"
  exit 1
fi

cat > "$plan_path" <<PLAN
# ${title}

Status: active
Created: ${date_stamp}
Updated: ${date_stamp}

## Goal

- Define the concrete user-visible and engineering outcome.

## Success criteria

- List objective checks required to call this done.

## Scope

- In scope:
- Out of scope:

## Constraints

- Technical constraints:
- Product/process constraints:

## Risks and mitigations

1. Risk:
   Mitigation:

## Tasks

1. Replace with ordered concrete tasks.

## Decisions

- None yet.

## Verification

- Commands to run:
- Expected outcomes:
PLAN

echo "Created $plan_path"
