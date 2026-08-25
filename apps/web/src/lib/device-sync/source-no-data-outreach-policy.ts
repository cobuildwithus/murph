import "server-only";

import {
  readPushPrimarySourceRecoveryNoticePolicy,
} from "@murphai/device-syncd/source-staleness";

type NoDataOutreachPreferenceStore = {
  deviceSourceNoDataOutreachPreference: {
    findUnique(input: {
      select: { reminderAfterDays: true };
      where: {
        userId_sourceProviderSlug: {
          sourceProviderSlug: string;
          userId: string;
        };
      };
    }): Promise<{ reminderAfterDays: number | null } | null>;
  };
};

export type HostedSourceNoDataOutreachPolicy =
  | { enabled: false; setting: "off" }
  | {
      afterDays: number;
      enabled: true;
      setting: "custom" | "default";
      silentHours: number;
    };

export async function readHostedSourceNoDataOutreachPolicy(input: {
  memberId: string;
  prisma: NoDataOutreachPreferenceStore;
  sourceProviderSlug: string;
}): Promise<HostedSourceNoDataOutreachPolicy | null> {
  const sourceProviderSlug = input.sourceProviderSlug.trim().toLowerCase();
  const providerPolicy = readPushPrimarySourceRecoveryNoticePolicy(sourceProviderSlug);
  if (!providerPolicy) {
    return null;
  }
  const preference = await input.prisma.deviceSourceNoDataOutreachPreference.findUnique({
    select: { reminderAfterDays: true },
    where: {
      userId_sourceProviderSlug: {
        sourceProviderSlug,
        userId: input.memberId,
      },
    },
  });
  if (!preference) {
    const afterDays = providerPolicy.silentHours / 24;
    return {
      afterDays,
      enabled: true,
      setting: "default",
      silentHours: providerPolicy.silentHours,
    };
  }
  if (preference.reminderAfterDays === null) {
    return { enabled: false, setting: "off" };
  }
  return {
    afterDays: preference.reminderAfterDays,
    enabled: true,
    setting: "custom",
    silentHours: preference.reminderAfterDays * 24,
  };
}
