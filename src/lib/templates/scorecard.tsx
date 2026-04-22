import { ArrowDown, ArrowRight, ArrowUp, Gauge } from "lucide-react";
import type { TemplateSpec } from "./types";

type Scorecard = {
  label: string;
  value: string | number;
  unit?: string;
  delta?: {
    value: number;
    /** If set, renders a percentage suffix. */
    percent?: boolean;
    /** Compared to what? "YoY", "vs target", "7d" etc. */
    against?: string;
  };
  sparkline?: number[];
  /** Semantic tint for the card header bar. Default "neutral". */
  tone?: "neutral" | "good" | "warn" | "bad";
  note?: string;
};

type ScorecardData = {
  title?: string;
  asOf?: string;
  cards: Scorecard[];
};

const EXAMPLE = `\`\`\`template:scorecards
{
  "title": "Revenue snapshot",
  "asOf": "2026-04-22",
  "cards": [
    {
      "label": "ARR",
      "value": "4.2M",
      "unit": "USD",
      "delta": { "value": 12, "percent": true, "against": "QoQ" },
      "sparkline": [3.1, 3.4, 3.5, 3.8, 4.0, 4.1, 4.2],
      "tone": "good"
    },
    {
      "label": "Churn",
      "value": "3.1",
      "unit": "%",
      "delta": { "value": 0.4, "percent": true, "against": "MoM" },
      "tone": "bad",
      "note": "driven by SMB segment"
    }
  ]
}
\`\`\``;

const SYSTEM = `You can respond with a scorecards template when presenting 2–8 KPIs, metrics, or headline numbers. Shape:

${EXAMPLE}

Rules:
- Use this instead of a markdown table whenever the user asks for "numbers", "KPIs", "metrics", "snapshot", "how's X doing".
- label: short (1–3 words).
- value: string or number. Short ("4.2M", "127", "98.3"). Include the unit separately.
- unit: optional, short ("USD", "%", "ms").
- delta.value: the change amount. Sign matters. If percent true, render as "+12%".
- delta.against: short comparator phrase ("QoQ", "vs target", "7d").
- sparkline: 5–12 numbers oldest-to-newest for a trend glyph.
- tone: "good" (positive trend), "bad" (concerning), "warn" (mixed), "neutral" (informational). Pick based on what the number MEANS, not its direction (e.g. rising churn is "bad").
- note: 1 short line of context if genuinely useful.
- 2–6 cards is ideal; up to 8 if they cluster cleanly.`;

function parse(raw: unknown): ScorecardData | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const cards = Array.isArray(r.cards) ? r.cards : null;
  if (!cards) return null;
  const cleaned: Scorecard[] = [];
  for (const c of cards) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const label = typeof o.label === "string" ? o.label : null;
    const value =
      typeof o.value === "string" || typeof o.value === "number"
        ? o.value
        : null;
    if (!label || value === null) continue;
    const delta =
      o.delta && typeof o.delta === "object"
        ? (() => {
            const d = o.delta as Record<string, unknown>;
            const v = typeof d.value === "number" ? d.value : null;
            if (v === null) return undefined;
            return {
              value: v,
              percent: d.percent === true,
              against:
                typeof d.against === "string" ? d.against : undefined,
            };
          })()
        : undefined;
    const sparkline =
      Array.isArray(o.sparkline) &&
      o.sparkline.every((n) => typeof n === "number")
        ? (o.sparkline as number[])
        : undefined;
    const tone =
      o.tone === "good" || o.tone === "bad" || o.tone === "warn"
        ? (o.tone as "good" | "bad" | "warn")
        : ("neutral" as const);
    cleaned.push({
      label,
      value,
      unit: typeof o.unit === "string" ? o.unit : undefined,
      delta,
      sparkline,
      tone,
      note: typeof o.note === "string" ? o.note : undefined,
    });
  }
  if (!cleaned.length) return null;
  return {
    title: typeof r.title === "string" ? r.title : undefined,
    asOf: typeof r.asOf === "string" ? r.asOf : undefined,
    cards: cleaned,
  };
}

function Sparkline({ data, tone }: { data: number[]; tone: string }) {
  if (data.length < 2) return null;
  const W = 80;
  const H = 24;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * W;
      const y = H - ((v - min) / span) * H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const stroke =
    tone === "good"
      ? "rgb(16 185 129)"
      : tone === "bad"
        ? "rgb(220 38 38)"
        : tone === "warn"
          ? "rgb(202 138 4)"
          : "var(--accent)";
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="opacity-80"
      aria-hidden
    >
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={pts}
      />
    </svg>
  );
}

function toneBar(tone: string) {
  if (tone === "good") return "bg-emerald-500/80";
  if (tone === "bad") return "bg-red-500/80";
  if (tone === "warn") return "bg-amber-500/80";
  return "bg-accent/60";
}

function DeltaPill({ d, tone }: { d: Scorecard["delta"]; tone: string }) {
  if (!d) return null;
  const pos = d.value > 0;
  const neg = d.value < 0;
  const Icon = pos ? ArrowUp : neg ? ArrowDown : ArrowRight;
  const color =
    tone === "good"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "bad"
        ? "text-red-600 dark:text-red-400"
        : tone === "warn"
          ? "text-amber-600 dark:text-amber-400"
          : "text-fg-muted";
  const formatted = `${pos ? "+" : ""}${d.value}${d.percent ? "%" : ""}`;
  return (
    <span
      className={`inline-flex items-center gap-0.5 font-mono text-[11.5px] ${color}`}
    >
      <Icon className="h-3 w-3" />
      {formatted}
      {d.against && (
        <span className="ml-1 text-fg-subtle">{d.against}</span>
      )}
    </span>
  );
}

function ScorecardRender({ data }: { data: ScorecardData }) {
  return (
    <div className="my-3 not-italic">
      {(data.title || data.asOf) && (
        <div className="byline mb-2 flex items-baseline gap-2">
          <Gauge className="h-3 w-3" />
          {data.title && <span>{data.title}</span>}
          {data.asOf && (
            <span className="ml-auto font-mono text-fg-subtle">
              as of {data.asOf}
            </span>
          )}
        </div>
      )}
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
        {data.cards.map((c, i) => {
          const tone = c.tone ?? "neutral";
          return (
            <div
              key={i}
              className="relative overflow-hidden rounded-sm border border-border bg-bg-paper px-3 py-2.5"
            >
              <span
                className={`absolute left-0 top-0 h-full w-[3px] ${toneBar(tone)}`}
              />
              <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-fg-subtle">
                {c.label}
              </div>
              <div className="mt-0.5 flex items-baseline gap-1">
                <span
                  className="font-display text-[22px] italic leading-none text-fg"
                  style={{ fontVariationSettings: '"opsz" 144, "SOFT" 30' }}
                >
                  {c.value}
                </span>
                {c.unit && (
                  <span className="font-mono text-[10.5px] text-fg-subtle">
                    {c.unit}
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <DeltaPill d={c.delta} tone={tone} />
                {c.sparkline && (
                  <Sparkline data={c.sparkline} tone={tone} />
                )}
              </div>
              {c.note && (
                <div className="mt-1 font-serif text-[10.5px] italic text-fg-subtle">
                  {c.note}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const scorecardTemplate: TemplateSpec<ScorecardData> = {
  id: "scorecards",
  name: "Scorecards",
  icon: "📊",
  description: "KPI cards with deltas and sparklines",
  systemPrompt: SYSTEM,
  parse,
  Render: ScorecardRender,
};
