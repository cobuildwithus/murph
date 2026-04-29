#!/usr/bin/env bash
set -euo pipefail

export MURPH_REVIEW_GPT_INCLUDE_HEALTH_COMMONS=1
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/package-review-gpt-context.sh" "$@"
