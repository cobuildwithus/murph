# Source from a contract migration step. A superseded event ends that step
# before it can publish its success output or invoke SQL.
set -euo pipefail

require_current_main() {
  local main_sha
  # Block the production step's credentials from Git and its subprocesses.
  local DIRECT_DATABASE_URL= MURPH_REQUIRE_DIRECT_DATABASE_URL_FOR_MIGRATIONS= MURPH_RUN_HOSTED_WEB_CONTRACT_MIGRATIONS= HOSTED_WEB_VERCEL_TOKEN=
  git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main
  main_sha="$(git rev-parse --verify refs/remotes/origin/main)"
  if [[ ! "$DEPLOYED_SHA" =~ ^[0-9a-f]{40}$ ]]; then
    echo "::error::Expected a full deployment commit SHA."
    exit 1
  fi
  if [[ "$DEPLOYED_SHA" != "$main_sha" ]]; then
    if git merge-base --is-ancestor "$DEPLOYED_SHA" "$main_sha"; then
      echo "::notice::A newer main commit superseded this deployment. Skipping contract migrations."
      exit 0
    fi
    echo "::error::The deployment commit is outside current main history."
    exit 1
  fi
}

verify_vercel_deployment() (
  # Vercel verification runs without database authority.
  unset DIRECT_DATABASE_URL MURPH_REQUIRE_DIRECT_DATABASE_URL_FOR_MIGRATIONS MURPH_RUN_HOSTED_WEB_CONTRACT_MIGRATIONS
  local sha
  sha="$(pnpm --dir apps/web exec tsx scripts/resolve-vercel-production-alias-sha.ts)" || return "$?"
  if [[ "$sha" != "$DEPLOYED_SHA" ]]; then
    echo "The production base domain serves another commit." >&2
    return 1
  fi
  sha="$(pnpm --dir apps/web exec tsx scripts/verify-vercel-production-deployment.ts)" || return "$?"
  if [[ "$sha" != "$DEPLOYED_SHA" ]]; then
    echo "Exact Vercel deployment verification returned another commit." >&2
    return 1
  fi
)

require_current_main
if [[ "${1:-}" == "--verify-vercel" ]]; then
  proof_status=0
  verify_vercel_deployment || proof_status=$?
  # An alias can change while we query Vercel. Only a proven newer main
  # supersedes that result. Lookup failures and divergent history stay red.
  require_current_main
  if ((proof_status != 0)); then
    echo "::error::Could not prove the exact current Vercel production deployment."
    exit "$proof_status"
  fi
fi
