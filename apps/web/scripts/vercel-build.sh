#!/bin/sh
set -eu

if [ "${MURPH_PREVIEW_LINQ_UI_ONLY:-}" = "1" ]; then
  node <<'NODE'
const forbidden = [
  "LINQ_API_TOKEN", "LINQ_WEBHOOK_SECRET",
  "HOSTED_TEMPORAL_ADDRESS", "TEMPORAL_ADDRESS",
  "HOSTED_TEMPORAL_API_KEY", "TEMPORAL_API_KEY",
];
const isolatedPreview = process.env.VERCEL_ENV === "preview"
  && process.env.VERCEL_GIT_COMMIT_REF === "feat/better-auth-adoption"
  && process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL
    === "https://murph-git-feat-better-auth-adoption-cobuildwithus.vercel.app";
if (!isolatedPreview || forbidden.some((key) => process.env[key]?.trim())) {
  throw new Error("Preview line setup requires the isolated UI-only environment with messaging and runtime signaling disabled.");
}
NODE
fi

pnpm release:production:migrate
MURPH_HOSTED_WEB_PRISMA_GENERATED_BY_MIGRATIONS=1 pnpm build

if [ "${MURPH_PREVIEW_LINQ_UI_ONLY:-}" = "1" ]; then
  pnpm linq:sync-lines -- --skip-provider-inventory
fi
