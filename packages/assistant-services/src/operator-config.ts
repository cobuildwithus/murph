import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  assistantSelfDeliveryTargetSchema,
  type AssistantSelfDeliveryTarget,
} from "murph";
import {
  readOperatorConfig,
  resolveOperatorConfigPath,
  resolveOperatorHomeDirectory,
  type AssistantOperatorDefaults,
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
  await writeFile(
    configPath,
    `${JSON.stringify(nextConfig, null, 2)}\n`,
    "utf8",
  );

  return normalizedTarget;
}

function buildOperatorConfig(input: {
  existing: OperatorConfig | null;
  selfDeliveryTargets: Record<string, AssistantSelfDeliveryTarget> | null;
}): OperatorConfig {
  return {
    schema: "murph.operator-config.v1",
    defaultVault: input.existing?.defaultVault ?? null,
    assistant: {
      ...normalizeAssistantOperatorDefaults(input.existing?.assistant ?? null),
      selfDeliveryTargets: input.selfDeliveryTargets,
    },
    updatedAt: new Date().toISOString(),
  };
}

function normalizeAssistantOperatorDefaults(
  defaults: AssistantOperatorDefaults | null,
): AssistantOperatorDefaults {
  return {
    provider: defaults?.provider ?? null,
    defaultsByProvider: defaults?.defaultsByProvider ?? null,
    identityId: defaults?.identityId ?? null,
    failoverRoutes: defaults?.failoverRoutes ?? null,
    account: defaults?.account ?? null,
    selfDeliveryTargets: normalizeAssistantSelfDeliveryTargetMap(
      defaults?.selfDeliveryTargets ?? null,
    ),
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
