import { cn } from "@/src/lib/utils";

import styles from "./assistant-model-artwork.module.css";
import { AstraStarfield } from "./astra-starfield";

type AssistantModelArtworkVariant = "astra" | "luna" | "sol";

const ASSISTANT_MODEL_CHOICE_CARD_CLASSES = {
  astra: "pointer-events-auto group-data-[disabled=true]:pointer-events-auto border-[#c5d5dd] [--primary:#426b80] [--primary-foreground:#fffcf6] [--muted-foreground:#435e6b] hover:border-[#7b9eaf] has-data-checked:border-[#426b80] has-data-checked:ring-[#7b9eaf]/20 has-data-checked:hover:border-[#426b80] data-[disabled=true]:hover:border-[#c5d5dd] [&>span[aria-hidden=true]]:w-full",
  luna:
    "hover:border-[#777b7d]/40 hover:bg-[#777b7d]/5 has-data-checked:border-[#777b7d] has-data-checked:bg-[#777b7d]/10 has-data-checked:ring-[#777b7d]/15 has-data-checked:hover:border-[#777b7d] has-data-checked:hover:bg-[#777b7d]/10 [&_[data-slot=radio-group-item][data-checked]]:border-[#777b7d] [&_[data-slot=radio-group-item][data-checked]]:bg-[#777b7d]",
  sol: "hover:border-[#8f6817]/40 hover:bg-[#d9ad35]/5 has-data-checked:border-[#8f6817] has-data-checked:bg-[#d9ad35]/10 has-data-checked:ring-[#8f6817]/20 has-data-checked:hover:border-[#8f6817] has-data-checked:hover:bg-[#d9ad35]/10 [&_[data-slot=radio-group-item][data-checked]]:border-[#8f6817] [&_[data-slot=radio-group-item][data-checked]]:bg-[#8f6817]",
} as const satisfies Record<AssistantModelArtworkVariant, string>;

interface AssistantModelArtworkProps {
  className?: string;
  variant: AssistantModelArtworkVariant;
}

export function AssistantModelArtwork({
  className,
  variant,
}: AssistantModelArtworkProps) {
  if (variant === "astra") {
    return (
      <span
        aria-hidden="true"
        className={cn(styles.astra, className)}
        data-model-artwork="astra"
      >
        <span className={styles.aurora} />
        <AstraStarfield />
      </span>
    );
  }

  return (
    <svg
      aria-hidden="true"
      className={cn("size-full", className)}
      data-model-artwork={variant}
      focusable="false"
      viewBox="0 0 240 160"
    >
      {variant === "luna" ? <LunaArtwork /> : null}
      {variant === "sol" ? <SolArtwork /> : null}
    </svg>
  );
}

function LunaArtwork() {
  return (
    <g opacity="0.24">
      <circle cx="202" cy="112" r="62" fill="#777B7D" />
      <circle cx="180" cy="86" r="12" fill="#5F6365" />
      <circle cx="225" cy="102" r="7" fill="#919597" />
      <circle cx="199" cy="137" r="16" fill="#686C6E" />
      <circle cx="237" cy="141" r="9" fill="#5F6365" />
    </g>
  );
}

function SolArtwork() {
  return (
    <g opacity="0.24">
      <circle cx="218" cy="92" r="150" fill="#D9AD35" />
      <circle
        cx="218"
        cy="92"
        r="133"
        fill="none"
        stroke="#E8C867"
        strokeWidth="2"
      />
      <circle cx="169" cy="35" r="9" fill="#E7C35D" />
      <circle cx="159" cy="124" r="13" fill="#C99A28" />
      <circle cx="226" cy="80" r="6" fill="#E7C35D" />
    </g>
  );
}

export { ASSISTANT_MODEL_CHOICE_CARD_CLASSES };
export type { AssistantModelArtworkVariant };
