import {
  CustomConnectionsFlow,
  type CustomConnectionsStep,
} from "@/src/components/custom-connections/custom-connections-flow";
import type { CustomConnection } from "@/src/components/custom-connections/custom-connections-copy";

import { LinkPageStudyState } from "./link-page-study-state";

const NOTES: CustomConnection = {
  auth: "oauth",
  createdAt: "2026-11-15T15:00:00.000Z",
  host: "notes.example.com",
  id: "cc_notes",
  lastUsedAt: "2026-11-15T16:10:00.000Z",
  name: "Notes",
  revision: 4,
  slug: "notes",
  status: "on",
  tools: [
    { name: "list_notes", title: "Read notes", description: "Notes left for you, newest first.", readOnly: true, state: "on" },
    { name: "search_notes", title: "Search notes", description: "Find notes that mention a word or a date.", readOnly: true, state: "on" },
    { name: "get_note", title: "Open a note", description: "One note in full, with who left it and when.", readOnly: true, state: "off" },
    { name: "add_note", title: "Leave a note", description: "Adds a note for someone else to read.", readOnly: false, state: "not_allowed" },
  ],
};

const RECIPES: CustomConnection = {
  auth: "none",
  createdAt: "2026-11-14T15:00:00.000Z",
  host: "recipes.example.com",
  id: "cc_recipes",
  lastUsedAt: null,
  name: "Recipes",
  revision: 2,
  slug: "recipes",
  status: "on",
  tools: [
    { name: "search", title: "Search recipes", description: "Recipes that match an ingredient or a dish.", readOnly: true, state: "needs_look" },
    { name: "get_recipe", title: "Open a recipe", description: "One recipe with its steps.", readOnly: true, state: "on" },
  ],
};

const NEW_NOTES: CustomConnection = {
  ...NOTES,
  tools: NOTES.tools.map((tool) => ({ ...tool, state: tool.state === "not_allowed" ? "not_allowed" : "off" })),
};

const STATES: { connections: CustomConnection[]; draft?: Record<string, boolean>; label: string; step: CustomConnectionsStep }[] = [
  { label: "Add a service", connections: [], step: { error: null, kind: "add", url: "" } },
  { label: "Not a service link", connections: [], step: { error: "not_mcp", kind: "add", url: "https://notes.example.com" } },
  { label: "Checking", connections: [], step: { kind: "checking", url: "https://notes.example.com/mcp" } },
  {
    label: "Sign in",
    connections: [],
    step: { authorizationHost: "notes.example.com", authorizationUrl: "https://notes.example.com/authorize", kind: "sign_in", name: "notes.example.com" },
  },
  { label: "Choose", connections: [NEW_NOTES], draft: { list_notes: true }, step: { connectionId: "cc_notes", kind: "choose", mode: "new" } },
  { label: "Connected", connections: [NOTES], step: { connectionId: "cc_notes", kind: "connected" } },
  { label: "Your services", connections: [NOTES, RECIPES], step: { kind: "list" } },
  { label: "One service", connections: [NOTES, RECIPES], step: { connectionId: "cc_notes", kind: "choose", mode: "edit" } },
  { label: "Changed action", connections: [NOTES, RECIPES], step: { connectionId: "cc_recipes", kind: "choose", mode: "edit" } },
  {
    label: "Signed out",
    connections: [{ ...NOTES, status: "needs_sign_in" }],
    step: { connectionId: "cc_notes", kind: "choose", mode: "edit" },
  },
  { label: "Remove", connections: [NOTES], step: { connectionId: "cc_notes", kind: "remove" } },
  { label: "Service terms", connections: [], step: { code: "provider_terms", kind: "failed" } },
];

/** Every screen for adding and looking after the services Murph can use. */
export function CustomConnectionsStudy() {
  return (
    <div
      className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3"
      data-design-section="custom-connections"
      id="custom-connections"
    >
      {STATES.map((state) => (
        <LinkPageStudyState key={state.label} label={state.label}>
          <CustomConnectionsFlow fixture={{ connections: state.connections, draft: state.draft, step: state.step }} />
        </LinkPageStudyState>
      ))}
    </div>
  );
}
