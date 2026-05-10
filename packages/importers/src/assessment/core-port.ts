export interface AssessmentResponseImportPayload {
  vaultRoot?: string;
  sourcePath: string;
  title: string;
  recordedAt?: string;
  importedAt?: string;
  source?: string;
}

export interface AssessmentImportPort {
  importAssessmentResponse(payload: AssessmentResponseImportPayload): unknown;
}

export function assertAssessmentImportPort(port: unknown): AssessmentImportPort {
  if (!port || typeof port !== "object") {
    throw new TypeError("corePort must be an object");
  }

  const candidate = port as Partial<AssessmentImportPort>;

  if (typeof candidate.importAssessmentResponse !== "function") {
    throw new TypeError("corePort.importAssessmentResponse must be a function");
  }

  return {
    importAssessmentResponse: candidate.importAssessmentResponse.bind(port),
  };
}
