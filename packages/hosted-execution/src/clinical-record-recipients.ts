type ClinicalRecordRecipient = { id: string; hosts: readonly string[] } & (
  | { kind: "named"; name: string; purpose: string; version: string }
  | { kind: "member-directed" | "no-hospital-content" | "infrastructure"; reason: string }
);

// Each named row supplies one companion notice and one stable consent scope.
// Version the notice when its receiving company or purpose changes.
export const clinicalRecordRecipients = [
  {
    id: "openai", kind: "named", hosts: ["api.openai.com"],
    name: "OpenAI OpCo, LLC", version: "2026-11-25",
    purpose: "Reads your records to organize them and answer questions about them.",
  },
  {
    id: "xai", kind: "named", hosts: ["api.x.ai"],
    name: "SpaceX Super Intelligence LLC (xAI)", version: "2026-11-25",
    purpose: "May receive details from your records in questions Murph sends to search X.",
  },
  {
    id: "gemini", kind: "named", hosts: ["generativelanguage.googleapis.com"],
    name: "Google LLC (Gemini)", version: "2026-11-25",
    purpose: "May receive details from your records in questions about a video you share.",
  },
  {
    id: "elevenlabs", kind: "named", hosts: ["api.elevenlabs.io"],
    name: "Eleven Labs Inc.", version: "2026-11-25",
    purpose: "May turn a reply containing details from your records into a voice message.",
  },
  {
    id: "mapbox", kind: "named", hosts: ["api.mapbox.com"],
    name: "Mapbox, Inc.", version: "2026-11-25",
    purpose: "May look up places or directions using details from your records.",
  },
  {
    id: "delivery", kind: "member-directed", hosts: ["api.linqapp.com", "api.telegram.org"],
    reason: "Delivers to the member or a recipient the member selects.",
  },
  {
    id: "connected-actions", kind: "member-directed", hosts: ["connections.worker"],
    reason: "The member connects the service or chooses the website, call, email recipient or export.",
  },
  {
    id: "transcription", kind: "no-hospital-content", hosts: ["murph-transcribe.worker"],
    reason: "The attachment parser sends audio to Workers AI. Hospital enrichment prepares text, PDFs and images locally.",
  },
  {
    id: "retired-search", kind: "no-hospital-content", hosts: [],
    reason: "Hosted search has no Exa integration.",
  },
  {
    id: "murph-infrastructure", kind: "infrastructure",
    hosts: [
      "artifacts.worker", "browser-vault.worker", "results.worker", "media.worker",
      "runner-control.worker", "web-control.worker", "workspace-snapshots.worker",
      "murph-data-api.worker", "host.docker.internal",
    ],
    reason: "Internal addresses for Murph services, runtime control and workspace storage.",
  },
] as const satisfies readonly ClinicalRecordRecipient[];
