import type { AssistantBasePersonaId } from "@murphai/contracts";

export function MurphPersonaGlyph({
  className,
  personaId,
}: {
  className?: string;
  personaId: AssistantBasePersonaId;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      data-persona-glyph={personaId}
      fill="none"
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.5"
      >
        <PersonaGlyphPaths personaId={personaId} />
      </g>
    </svg>
  );
}

function PersonaGlyphPaths({ personaId }: { personaId: AssistantBasePersonaId }) {
  switch (personaId) {
    case "classic":
      return (
        <image href="/logo.svg" height="44" width="197" x="0" y="10" />
      );
    case "navy-seal":
      return (
        <g fill="none" strokeWidth="3">
          <path d="M32 9v43" />
          <path d="m26 17 6-8 6 8" />
          <path d="M18 18v10c0 10 6 17 14 17s14-7 14-17V18" />
          <path d="m12 25 6-7 6 7M40 25l6-7 6 7" />
          <path d="M24 52h16" />
        </g>
      );
    case "stoic-philosopher":
      return (
        <g fill="none" strokeWidth="3">
          <path d="m14 23 18-11 18 11H14Z" />
          <path d="M18 28h28M18 49h28" />
          <path d="M23 28v21M32 28v21M41 28v21" />
          <path d="M14 54h36" />
        </g>
      );
    case "scientist":
      return (
        <g fill="none" strokeWidth="2.75">
          <ellipse cx="32" cy="32" rx="23" ry="10" />
          <ellipse cx="32" cy="32" rx="23" ry="10" transform="rotate(60 32 32)" />
          <ellipse cx="32" cy="32" rx="23" ry="10" transform="rotate(120 32 32)" />
          <circle cx="32" cy="32" fill="currentColor" r="4.5" stroke="none" />
        </g>
      );
    case "hype-coach":
      return (
        <path
          d="M32 9c2 12 6 19 17 23-11 4-15 11-17 23-2-12-6-19-17-23 11-4 15-11 17-23Z"
          fill="none"
          strokeWidth="3"
        />
      );
    case "straight-talking-friend":
      return (
        <g fill="none" strokeWidth="2.1">
          <path d="M11 34h13V22h-9v-2c0-5 3-8 9-10" />
          <path d="M36 34h13V22h-9v-2c0-5 3-8 9-10" />
        </g>
      );
  }
}
