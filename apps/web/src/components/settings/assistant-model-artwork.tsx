import { useId } from "react";

import { cn } from "@/src/lib/utils";

import styles from "./assistant-model-artwork.module.css";

type AssistantModelArtworkVariant = "astra" | "luna" | "sol" | "terra";

const ASSISTANT_MODEL_CHOICE_CARD_CLASSES = {
  astra: "hover:border-primary/40 hover:bg-primary/5 has-data-checked:border-primary has-data-checked:bg-primary/10",
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
      {variant === "astra" ? <AstraArtwork /> : null}
      {variant === "luna" ? <LunaArtwork /> : null}
      {variant === "terra" ? <TerraArtwork /> : null}
      {variant === "sol" ? <SolArtwork /> : null}
    </svg>
  );
}

// Fixed particles keep the illustration identical across server and client renders.
const ASTRA_DUST = Array.from({ length: 240 }, (_, index) => {
  const progress = index / 239;
  const angle = progress * 10 + 1.27;
  const scatter = Math.sin(index * 127.1) * Math.cos(index * 311.7);
  const radius = 3 + progress * 69 + scatter * (2 + progress * 5);

  return (
    <circle
      key={index}
      cx={(181 + Math.cos(angle) * radius).toFixed(3)}
      cy={(99 + Math.sin(angle) * radius).toFixed(3)}
      r={(index % 13 === 0 ? 1.05 : 0.35 + Math.abs(scatter) * 0.55).toFixed(3)}
      fill={index % 4 === 0 ? "#c4a882" : index % 3 === 0 ? "#f5f7f4" : "#6d9eaf"}
      opacity={(0.45 + Math.abs(scatter) * 0.55).toFixed(3)}
    />
  );
});

function AstraArtwork() {
  const id = useId();

  return (
    <g className={styles.astra}>
      <defs>
        <g id={`${id}-dust`}>{ASTRA_DUST}</g>
        <radialGradient id={`${id}-nebula`}>
          <stop stopColor="#0e252f" stopOpacity="0.95" />
          <stop offset="0.5" stopColor="#143947" stopOpacity="0.84" />
          <stop offset="0.7" stopColor="#326475" stopOpacity="0.38" />
          <stop offset="1" stopColor="#5d8693" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-core`}>
          <stop stopColor="#fffdf4" />
          <stop offset="0.12" stopColor="#f9edca" stopOpacity="0.95" />
          <stop offset="0.38" stopColor="#94c7da" stopOpacity="0.55" />
          <stop offset="1" stopColor="#94c7da" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="184" cy="95" rx="80" ry="79" fill={`url(#${id}-nebula)`} />
      <g className={styles.dust}>
        <use href={`#${id}-dust`} />
      </g>
      <g className={styles.echo} opacity="0.45">
        <use href={`#${id}-dust`} />
      </g>
      <g className={styles.orbit}>
        <path
          d="M159 82a28 28 0 0 1 22-11"
          fill="none"
          stroke="#94c7da"
          strokeWidth="0.7"
          opacity="0.5"
        />
        <circle cx="181" cy="71" r="1.3" fill="#fffdf4" />
      </g>
      <circle
        className={styles.core}
        cx="181"
        cy="99"
        r="22"
        fill={`url(#${id}-core)`}
      />
      <g className={styles.stars} fill="#fffdf4">
        <path d="m181 88 1.4 9.6L192 99l-9.6 1.4L181 110l-1.4-9.6L170 99l9.6-1.4Z" />
        <path d="m125 77 1 5 5 1-5 1-1 5-1-5-5-1 5-1Z" />
        <path d="m191 29 0.8 4.2 4.2 0.8-4.2 0.8-0.8 4.2-0.8-4.2-4.2-0.8 4.2-0.8Z" />
      </g>
      <g className={styles.satellites} fill="#85a5b0">
        <circle cx="113" cy="47" r="0.8" />
        <circle cx="156" cy="21" r="0.6" />
        <circle cx="232" cy="71" r="1" />
        <circle cx="130" cy="132" r="0.7" />
        <circle cx="205" cy="148" r="0.8" />
        <path d="m212 100 0.8 4.2 4.2 0.8-4.2 0.8-0.8 4.2-0.8-4.2-4.2-0.8 4.2-0.8Z" />
      </g>
    </g>
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
