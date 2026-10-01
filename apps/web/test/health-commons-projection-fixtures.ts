import type { ExperimentProtocol } from "@/src/types/experiments";
import { listHealthCommonsExperimentBrowseProtocols } from "@/src/lib/health-commons/experiment-browse";
import {
  resolveHealthCommonsExperimentProtocolTab,
  resolveHealthCommonsExperimentResearchTab,
  resolveHealthCommonsExperimentResultsPublic,
  resolveHealthCommonsExperimentShell,
} from "@/src/lib/health-commons/experiment-projections";

export function resolveExperimentProjectionFixture(routeId: string): ExperimentProtocol | null {
  const shell = resolveHealthCommonsExperimentShell(routeId);
  const protocol = resolveHealthCommonsExperimentProtocolTab(routeId);
  const research = resolveHealthCommonsExperimentResearchTab(routeId);
  const results = resolveHealthCommonsExperimentResultsPublic(routeId);
  const browse = listHealthCommonsExperimentBrowseProtocols().find((entry) => entry.id === shell?.id);
  if (!shell || !protocol || !research || !results || !browse) return null;
  return {
    ...browse,
    ...shell,
    ...protocol,
    ...research,
    researchLandscape: research.researchLandscape
      ? { ...research.researchLandscape, groups: research.researchGroups ?? [] }
      : undefined,
    commons: results.commons,
    protocolLogFields: [],
  };
}
