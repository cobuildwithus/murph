import { CustomConnectionConfirm } from "@/src/components/custom-connections/custom-connections-confirm";
import {
  CustomConnectionsFlow,
  type CustomConnectionsStep,
} from "@/src/components/custom-connections/custom-connections-flow";
import type {
  CustomConnection,
  CustomConnectionActionOutcome,
  CustomConnectionActionRequest,
} from "@/src/components/custom-connections/custom-connections-copy";
import { AuthProvider } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import { LinkPageSignInScreen } from "@/src/components/link-page/link-page-sign-in";

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
    { name: "list_notes", title: "Read notes", description: "Notes left for you, newest first. Use it before answering anything about what someone asked you to remember.", readOnly: true, state: "on" },
    { name: "search_notes", title: "Search notes", description: "Find notes that mention a word or a date. Use short keywords, for example a name or a month.", readOnly: true, state: "on" },
    { name: "get_note", title: "Open a note", description: "One note in full, with who left it and when, and any replies under it.", readOnly: true, state: "off" },
    { name: "list_people", title: "Read who's in your notes", description: "Everyone who can leave you notes, with when each last did.", readOnly: true, state: "off" },
    { name: "list_tags", title: "Read note tags", description: "Every tag in use and how many notes carry it.", readOnly: true, state: "off" },
    { name: "get_note_history", title: "Read a note's history", description: "Each earlier version of a note and who changed it.", readOnly: true, state: "off" },
    { name: "get_reminders", title: "Read reminders", description: "Reminders attached to notes, soonest first, including ones already done this week.", readOnly: true, state: "off" },
    { name: "add_note", title: "Leave a note", description: "Adds a note to a folder, with tags and an optional reminder.", readOnly: false, state: "on" },
    { name: "edit_note", title: "Edit a note", description: "Changes a note you left.", readOnly: false, state: "off" },
    { name: "delete_note", title: "Delete a note", description: "Removes a note for everyone.", readOnly: false, state: "off" },
    { name: "tag_note", title: "Tag a note", description: "Adds or removes a tag on a note.", readOnly: false, state: "off" },
    { name: "export_notes", title: "Export every note", description: "", readOnly: true, state: "not_allowed" },
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
  { label: "Add an MCP server", connections: [], step: { error: null, kind: "add", url: "" } },
  { label: "Not an MCP link", connections: [], step: { error: "not_mcp", kind: "add", url: "https://notes.example.com" } },
  { label: "Checking", connections: [], step: { kind: "checking", url: "https://notes.example.com/mcp" } },
  {
    label: "Sign in",
    connections: [],
    step: { authorizationHost: "notes.example.com", authorizationUrl: "https://notes.example.com/authorize", kind: "sign_in", name: "notes.example.com" },
  },
  { label: "Choose", connections: [NEW_NOTES], draft: { list_notes: true, add_note: true }, step: { connectionId: "cc_notes", kind: "choose", mode: "new" } },
  { label: "Connected", connections: [NOTES], step: { connectionId: "cc_notes", kind: "connected" } },
  { label: "Your MCP servers", connections: [NOTES, RECIPES], step: { kind: "list" } },
  { label: "One MCP server", connections: [NOTES, RECIPES], step: { connectionId: "cc_notes", kind: "choose", mode: "edit" } },
  { label: "Changed action", connections: [NOTES, RECIPES], step: { connectionId: "cc_recipes", kind: "choose", mode: "edit" } },
  {
    label: "Signed out",
    connections: [{ ...NOTES, status: "needs_sign_in" }],
    step: { connectionId: "cc_notes", kind: "choose", mode: "edit" },
  },
  { label: "Remove", connections: [NOTES], step: { connectionId: "cc_notes", kind: "remove" } },
  { label: "Server terms", connections: [], step: { code: "provider_terms", kind: "failed" } },
];

const REQUEST: CustomConnectionActionRequest = {
  askedAt: "2026-11-16T18:04:00.000Z",
  host: "notes.example.com",
  id: `car_${"0".repeat(32)}`,
  inputs: {
    folder: "Recipes",
    text: "Try the lentil soup on Sunday.\nDouble the lemon.",
    tags: ["dinner", "weekend"],
    reminder: { at: "2026-11-22T17:00:00Z", repeat: false },
  },
  outcome: { status: "waiting" },
  server: "Notes",
  title: "Leave a note",
};

const CONFIRM_STATES: { label: string; outcome: CustomConnectionActionOutcome; pending?: "confirm" }[] = [
  { label: "Murph asks first", outcome: { status: "waiting" } },
  { label: "Doing it", outcome: { status: "waiting" }, pending: "confirm" },
  { label: "Done", outcome: { status: "done", text: "Saved to Recipes with 2 tags." } },
  { label: "Didn't go through", outcome: { reason: "signed_out", status: "failed" } },
  { label: "May or may not have happened", outcome: { status: "unknown", text: "Reminder service timed out." } },
  { label: "Said no", outcome: { status: "declined" } },
  { label: "Expired", outcome: { status: "expired" } },
];

/** Every screen for adding and looking after the MCP servers Murph can use. */
export function CustomConnectionsStudy() {
  return (
    <div
      className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3"
      data-design-section="custom-connections"
      id="custom-connections"
    >
      {STATES.map((state) => (
        <LinkPageStudyState fit key={state.label} label={state.label}>
          <CustomConnectionsFlow fixture={{ connections: state.connections, draft: state.draft, step: state.step }} />
        </LinkPageStudyState>
      ))}
    </div>
  );
}

/** The page Murph links to before it changes anything in an MCP server: the request, then each way it can end. */
export function CustomConnectionConfirmStudy() {
  return (
    <div
      className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3"
      data-design-section="custom-connection-confirm"
      id="custom-connection-confirm"
    >
      <LinkPageStudyState label="Signed out">
        <AuthProvider authenticated={false}>
          <LinkPageSignInScreen detail="Murph wants your OK before it changes something for you." title="Sign in to check this." />
        </AuthProvider>
      </LinkPageStudyState>
      {CONFIRM_STATES.map((state) => (
        <LinkPageStudyState fit key={state.label} label={state.label}>
          <CustomConnectionConfirm pending={state.pending} request={{ ...REQUEST, outcome: state.outcome }} />
        </LinkPageStudyState>
      ))}
    </div>
  );
}
