"use client";

import { useEffect, useState } from "react";

import { cn } from "@/src/lib/utils";

export interface GoalOutlineEntry {
  id: string;
  title: string;
}

// Distance from the top of the viewport at which a section counts as the one
// being read. Matches the sticky nav height plus a little reading room.
const ACTIVE_SECTION_OFFSET_PX = 140;

export function GoalOutline({ entries }: { entries: readonly GoalOutlineEntry[] }) {
  const [activeId, setActiveId] = useState<string | null>(entries[0]?.id ?? null);

  useEffect(() => {
    const ids = entries.map((entry) => entry.id);
    if (ids.length === 0) {
      return;
    }

    let frame = 0;
    const update = () => {
      frame = 0;
      const sections = ids
        .map((id) => document.getElementById(id))
        .filter((element): element is HTMLElement => element !== null);
      if (sections.length === 0) {
        return;
      }

      const scrolledToBottom =
        window.innerHeight + window.scrollY
          >= document.documentElement.scrollHeight - 2;
      if (scrolledToBottom) {
        setActiveId(sections[sections.length - 1]!.id);
        return;
      }

      let current = sections[0]!.id;
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= ACTIVE_SECTION_OFFSET_PX) {
          current = section.id;
        } else {
          break;
        }
      }
      setActiveId(current);
    };
    const schedule = () => {
      if (frame === 0) {
        frame = window.requestAnimationFrame(update);
      }
    };

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("hashchange", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("hashchange", schedule);
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [entries]);

  return (
    <nav aria-label="On this page" data-goal-outline>
      <span className="text-xs font-medium text-muted-foreground">
        On this page
      </span>
      <ol className="mt-3 flex flex-col border-l border-[#c4a882]/30">
        {entries.map((entry) => {
          const active = entry.id === activeId;

          return (
            <li key={entry.id}>
              <a
                aria-current={active ? "location" : undefined}
                href={`#${entry.id}`}
                className={cn(
                  "-ml-px block border-l py-1.5 pl-4 text-sm/6 transition-colors",
                  active
                    ? "border-[#5a6e32] font-medium text-foreground"
                    : "border-transparent text-[#635a48] hover:border-[#c4a882] hover:text-foreground",
                )}
              >
                {entry.title}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
