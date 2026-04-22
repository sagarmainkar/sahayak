import {
  Clock,
  MapPin,
  Plane,
  Train,
  Car,
  Footprints,
  Ship,
  Coffee,
  Utensils,
  Bed,
  Camera,
  Sparkles,
  CalendarDays,
} from "lucide-react";
import type { TemplateSpec } from "./types";
import type { ComponentType, SVGProps } from "react";

type Transport = "flight" | "train" | "drive" | "walk" | "ferry";

type Activity = {
  time?: string;
  title: string;
  location?: string;
  description?: string;
  durationMin?: number;
  transport?: Transport;
  url?: string;
  kind?: "food" | "lodging" | "sight" | "transit" | "experience";
  /** Optional thumbnail URL — og:image or venue hero. Rendered small
   *  next to the activity row. */
  image?: string;
};

type Day = {
  date?: string;
  label?: string;
  summary?: string;
  /** Optional day-cover image — rendered as a thin banner above the
   *  day's activity list. */
  coverImage?: string;
  activities: Activity[];
};

type ItineraryData = {
  title?: string;
  destination?: string;
  days: Day[];
};

const EXAMPLE = `\`\`\`template:itinerary
{
  "title": "Kyoto · 5 day low-key itinerary",
  "destination": "Kyoto, Japan",
  "days": [
    {
      "date": "2026-05-02",
      "label": "Arrival",
      "summary": "Land, settle in, easy walk.",
      "coverImage": "https://example.com/img/kyoto-station.jpg",
      "activities": [
        { "time": "14:20", "title": "ITM → Kyoto Station", "transport": "train", "durationMin": 75, "kind": "transit" },
        {
          "time": "16:30",
          "title": "Check in, Gion guesthouse",
          "location": "Gion, Higashiyama",
          "kind": "lodging",
          "image": "https://example.com/img/gion-guesthouse.jpg"
        },
        {
          "time": "19:00",
          "title": "Dinner at Ichiran",
          "kind": "food",
          "description": "Solo-counter tonkotsu, minimal fuss.",
          "image": "https://example.com/img/ichiran-bowl.jpg"
        }
      ]
    }
  ]
}
\`\`\``;

const SYSTEM = `You can respond with a travel itinerary template when the user asks to plan a trip, generate a day-by-day plan, or structure travel logistics. Shape:

${EXAMPLE}

Rules:
- Each day: date (ISO 8601 or descriptive like "Day 1"), optional label ("Arrival", "Temple day"), 3–8 activities.
- Activities: time in 24h "HH:MM" if known; title is the important line; location optional city or venue; durationMin if > 0 (otherwise OMIT the field — do not pass 0).
- transport: "flight" | "train" | "drive" | "walk" | "ferry" — set ONLY on transit activities.
- kind: "food" | "lodging" | "sight" | "transit" | "experience" — shapes the icon.
- url: optional direct link (tickets, reservation, venue page).
- description: 1–2 short sentences. Never marketing copy.
- image: optional thumbnail URL for a single activity. Pull from web_fetch's og:image / twitter:image of the venue page, or a travel-guide article's hero image. Must be a real URL — never fabricate.
- coverImage: optional per-day banner image, same rule. Use for the "shape" of a day (e.g. a Kyoto skyline for a Kyoto day).
- Keep the plan realistic with transit buffers. Don't stack 10 activities in one day.`;

function parse(raw: unknown): ItineraryData | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const days = Array.isArray(r.days) ? r.days : null;
  if (!days) return null;
  const cleaned: Day[] = [];
  for (const d of days) {
    if (!d || typeof d !== "object") continue;
    const o = d as Record<string, unknown>;
    const acts = Array.isArray(o.activities) ? o.activities : null;
    if (!acts) continue;
    const activities: Activity[] = [];
    for (const a of acts) {
      if (!a || typeof a !== "object") continue;
      const ao = a as Record<string, unknown>;
      const title = typeof ao.title === "string" ? ao.title : null;
      if (!title) continue;
      const transport =
        ao.transport === "flight" ||
        ao.transport === "train" ||
        ao.transport === "drive" ||
        ao.transport === "walk" ||
        ao.transport === "ferry"
          ? (ao.transport as Transport)
          : undefined;
      const kind =
        ao.kind === "food" ||
        ao.kind === "lodging" ||
        ao.kind === "sight" ||
        ao.kind === "transit" ||
        ao.kind === "experience"
          ? (ao.kind as Activity["kind"])
          : undefined;
      // Drop durationMin when it's 0 — models sometimes emit 0 to mean
      // "not specified", which would otherwise render as a misleading
      // "0m" duration chip.
      const durationMin =
        typeof ao.durationMin === "number" && ao.durationMin > 0
          ? ao.durationMin
          : undefined;
      activities.push({
        time: typeof ao.time === "string" ? ao.time : undefined,
        title,
        location:
          typeof ao.location === "string" ? ao.location : undefined,
        description:
          typeof ao.description === "string" ? ao.description : undefined,
        durationMin,
        transport,
        url: typeof ao.url === "string" ? ao.url : undefined,
        kind,
        image: typeof ao.image === "string" ? ao.image : undefined,
      });
    }
    if (activities.length === 0) continue;
    cleaned.push({
      date: typeof o.date === "string" ? o.date : undefined,
      label: typeof o.label === "string" ? o.label : undefined,
      summary: typeof o.summary === "string" ? o.summary : undefined,
      coverImage:
        typeof o.coverImage === "string" ? o.coverImage : undefined,
      activities,
    });
  }
  if (!cleaned.length) return null;
  return {
    title: typeof r.title === "string" ? r.title : undefined,
    destination:
      typeof r.destination === "string" ? r.destination : undefined,
    days: cleaned,
  };
}

