import { mkdir } from "node:fs/promises";
import path from "node:path";

import {
  assistantSelfDeliveryTargetSchema,
  type AssistantSelfDeliveryTarget,
} from "murph";
import {
  writeJsonFileAtomic,
} from "@murph/runtime-state";
import {
  readOperatorConfig,
  resolveOperatorConfigPath,
  resolveOperatorHomeDirectory,
  type OperatorConfig,
} from "murph/operator-config";

export type { AssistantSelfDeliveryTarget };

export async function resolveAssistantSelfDeliveryTarget(
  channel: string,
  homeDirectory = resolveOperatorHomeDirectory(),
): Promise<AssistantSelfDeliveryTarget | null> {
  const normalizedChannel = normalizeOperatorConfigString(channel)?.toLowerCase();
  if (!normalizedChannel) {
    return null;
  }

  const config = await readOperatorConfig(homeDirectory);
  const normalizedTargets = normalizeAssistantSelfDeliveryTargetMap(
    config?.assistant?.selfDeliveryTargets ?? null,
  );

  return normalizedTargets?.[normalizedChannel] ?? null;
}

export async function saveAssistantSelfDeliveryTarget(
  target: AssistantSelfDeliveryTarget,
  homeDirectory = resolveOperatorHomeDirectory(),
): Promise<AssistantSelfDeliveryTarget> {
  const normalizedTarget = normalizeAssistantSelfDeliveryTarget(target);
  const existing = await readOperatorConfig(homeDirectory);
  const nextTargets = normalizeAssistantSelfDeliveryTargetMap({
    ...(existing?.assistant?.selfDeliveryTargets ?? {}),
    [normalizedTarget.channel]: normalizedTarget,
  });
  const nextConfig = buildOperatorConfig({
    existing,
    selfDeliveryTargets: nextTargets,
  });
  const configPath = resolveOperatorConfigPath(homeDirectory);

  await mkdir(path.dirname(configPath), { recursive: true });
  await writeJsonFileAtomic(
    configPath,
    nextConfig,
  );

  return normalizedTarget;
}

function buildOperatorConfig(input: {
  existing: OperatorConfig | null;
  selfDeliveryTargets: Record<string, AssistantSelfDeliveryTarget> | null;
}): OperatorConfig {
  const existingAssistant = input.existing?.assistant;

  return {
    schema: "murph.operator-config.v1",
    defaultVault: input.existing?.defaultVault ?? null,
    assistant: existingAssistant
      ? {
          ...existingAssistant,
          selfDeliveryTargets: input.selfDeliveryTargets,
        }
      : {
          provider: null,
          defaultsByProvider: null,
          identityId: null,
          failoverRoutes: null,
          account: null,
          selfDeliveryTargets: input.selfDeliveryTargets,
        },
    updatedAt: new Date().toISOString(),
  };
}

function normalizeAssistantSelfDeliveryTargetMap(
  targets: Record<string, AssistantSelfDeliveryTarget> | null,
): Record<string, AssistantSelfDeliveryTarget> | null {
  if (!targets || Object.keys(targets).length === 0) {
    return null;
  }

  return Object.fromEntries(
    Object.values(targets).map((target) => {
      const normalized = normalizeAssistantSelfDeliveryTarget(target);
      return [normalized.channel, normalized];
    }),
  );
}

function normalizeAssistantSelfDeliveryTarget(
  target: AssistantSelfDeliveryTarget,
): AssistantSelfDeliveryTarget {
  const channel = normalizeOperatorConfigString(target.channel)?.toLowerCase();
  if (!channel) {
    throw new Error("Assistant self delivery targets require a channel.");
  }

  return assistantSelfDeliveryTargetSchema.parse({
    channel,
    identityId: normalizeOperatorConfigString(target.identityId),
    participantId: normalizeOperatorConfigString(target.participantId),
    sourceThreadId: normalizeOperatorConfigString(target.sourceThreadId),
    deliveryTarget: normalizeOperatorConfigString(target.deliveryTarget),
  });
}

function normalizeOperatorConfigString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}
