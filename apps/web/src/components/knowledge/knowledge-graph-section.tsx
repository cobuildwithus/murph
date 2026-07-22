"use client";

import { useState } from "react";

type Grade = "strong" | "moderate" | "early";
type Dir = "up" | "down";

type Edge = { m: string; dir: Dir; grade: Grade; effect: string };

type Topic = {
  id: string;
  name: string;
  studies: number;
  note: string;
  edges: readonly Edge[];
};

type Marker = { id: string; name: string; aim: "higher" | "lower" };

const MARKERS: readonly Marker[] = [
  { id: "hrv", name: "HRV", aim: "higher" },
  { id: "rhr", name: "Resting HR", aim: "lower" },
  { id: "bp", name: "Blood pressure", aim: "lower" },
  { id: "deep", name: "Deep sleep", aim: "higher" },
  { id: "vo2", name: "VO2 max", aim: "higher" },
  { id: "apob", name: "ApoB", aim: "lower" },
  { id: "glucose", name: "Blood glucose", aim: "lower" },
  { id: "skin", name: "Skin", aim: "higher" },
  { id: "bodyfat", name: "Body fat", aim: "lower" },
] as const;

const TOPICS: readonly Topic[] = [
  { id: "sauna", name: "Sauna", studies: 340, note: "Dose, timing, and hydration for heat.", edges: [
    { m: "hrv", dir: "up", grade: "moderate", effect: "higher overnight HRV" },
    { m: "bp", dir: "down", grade: "moderate", effect: "lower resting pressure" },
    { m: "deep", dir: "up", grade: "moderate", effect: "more deep-sleep minutes" },
  ]},
  { id: "redlight", name: "Red light", studies: 278, note: "The exposure dose for your panel.", edges: [
    { m: "skin", dir: "up", grade: "moderate", effect: "less photoaging" },
    { m: "deep", dir: "up", grade: "early", effect: "small sleep gain" },
  ]},
  { id: "zone2", name: "Zone 2", studies: 255, note: "The aerobic base tied to lifespan.", edges: [
    { m: "vo2", dir: "up", grade: "strong", effect: "higher aerobic base" },
    { m: "rhr", dir: "down", grade: "strong", effect: "lower resting HR" },
    { m: "bodyfat", dir: "down", grade: "moderate", effect: "gradual loss" },
  ]},
  { id: "omega3", name: "Omega-3", studies: 382, note: "The dose and which claims hold up.", edges: [
    { m: "apob", dir: "down", grade: "moderate", effect: "small, consistent" },
    { m: "bp", dir: "down", grade: "moderate", effect: "modest drop" },
    { m: "hrv", dir: "up", grade: "early", effect: "mixed" },
  ]},
  { id: "cold", name: "Cold plunge", studies: 235, note: "Timed around your training.", edges: [
    { m: "hrv", dir: "up", grade: "early", effect: "acute, short-lived" },
    { m: "rhr", dir: "down", grade: "early", effect: "small" },
  ]},
  { id: "sleep", name: "Sleep & light", studies: 428, note: "The light timing that fixes the night.", edges: [
    { m: "deep", dir: "up", grade: "strong", effect: "more restorative sleep" },
    { m: "hrv", dir: "up", grade: "moderate", effect: "better recovery" },
    { m: "glucose", dir: "down", grade: "moderate", effect: "steadier mornings" },
  ]},
  { id: "fasting", name: "Fasting", studies: 331, note: "A bounded window, not a crash.", edges: [
    { m: "glucose", dir: "down", grade: "moderate", effect: "flatter curve" },
    { m: "bodyfat", dir: "down", grade: "moderate", effect: "loss over weeks" },
    { m: "apob", dir: "down", grade: "early", effect: "mixed" },
  ]},
  { id: "walking", name: "Post-meal walking", studies: 235, note: "A short walk to flatten the spike.", edges: [
    { m: "glucose", dir: "down", grade: "strong", effect: "blunts the spike" },
  ]},
  { id: "caffeine", name: "Caffeine timing", studies: 267, note: "The cutoff that fits your sleep.", edges: [
    { m: "deep", dir: "up", grade: "strong", effect: "less light-sleep drift" },
    { m: "rhr", dir: "down", grade: "moderate", effect: "calmer nights" },
  ]},
  { id: "creatine", name: "Creatine", studies: 298, note: "The supplement with the deepest evidence.", edges: [
    { m: "bodyfat", dir: "down", grade: "moderate", effect: "more lean mass" },
    { m: "vo2", dir: "up", grade: "early", effect: "small" },
  ]},
] as const;

