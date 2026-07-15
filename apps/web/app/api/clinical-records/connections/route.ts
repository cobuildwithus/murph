import { listClinicalRecordConnections } from "@/src/lib/clinical-records/connections";
import { clinicalJsonOk, withClinicalJsonError } from "@/src/lib/clinical-records/http";

export const GET = withClinicalJsonError(async (request: Request) =>
  clinicalJsonOk({
    connections: await listClinicalRecordConnections(request),
    ok: true,
  })
);
