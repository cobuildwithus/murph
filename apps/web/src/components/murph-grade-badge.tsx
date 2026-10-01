import { cva } from "class-variance-authority";

export type MurphGradeLetter = "A" | "B" | "C" | "D" | "E" | "F" | null;

type MurphGradeTone = "amber" | "muted" | "olive" | "terracotta";

const murphGradeBadgeVariants = cva(
  "inline-flex shrink-0 items-center justify-center font-serif font-semibold leading-none",
  {
    variants: {
      tone: {
        olive: "bg-primary/15 text-primary",
        amber: "bg-[#d89a1c]/15 text-[#8a5a00]",
        terracotta: "bg-destructive/10 text-destructive",
        muted: "bg-muted text-muted-foreground",
      },
      size: {
        xs: "size-7 rounded-lg text-sm",
        sm: "size-10 rounded-xl text-xl",
        lg: "size-20 rounded-xl text-5xl tracking-[-0.03em]",
      },
    },
    defaultVariants: {
      tone: "muted",
      size: "sm",
    },
  },
);

function getGradeTone(letter: MurphGradeLetter): MurphGradeTone {
  if (letter === "A" || letter === "B") return "olive";
  if (letter === "C") return "amber";
  if (letter === "D" || letter === "E" || letter === "F") {
    return "terracotta";
  }
  return "muted";
}

export function MurphGradeBadge(input: {
  emptyGlyph?: "?" | "–";
  label: string;
  letter: MurphGradeLetter;
  size?: "lg" | "sm" | "xs";
}) {
  return (
    <span
      className={murphGradeBadgeVariants({
        size: input.size,
        tone: getGradeTone(input.letter),
      })}
    >
      <span className="sr-only">{input.label}</span>
      <span aria-hidden="true">{input.letter ?? input.emptyGlyph ?? "–"}</span>
    </span>
  );
}