const VIEW_W = 900;
const VIEW_H = 600;
const CX = 450;
const CY = 300;

function ellipse(i: number, count: number, rx: number, ry: number) {
  const angle = (-90 + i * (360 / count)) * (Math.PI / 180);
  return { x: CX + rx * Math.cos(angle), y: CY + ry * Math.sin(angle), cos: Math.cos(angle) };
}
const TOPIC_POS = TOPICS.map((_, i) => ellipse(i, TOPICS.length, 372, 236));
const MARKER_POS = MARKERS.map((_, i) => ellipse(i, MARKERS.length, 176, 108));
const markerIndex = (id: string) => MARKERS.findIndex((m) => m.id === id);

const GRADE_LABEL: Record<Grade, string> = {
  strong: "Strong evidence",
  moderate: "Moderate evidence",
  early: "Early / mixed",
};

function GradeDot({ grade }: { grade: Grade }) {
  if (grade === "strong") return <span aria-hidden className="inline-block size-2.5 rounded-full bg-[#5a6e32]" />;
  if (grade === "moderate") return <span aria-hidden className="inline-block size-2.5 rounded-full border-[3px] border-[#5a6e32]" />;
  return <span aria-hidden className="inline-block size-2.5 rounded-full border border-dashed border-[#8a6a3a]" />;
}

type Active = { kind: "topic" | "marker"; id: string } | null;

