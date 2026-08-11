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
  const [auth, startContactOptions, continueContactOptions] = await Promise.all([
    getHostedDashboardPageAuthSnapshot(),
    resolveTrainingContactOptions("Start a workout with me."),
    resolveTrainingContactOptions("Continue my active workout."),
  ]);

  return (
    <TrainingPageClient
      authenticated={auth.authenticated}
      continueContactOptions={continueContactOptions}
      startContactOptions={startContactOptions}
    />
  );
}

async function resolveTrainingContactOptions(body: string) {
  try {
    return await resolveHostedMurphContactOptions({
      message: { body },
      preferredKind: "text",
    });
  } catch {
    return [];
  }
}
