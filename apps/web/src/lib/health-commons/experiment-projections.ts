import type {
  HealthCommonsWebExperimentProtocolTab,
  HealthCommonsWebExperimentResultsPublic,
  HealthCommonsWebExperimentShell,
} from "@murphai/health-commons/runtime";

import {
  CURRENT_EXPERIMENT_PROTOCOL_CONTRACT_VERSION,
} from "@/src/lib/experiments/experiment-detail";
import type {
  ExperimentCommonsReference,
  ExperimentProtocolStep,
} from "@/src/types/experiments";
import { resolveExperimentRouteImage } from "./experiment-images";
import {
  loadGeneratedExperimentProtocolTab,
  loadGeneratedExperimentResultsPublic,
  loadGeneratedExperimentShell,
} from "./generated-experiment-artifacts";

export interface ExperimentShellProjection {
  protocolContractVersion: number;
  baselineDays: number;
  category: string;
  description: string;
  durationDays: number;
  evidenceLabel: string;
  evidenceLevel: number;
  id: string;
  image: string;
  key: string;
  revision: HealthCommonsWebExperimentShell["revision"];
  title: string;
}

export interface ExperimentResultsPublicProjection {
  protocolContractVersion: number;
  baselineDays: number;
  commons: ExperimentCommonsReference;
  durationDays: number;
  id: string;
  key: string;
  protocol: ExperimentProtocolStep[];
  revision: HealthCommonsWebExperimentResultsPublic["revision"];
  title: string;
}

export type ExperimentProtocolTabProjection =
  HealthCommonsWebExperimentProtocolTab & {
    protocolContractVersion: number;
  };

export function resolveHealthCommonsExperimentShell(
  experimentId: string,
): ExperimentShellProjection | null {
  const shell = loadGeneratedExperimentShell(experimentId);

  return shell ? toExperimentShellProjection(shell) : null;
}

export function resolveHealthCommonsExperimentProtocolTab(
  experimentId: string,
): ExperimentProtocolTabProjection | null {
  const protocolTab = loadGeneratedExperimentProtocolTab(experimentId);

  return protocolTab
    ? {
        ...protocolTab,
        protocolContractVersion: CURRENT_EXPERIMENT_PROTOCOL_CONTRACT_VERSION,
      }
    : null;
}

export function resolveHealthCommonsExperimentResultsPublic(
  experimentId: string,
): ExperimentResultsPublicProjection | null {
  const resultsPublic = loadGeneratedExperimentResultsPublic(experimentId);

  return resultsPublic ? toExperimentResultsPublicProjection(resultsPublic) : null;
}

function toExperimentShellProjection(
  shell: HealthCommonsWebExperimentShell,
): ExperimentShellProjection {
  return {
    protocolContractVersion: CURRENT_EXPERIMENT_PROTOCOL_CONTRACT_VERSION,
    baselineDays: shell.baselineDays,
    category: shell.category,
    description: shell.description,
    durationDays: shell.durationDays,
    evidenceLabel: shell.evidenceLabel,
    evidenceLevel: shell.evidenceLevel,
    id: shell.id,
    image: resolveExperimentRouteImage(shell.id, shell.image),
    key: shell.key,
    revision: shell.revision,
    title: shell.title,
  };
}

function toExperimentResultsPublicProjection(
  resultsPublic: HealthCommonsWebExperimentResultsPublic,
): ExperimentResultsPublicProjection {
  return {
    protocolContractVersion: CURRENT_EXPERIMENT_PROTOCOL_CONTRACT_VERSION,
    baselineDays: resultsPublic.baselineDays,
    commons: resultsPublic.commons,
    durationDays: resultsPublic.durationDays,
    id: resultsPublic.id,
    key: resultsPublic.key,
    protocol: resultsPublic.protocol,
    revision: resultsPublic.revision,
    title: resultsPublic.title,
  };
}