function DetailRow({ title, sub, dir, effect, grade }: { title: string; sub?: string; dir: Dir; effect: string; grade: Grade }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-[#c4a882]/30 py-3.5 first:border-t-0 first:pt-0">
      <div className="min-w-0">
        <p className="font-serif text-[1.0625rem] font-semibold leading-[1.2] text-[#2d3436]">{title}</p>
        {sub ? <p className="mt-0.5 text-[0.8125rem] leading-[1.4] text-[#736a58]">{sub}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2 text-right">
        <span aria-hidden className={`font-serif text-[1.15rem] font-semibold ${dir === "up" ? "text-[#5a6e32]" : "text-[#8a6a3a]"}`}>
          {dir === "up" ? "↑" : "↓"}
        </span>
        <div>
          <p className="text-[0.8125rem] text-[#2d3436]">{effect}</p>
          <p className="mt-0.5 inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[#6f6450]">
            <GradeDot grade={grade} />
            {GRADE_LABEL[grade]}
          </p>
        </div>
      </div>
    </div>
  );
}

export function KnowledgeGraphSection() {
  const [active, setActive] = useState<Active>(null);

  const activeTopic = active?.kind === "topic" ? TOPICS.find((t) => t.id === active.id) ?? null : null;
  const activeMarker = active?.kind === "marker" ? MARKERS.find((m) => m.id === active.id) ?? null : null;

  const litMarkers = new Set<string>();
  const litTopics = new Set<string>();
  if (activeTopic) {
    litTopics.add(activeTopic.id);
    activeTopic.edges.forEach((e) => litMarkers.add(e.m));
  } else if (activeMarker) {
    litMarkers.add(activeMarker.id);
    TOPICS.forEach((t) => t.edges.some((e) => e.m === activeMarker.id) && litTopics.add(t.id));
  }
  const hasActive = active !== null;
  const topicsForMarker = (id: string) =>
    TOPICS.map((t) => ({ t, e: t.edges.find((x) => x.m === id) })).filter((r) => r.e);

  return (
    <section className="bg-[#2a2520] px-5 py-16 sm:px-10 lg:px-16 lg:py-24">
      <div className="mx-auto max-w-[1200px]">
        <div className="flex items-center gap-4">
          <span aria-hidden className="h-px w-10 bg-[#c4a882]/60" />
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-[#c9a86a]">
            The knowledge, mapped
          </span>
        </div>
        <h2 className="mt-6 max-w-[22ch] font-serif text-[clamp(1.75rem,3.5vw,2.75rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-[#f5f0e8]">
          See what is actually worth trying.
        </h2>
        <p className="mt-4 max-w-[56ch] text-[0.9375rem] leading-[1.7] text-[#c3bba9]">
          Tap a topic and Murph shows the health signals it can affect, which
          way, and how firm the evidence is, so you spend effort where it counts
          and not where the hype is. Tap a signal to see what can move it.
        </p>

        <div className="mt-10 grid items-center gap-8 lg:grid-cols-[1fr_330px]">
          {/* Mobile / tablet selector — the constellation is desktop-only */}
          <div className="lg:hidden">
            <p className="mb-3 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#c9a86a]">
              Topics
            </p>
            <div className="mb-6 flex flex-wrap gap-2">
              {TOPICS.map((t) => {
                const on = active?.kind === "topic" && active.id === t.id;
                return (
                  <button
                    className={`rounded-full px-3 py-1.5 text-[0.8125rem] transition-colors ${
                      on
                        ? "bg-[#f5f0e8] text-[#2d3436]"
                        : "border border-[#c4a882]/40 text-[#e6ddca]"
                    }`}
                    key={t.id}
                    onClick={() => setActive({ kind: "topic", id: t.id })}
                    type="button"
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
            <p className="mb-3 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#c9a86a]">
              Signals
            </p>
            <div className="flex flex-wrap gap-2">
              {MARKERS.map((m) => {
                const on = active?.kind === "marker" && active.id === m.id;
                return (
                  <button
                    className={`rounded-full px-3 py-1.5 text-[0.8125rem] transition-colors ${
                      on
                        ? "bg-[#c9a86a] text-[#2a2520]"
                        : "border border-[#8a6a3a]/50 text-[#d8cba8]"
                    }`}
                    key={m.id}
                    onClick={() => setActive({ kind: "marker", id: m.id })}
                    type="button"
                  >
                    {m.name}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="hidden overflow-x-auto lg:block">
            <svg
              className="mx-auto h-auto w-full min-w-[760px] max-w-[1040px]"
              fill="none"
              viewBox={`-150 -50 ${VIEW_W + 300} ${VIEW_H + 100}`}
              xmlns="http://www.w3.org/2000/svg"
            >
              <ellipse cx={CX} cy={CY} rx={372} ry={236} stroke="#f5f0e8" strokeOpacity="0.08" strokeWidth="0.75" />
              <ellipse cx={CX} cy={CY} rx={176} ry={108} stroke="#f5f0e8" strokeOpacity="0.06" strokeWidth="0.75" />

              {TOPICS.map((t, ti) =>
                t.edges.map((e) => {
                  const mp = MARKER_POS[markerIndex(e.m)];
                  const tp = TOPIC_POS[ti];
                  const lit = litTopics.has(t.id) && litMarkers.has(e.m);
                  const opacity = lit ? 0.7 : hasActive ? 0.06 : 0.2;
                  return (
                    <line
                      key={`${t.id}-${e.m}`}
                      stroke={lit ? "#9db06f" : "#c4a882"}
                      strokeOpacity={opacity}
                      strokeWidth={lit ? 1.75 : 1}
                      style={{ transition: "stroke-opacity 0.25s ease, stroke 0.25s ease" }}
                      x1={tp.x} x2={mp.x} y1={tp.y} y2={mp.y}
                    />
                  );
                })
              )}

              {MARKERS.map((m, i) => {
                const p = MARKER_POS[i];
                const lit = litMarkers.has(m.id);
                const dim = hasActive && !lit;
                const isActive = active?.kind === "marker" && active.id === m.id;
                return (
                  <g key={m.id} className="cursor-pointer" role="button" tabIndex={0}
                    aria-label={`${m.name}, a health signal`}
                    onMouseEnter={() => setActive({ kind: "marker", id: m.id })}
                    onFocus={() => setActive({ kind: "marker", id: m.id })}
                    onClick={() => setActive({ kind: "marker", id: m.id })}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setActive({ kind: "marker", id: m.id }); } }}
                    style={{ opacity: dim ? 0.3 : 1, transition: "opacity 0.25s ease" }}>
                    <circle cx={p.x} cy={p.y} r={isActive ? 9.5 : 7.5} fill={lit ? "#c9a86a" : "#6e6250"}
                      stroke="#c9a86a" strokeOpacity="0.7" strokeWidth="1"
                      style={{ transition: "fill 0.25s ease, r 0.2s ease" }} />
                    <text x={p.x} y={p.y - 13} className="font-mono" fill={lit ? "#f0e6cf" : "#b3a992"} fontSize="12.5"
                      fontWeight={lit ? 600 : 500} textAnchor="middle">{m.name}</text>
                  </g>
                );
              })}

              {TOPICS.map((t, i) => {
                const p = TOPIC_POS[i];
                const r = 23 + t.studies / 14;
                const lit = litTopics.has(t.id);
                const dim = hasActive && !lit;
                const anchor = p.cos > 0.2 ? "start" : p.cos < -0.2 ? "end" : "middle";
                const lx = anchor === "start" ? p.x + r + 8 : anchor === "end" ? p.x - r - 8 : p.x;
                const ly = anchor === "middle" ? (p.y < CY ? p.y - r - 10 : p.y + r + 18) : p.y + 4;
                return (
                  <g key={t.id} className="cursor-pointer" role="button" tabIndex={0}
                    aria-label={`${t.name}, ${t.studies} studies read`}
                    onMouseEnter={() => setActive({ kind: "topic", id: t.id })}
                    onFocus={() => setActive({ kind: "topic", id: t.id })}
                    onClick={() => setActive({ kind: "topic", id: t.id })}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setActive({ kind: "topic", id: t.id }); } }}
                    style={{ opacity: dim ? 0.28 : 1, transition: "opacity 0.25s ease" }}>
                    <circle cx={p.x} cy={p.y} r={r} fill="#f5f0e8" stroke={lit ? "#9db06f" : "#7a8c6e"}
                      strokeOpacity={lit ? 1 : 0.6} strokeWidth={lit ? 2.25 : 1.25}
                      style={{ transition: "stroke-opacity 0.25s ease, stroke-width 0.25s ease" }} />
                    <text x={p.x} y={p.y + 5} className="font-mono" fill="#5a6e32" fontSize="15" fontWeight="500" textAnchor="middle">
                      {t.studies}
                    </text>
                    <text x={lx} y={ly} fill="#ece3d0" fontFamily="var(--font-sans)" fontSize="15.5" fontWeight="600" textAnchor={anchor}>
                      {t.name}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Detail panel — fixed height so hovering never shifts the layout */}
          <div className="rounded-2xl border border-[#c4a882]/25 bg-[#f5f0e8] p-6 lg:h-[440px] lg:overflow-y-auto">
            {activeTopic ? (
              <div>
                <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#5a6e32]">
                  {activeTopic.studies} studies read
                </span>
                <h3 className="mt-2 font-serif text-[1.5rem] font-semibold leading-[1.1] text-[#2d3436]">{activeTopic.name}</h3>
                <p className="mt-1.5 text-[0.875rem] leading-[1.5] text-[#736a58]">{activeTopic.note}</p>
                <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.12em] text-[#6f6450]">What it can affect</p>
                <div className="mt-2">
                  {activeTopic.edges.map((e) => (
                    <DetailRow key={e.m} title={MARKERS.find((m) => m.id === e.m)?.name ?? e.m} dir={e.dir} effect={e.effect} grade={e.grade} />
                  ))}
                </div>
              </div>
            ) : activeMarker ? (
              <div>
                <span className="inline-flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#7a5a28]">
                  Aim {activeMarker.aim} <span aria-hidden>{activeMarker.aim === "higher" ? "↑" : "↓"}</span>
                </span>
                <h3 className="mt-2 font-serif text-[1.5rem] font-semibold leading-[1.1] text-[#2d3436]">{activeMarker.name}</h3>
                <p className="mt-1.5 text-[0.875rem] leading-[1.5] text-[#736a58]">What Murph knows can affect it.</p>
                <div className="mt-4">
                  {topicsForMarker(activeMarker.id).map(({ t, e }) => (
                    <DetailRow key={t.id} title={t.name} sub={`${t.studies} studies`} dir={e!.dir} effect={e!.effect} grade={e!.grade} />
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-[240px] flex-col justify-center">
                <p className="font-serif text-[1.25rem] leading-[1.3] text-[#2d3436]">
                  Around 3,200 studies, mapped to the health signals they can
                  affect.
                </p>
                <p className="mt-3 text-[0.875rem] leading-[1.6] text-[#736a58]">
                  Tap any topic or signal to see the direction of the effect and
                  how firm the evidence is.
                </p>
                <div className="mt-6 flex flex-wrap gap-x-4 gap-y-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-[#6f6450]">
                  <span className="inline-flex items-center gap-1.5"><GradeDot grade="strong" /> Strong</span>
                  <span className="inline-flex items-center gap-1.5"><GradeDot grade="moderate" /> Moderate</span>
                  <span className="inline-flex items-center gap-1.5"><GradeDot grade="early" /> Early / mixed</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <p className="mt-8 hidden flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#a99f88] lg:flex">
          <span className="inline-flex items-center gap-2">
            <span className="inline-block size-2.5 rounded-full border border-[#7a8c6e] bg-[#f5f0e8]" />
            Topic, sized by studies read
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="inline-block size-2.5 rounded-full bg-[#c9a86a]" />
            Signal it can affect
          </span>
        </p>
      </div>
    </section>
  );
}
