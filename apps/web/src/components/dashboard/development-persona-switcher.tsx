"use client";

import { Database, Check } from "lucide-react";

import { Button } from "@/src/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/src/components/ui/popover";
import {
  DEVELOPMENT_PERSONA_COOKIE,
  DEVELOPMENT_PERSONAS,
  type DevelopmentPersonaId,
} from "@/src/lib/browser-vault/development-personas";
import { cn } from "@/src/lib/utils";

export function DevelopmentPersonaSwitcher({
  activePersona,
}: {
  activePersona: DevelopmentPersonaId | null;
}) {
  const activeLabel =
    DEVELOPMENT_PERSONAS.find((persona) => persona.id === activePersona)
      ?.label ?? "Live account";

  const selectPersona = (persona: DevelopmentPersonaId | null) => {
    document.cookie = persona
      ? `${DEVELOPMENT_PERSONA_COOKIE}=${persona}; Path=/; SameSite=Lax`
      : `${DEVELOPMENT_PERSONA_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
    window.location.reload();
  };

  return (
    <div className="fixed bottom-4 right-4 z-[80]">
      <Popover>
        <PopoverTrigger
          render={
            <Button
              aria-label={`Development data: ${activeLabel}`}
              className="h-9 gap-2 rounded-full border-border/80 bg-card px-3 text-xs shadow-md hover:bg-muted"
              size="sm"
              variant="outline"
            >
              <Database aria-hidden="true" className="size-3.5" />
              {activeLabel}
            </Button>
          }
        />
        <PopoverContent
          align="end"
          className="w-64 p-2"
          side="top"
          sideOffset={8}
        >
          <PopoverHeader className="gap-1 px-2 pb-2 pt-1">
            <PopoverTitle className="text-sm font-semibold">
              Development data
            </PopoverTitle>
            <PopoverDescription className="text-xs leading-4">
              Switch the real dashboard between synthetic member histories.
            </PopoverDescription>
          </PopoverHeader>
          <div className="flex flex-col" role="menu">
            <PersonaOption
              active={activePersona === null}
              label="Live account"
              onSelect={() => selectPersona(null)}
            />
            {DEVELOPMENT_PERSONAS.map((persona) => (
              <PersonaOption
                active={activePersona === persona.id}
                key={persona.id}
                label={persona.label}
                onSelect={() => selectPersona(persona.id)}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function PersonaOption({
  active,
  label,
  onSelect,
}: {
  active: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      className={cn(
        "flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active && "bg-muted/70",
      )}
      onClick={onSelect}
      role="menuitemradio"
      type="button"
      aria-checked={active}
    >
      <span>{label}</span>
      {active ? (
        <Check aria-hidden="true" className="size-4 text-primary" />
      ) : null}
    </button>
  );
}
