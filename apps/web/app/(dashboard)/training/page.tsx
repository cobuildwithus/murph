import type { Metadata } from "next";

import { resolveHostedMurphContactOptions } from "@/src/components/murph/hosted-murph-contact-action";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import TrainingPageClient from "./training-page-client";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Training — Murph",
  description:
    "Log workouts by messaging Murph, then review your sets, consistency and exercise progress over time.",
});

export default async function TrainingPage() {
  const [auth, contactOptions] = await Promise.all([
    getHostedDashboardPageAuthSnapshot(),
    resolveTrainingContactOptions(),
  ]);

  return (
    <TrainingPageClient
      authenticated={auth.authenticated}
      contactOptions={contactOptions}
    />
  );
}

async function resolveTrainingContactOptions() {
  try {
    return await resolveHostedMurphContactOptions({
      message: {
        body: "Start a workout with me.",
      },
      preferredKind: "text",
    });
  } catch {
    return [];
  }
}
