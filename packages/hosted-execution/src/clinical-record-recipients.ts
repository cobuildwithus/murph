type ClinicalRecordRecipient = { id: string; hosts: readonly string[] } & (
  | { kind: "named"; name: string; purpose: string; version: string }
  | { kind: "member-directed"; name?: string; reason: string }
  | { kind: "no-hospital-content" | "infrastructure"; reason: string }
);

// Each named row supplies one companion notice and one stable consent scope.
// Version the notice when its receiving company or purpose changes. Member-directed
// rows with a company name supply the companion disclosure about requested services.
export const clinicalRecordRecipients = [
  {
    id: "openai", kind: "named", hosts: ["api.openai.com"],
    name: "OpenAI", version: "2026-11-25",
    purpose: "Reads your records to organize them and answer questions about them.",
  },
  {
    id: "xai", kind: "member-directed", hosts: ["api.x.ai"],
    name: "xAI",
    reason: "searches X when you ask",
  },
  {
    id: "gemini", kind: "member-directed", hosts: ["generativelanguage.googleapis.com"],
    name: "Google",
    reason: "answers your questions about a video you share",
  },
  {
    id: "elevenlabs", kind: "member-directed", hosts: ["api.elevenlabs.io"],
    name: "ElevenLabs",
    reason: "makes voice messages you request",
  },
  {
    id: "mapbox", kind: "member-directed", hosts: ["api.mapbox.com"],
    name: "Mapbox",
    reason: "finds places and directions when you ask",
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
    id: "murph-infrastructure", kind: "infrastructure",
    hosts: [
      "artifacts.worker", "browser-vault.worker", "results.worker", "media.worker",
      "runner-control.worker", "web-control.worker", "workspace-snapshots.worker",
      "murph-data-api.worker", "host.docker.internal",
    ],
    reason: "Internal addresses for Murph services, runtime control and workspace storage.",
  },
] as const satisfies readonly ClinicalRecordRecipient[];
