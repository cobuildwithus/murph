import { listHealthCommonsExperimentProtocols } from "@/src/lib/health-commons/experiment-detail";
import { ExperimentsPageClient } from "./experiments-page-client";

export default function ExperimentsPage() {
  const protocols = listHealthCommonsExperimentProtocols();

  return <ExperimentsPageClient protocols={protocols} />;
}
