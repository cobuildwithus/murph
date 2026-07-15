import { cn } from "@/src/lib/utils";

type AssistantModelArtworkVariant = "luna" | "sol" | "terra";

const ASSISTANT_MODEL_CHOICE_CARD_CLASSES = {
  luna:
    "hover:border-[#777b7d]/40 hover:bg-[#777b7d]/5 has-data-checked:border-[#777b7d] has-data-checked:bg-[#777b7d]/10 has-data-checked:ring-[#777b7d]/15 has-data-checked:hover:border-[#777b7d] has-data-checked:hover:bg-[#777b7d]/10 [&_[data-slot=radio-group-item][data-checked]]:border-[#777b7d] [&_[data-slot=radio-group-item][data-checked]]:bg-[#777b7d]",
  terra:
    "hover:border-[#557d78]/40 hover:bg-[#4f7f97]/5 has-data-checked:border-[#557d78] has-data-checked:bg-[#4f7f97]/10 has-data-checked:ring-[#758f5c]/20 has-data-checked:hover:border-[#557d78] has-data-checked:hover:bg-[#4f7f97]/10 [&_[data-slot=radio-group-item][data-checked]]:border-[#557d78] [&_[data-slot=radio-group-item][data-checked]]:bg-[#557d78]",
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
  return (
    <svg
      aria-hidden="true"
      className={cn("size-full", className)}
      data-model-artwork={variant}
      focusable="false"
      viewBox="0 0 240 160"
    >
      {variant === "luna" ? <LunaArtwork /> : null}
      {variant === "terra" ? <TerraArtwork /> : null}
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

function TerraArtwork() {
  return (
    <g opacity="0.27">
      <circle cx="194" cy="104" r="90" fill="#4F7F97" />
      <g transform="translate(194 104) scale(1.32) translate(-194 -104)">
        <path
          d="M155 67c14-17 36-29 57-28l-2 15-14 8-5 13-15 1-9 11-13-6Z"
          fill="#758F5C"
        />
        <path
          d="m175 101 16-9 18 6 3 13 13 9-6 18-16 10-9-13-12-7-3-14Z"
          fill="#6C8755"
        />
        <path
          d="M145 111c8 3 15 9 18 17l-10 11-12-8Z"
          fill="#89A06C"
        />
      </g>
      <circle
        cx="194"
        cy="104"
        r="90"
        fill="none"
        stroke="#3E6D82"
        strokeWidth="2"
      />
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