type IconProps = SVGProps<SVGSVGElement> & { className?: string };

function activityIcon(a: Activity): ComponentType<IconProps> {
  if (a.transport === "flight") return Plane;
  if (a.transport === "train") return Train;
  if (a.transport === "drive") return Car;
  if (a.transport === "walk") return Footprints;
  if (a.transport === "ferry") return Ship;
  if (a.kind === "food") return Utensils;
  if (a.kind === "lodging") return Bed;
  if (a.kind === "sight") return Camera;
  if (a.kind === "experience") return Sparkles;
  return Coffee;
}

function fmtDay(d: Day): string {
  if (d.date) {
    const parsed = new Date(d.date);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    }
    return d.date;
  }
  return d.label ?? "";
}

function ItineraryRender({ data }: { data: ItineraryData }) {
  return (
    <div className="my-3 not-italic">
      <div className="mb-3">
        <div className="byline mb-1 flex items-center gap-1.5">
          <CalendarDays className="h-3 w-3" />
          itinerary
          {data.destination && (
            <>
              <span className="mx-1 text-fg-subtle/60">·</span>
              <span className="flex items-center gap-0.5 text-fg-muted">
                <MapPin className="h-3 w-3" />
                {data.destination}
              </span>
            </>
          )}
        </div>
        {data.title && (
          <h3
            className="font-display text-[20px] italic leading-tight text-fg"
            style={{ fontVariationSettings: '"opsz" 144, "SOFT" 40' }}
          >
            {data.title}
          </h3>
        )}
      </div>
      <div className="relative pl-6">
        {/* vertical rail */}
        <span
          aria-hidden
          className="absolute left-[11px] top-1 h-[calc(100%-0.5rem)] w-px bg-rule"
        />
        {data.days.map((d, di) => (
          <div key={di} className="relative pb-5 last:pb-0">
            {/* day dot */}
            <span
              aria-hidden
              className="absolute -left-6 top-1 flex h-[23px] w-[23px] items-center justify-center rounded-full border border-border-strong bg-bg font-mono text-[10px] font-semibold text-fg"
            >
              {di + 1}
            </span>
            <div className="mb-2 flex items-baseline gap-2">
              <div className="font-display text-[15px] italic text-fg">
                {d.label ?? fmtDay(d)}
              </div>
              {d.label && d.date ? (
                <div className="font-mono text-[10.5px] text-fg-subtle">
                  {fmtDay(d)}
                </div>
              ) : null}
              {d.summary ? (
                <div className="ml-2 font-serif text-[12px] italic text-fg-muted">
                  {d.summary}
                </div>
              ) : null}
            </div>
            {d.coverImage ? (
              <div className="relative mb-2 h-20 overflow-hidden rounded-sm border border-border bg-bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={d.coverImage}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                  onError={(e) => {
                    (e.currentTarget.parentElement as HTMLElement).style.display = "none";
                  }}
                />
              </div>
            ) : null}
            <ul className="space-y-1.5">
              {d.activities.map((a, ai) => {
                const Icon = activityIcon(a);
                const hasImage = !!a.image;
                const body = (
                  <div className="flex items-start gap-2.5 rounded-sm border border-transparent px-2 py-1 transition-colors hover:border-border hover:bg-bg-paper/60">
                    {hasImage ? (
                      <div className="mt-[1px] h-10 w-10 flex-shrink-0 overflow-hidden rounded-sm border border-border bg-bg-muted">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={a.image}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                          onError={(e) => {
                            const el = e.currentTarget.parentElement as HTMLElement | null;
                            if (el) el.style.display = "none";
                          }}
                        />
                      </div>
                    ) : (
                      <Icon className="mt-[3px] h-3.5 w-3.5 flex-shrink-0 text-fg-subtle" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        {a.time ? (
                          <span className="font-mono text-[10.5px] text-fg-subtle">
                            {a.time}
                          </span>
                        ) : null}
                        <span className="font-sans text-[13px] text-fg">
                          {a.title}
                        </span>
                        {a.durationMin ? (
                          <span className="inline-flex items-center gap-0.5 font-mono text-[10px] text-fg-subtle">
                            <Clock className="h-2.5 w-2.5" />
                            {a.durationMin}m
                          </span>
                        ) : null}
                      </div>
                      {a.location || a.description ? (
                        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[11.5px]">
                          {a.location ? (
                            <span className="inline-flex items-center gap-0.5 font-mono text-fg-subtle">
                              <MapPin className="h-2.5 w-2.5" />
                              {a.location}
                            </span>
                          ) : null}
                          {a.description ? (
                            <span className="font-serif italic text-fg-muted">
                              {a.description}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
                return (
                  <li key={ai}>
                    {a.url ? (
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block"
                      >
                        {body}
                      </a>
                    ) : (
                      body
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export const itineraryTemplate: TemplateSpec<ItineraryData> = {
  id: "itinerary",
  name: "Itinerary",
  icon: "🗺️",
  description: "Day-by-day trip plan with transit + activities",
  systemPrompt: SYSTEM,
  parse,
  Render: ItineraryRender,
};
