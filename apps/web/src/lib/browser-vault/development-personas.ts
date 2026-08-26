export const DEVELOPMENT_PERSONA_COOKIE = "murph_dev_data_persona";

export const DEVELOPMENT_PERSONAS = [
  { id: "oura", label: "Oura member" },
  { id: "whoop", label: "Whoop member" },
  { id: "coach", label: "Training member" },
  { id: "family", label: "Family and groups" },
  { id: "context", label: "Context-rich member" },
] as const;

export type DevelopmentPersonaId = (typeof DEVELOPMENT_PERSONAS)[number]["id"];

export function isDevelopmentPersonaId(
  value: string | null | undefined,
): value is DevelopmentPersonaId {
  return DEVELOPMENT_PERSONAS.some((persona) => persona.id === value);
}
