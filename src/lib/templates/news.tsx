"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Newspaper } from "lucide-react";
import type { TemplateSpec } from "./types";

type NewsItem = {
  title: string;
  summary: string;
  /** 0–3 images. First one rendered largest. */
  thumbnails?: string[];
  url?: string;
  source?: string;
  publishedAt?: string;
  tags?: string[];
};

type NewsData = {
  headline?: string;
  items: NewsItem[];
};

const EXAMPLE = `\`\`\`template:news
{
  "headline": "Top AI stories · 21-Apr-2026",
  "items": [
    {
      "title": "Gemini 3 Flash & Nemotron 3 Nano reset the efficiency bar",
      "summary": "Google's Gemini 3 Flash and NVIDIA's 30B Nemotron 3 Nano came out the same week, both pitching intelligence-per-dollar over raw scale. 🚀 Early benchmarks put Flash within striking distance of GPT-5.2 at 1/10 the cost, while Nemotron 3 Nano hits 99% AIME accuracy — a signal that the next 18 months may be about efficient models, not bigger ones.",
      "thumbnails": [
        "https://example.com/img/gemini-flash.jpg",
        "https://example.com/img/nemotron.jpg"
      ],
      "url": "https://flowhunt.io/news/gemini-3-flash",
      "source": "FlowHunt",
      "publishedAt": "2025-12-01",
      "tags": ["AI", "Models", "Efficiency"]
    }
  ]
}
\`\`\``;

const SYSTEM = `You can respond with a news-brief template when the user asks for news, a round-up, headlines, or "what's new in X".

Gather source material via web_search and web_fetch as needed, then emit exactly one fenced block:

${EXAMPLE}

How to compose each item — read carefully:

- title: an EDITORIAL headline you write yourself, not a verbatim copy of the article's original title. Make it scannable and specific.
- summary: 2–4 sentences of YOUR OWN synthesis. Answer "what happened" AND "why it matters" or "what's next". Sprinkle 1–2 well-chosen emojis where they add clarity (🚀 launch · 📈 growth · ⚠ risk · 🏆 win · 💰 funding · 🔥 momentum). DO NOT copy the source's lede paragraph. This card is your composed brief, not a redirect.
- thumbnails: 0–3 image URLs, pulled from og:image / article hero images in web_fetch'd pages. First one is rendered largest. Omit entirely if you don't have real image URLs — never fabricate.
- url + source: the primary citation. Rendered as a small chip in the card footer, not as the main action. The CARD is the content; the source is just attribution.
- publishedAt: ISO 8601 date when known; omit otherwise. Never guess.
- tags: 2–5 short tags (single word where possible). Used for visual categorisation.

Style rules:
- Think "editorial brief" not "search results page". Users read the cards; they don't click through.
- Aim for 3–8 items. Fewer is fine if the story set is tight.
- Keep a 1–2 sentence lead above the fence if it sets the stage; otherwise skip the lead.
- If you can't find at least title + summary for an item, skip the item entirely rather than emit a placeholder.`;

function parse(raw: unknown): NewsData | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const items = Array.isArray(r.items) ? r.items : null;
  if (!items) return null;
  const cleaned: NewsItem[] = [];
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const title = typeof o.title === "string" ? o.title : null;
    const summary = typeof o.summary === "string" ? o.summary : null;
    if (!title || !summary) continue;
    // Accept either `thumbnails: string[]` or legacy `thumbnail: string`.
    let thumbnails: string[] | undefined;
    if (Array.isArray(o.thumbnails)) {
      thumbnails = (o.thumbnails as unknown[])
        .filter((u): u is string => typeof u === "string")
        .slice(0, 3);
      if (!thumbnails.length) thumbnails = undefined;
    } else if (typeof o.thumbnail === "string") {
      thumbnails = [o.thumbnail];
    }
    cleaned.push({
      title,
      summary,
      thumbnails,
      url: typeof o.url === "string" ? o.url : undefined,
      source: typeof o.source === "string" ? o.source : undefined,
      publishedAt:
        typeof o.publishedAt === "string" ? o.publishedAt : undefined,
      tags:
        Array.isArray(o.tags) && o.tags.every((t) => typeof t === "string")
          ? (o.tags as string[]).slice(0, 5)
          : undefined,
    });
  }
  if (!cleaned.length) return null;
  return {
    headline: typeof r.headline === "string" ? r.headline : undefined,
    items: cleaned,
  };
}

function fmtDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function hostname(url?: string): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Thumbnail stack: 1 big, 2 stacked halves, 3 = one large + two small. */
function ThumbStack({ urls }: { urls: string[] }) {
  const [broken, setBroken] = useState<Set<number>>(new Set());
  const visible = urls.filter((_, i) => !broken.has(i));
  if (!visible.length) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg-muted">
        <Newspaper className="h-6 w-6 text-fg-subtle/60" />
      </div>
    );
  }

  const mark = (i: number) =>
    setBroken((prev) => {
      const next = new Set(prev);
      next.add(i);
      return next;
    });

  /* eslint-disable @next/next/no-img-element */
  if (visible.length === 1) {
    return (
      <img
        src={visible[0]}
        alt=""
        className="h-full w-full object-cover"
        loading="lazy"
        onError={() => mark(urls.indexOf(visible[0]))}
      />
    );
  }
  if (visible.length === 2) {
    return (
      <div className="grid h-full w-full grid-rows-2 gap-[2px] bg-border">
        {visible.map((u) => (
          <img
            key={u}
            src={u}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => mark(urls.indexOf(u))}
          />
        ))}
      </div>
    );
  }
  // 3: left large + right two stacked
  return (
    <div className="grid h-full w-full grid-cols-2 gap-[2px] bg-border">
      <img
        src={visible[0]}
        alt=""
        className="h-full w-full object-cover"
        loading="lazy"
        onError={() => mark(urls.indexOf(visible[0]))}
      />
      <div className="grid grid-rows-2 gap-[2px]">
        <img
          src={visible[1]}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => mark(urls.indexOf(visible[1]))}
        />
        <img
          src={visible[2]}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => mark(urls.indexOf(visible[2]))}
        />
      </div>
    </div>
  );
  /* eslint-enable @next/next/no-img-element */
}

function NewsCard({ item }: { item: NewsItem }) {
  const host = hostname(item.url);
  const hasThumbs = !!item.thumbnails && item.thumbnails.length > 0;
  return (
    <article className="flex w-[min(560px,85vw)] flex-shrink-0 snap-start overflow-hidden rounded-sm border border-border bg-bg-paper transition-colors hover:border-border-strong">
      {hasThumbs && (
        <div className="h-[148px] w-[148px] flex-shrink-0 overflow-hidden bg-bg-muted">
          <ThumbStack urls={item.thumbnails!} />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col px-3.5 py-3">
        <h3
          className="font-display text-[15px] italic leading-tight text-fg"
          style={{ fontVariationSettings: '"opsz" 144, "SOFT" 30' }}
        >
          {item.title}
        </h3>
        <p className="mt-1.5 line-clamp-4 font-serif text-[12.5px] leading-snug text-fg-muted">
          {item.summary}
        </p>
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2 text-[10.5px]">
          {item.publishedAt && (
            <span className="font-mono text-fg-subtle">
              {fmtDate(item.publishedAt)}
            </span>
          )}
          {item.url && (item.source || host) && (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 rounded-sm border border-border bg-bg px-1.5 py-[1px] font-mono text-fg-muted hover:border-accent hover:text-fg"
            >
              {item.source ?? host}
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
          {item.tags?.slice(0, 4).map((t) => (
            <span
              key={t}
              className="rounded-sm bg-bg-muted px-1.5 py-[1px] font-mono text-[9.5px] uppercase tracking-wider text-fg-subtle"
            >
              {t}
            </span>
          ))}
        </div>
      </div>
    </article>
  );
}

function NewsRender({ data }: { data: NewsData }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateEdges = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };
  useEffect(() => {
    updateEdges();
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(updateEdges);
    ro.observe(el);
    el.addEventListener("scroll", updateEdges, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", updateEdges);
    };
  }, []);

  const scrollBy = (dir: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    // Card width + gap estimate — one card per click.
    const step = Math.min(580, el.clientWidth - 40);
    el.scrollBy({ left: dir * step, behavior: "smooth" });
  };

  const hasArrows = canLeft || canRight;

  return (
    <div className="my-3 not-italic">
      {(data.headline || hasArrows) && (
        <div className="mb-2 flex items-center gap-2">
          <div className="byline flex items-center gap-1.5">
            <Newspaper className="h-3 w-3" />
            {data.headline ?? `${data.items.length} stor${data.items.length === 1 ? "y" : "ies"}`}
          </div>
          {hasArrows && (
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={() => scrollBy(-1)}
                disabled={!canLeft}
                className="rounded-sm border border-border p-1 text-fg-subtle transition-colors hover:border-accent hover:text-fg disabled:opacity-30 disabled:hover:border-border disabled:hover:text-fg-subtle"
                aria-label="Previous"
              >
                <ChevronLeft className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => scrollBy(1)}
                disabled={!canRight}
                className="rounded-sm border border-border p-1 text-fg-subtle transition-colors hover:border-accent hover:text-fg disabled:opacity-30 disabled:hover:border-border disabled:hover:text-fg-subtle"
                aria-label="Next"
              >
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      )}
      <div
        ref={scrollRef}
        className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:thin]"
        // hint browsers to give smoother momentum on touch
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        {data.items.map((it, i) => (
          <NewsCard key={`${it.url ?? ""}-${i}`} item={it} />
        ))}
      </div>
    </div>
  );
}

export const newsTemplate: TemplateSpec<NewsData> = {
  id: "news",
  name: "News brief",
  icon: "📰",
  description: "Editorial cards with an AI-composed summary, in a carousel",
  systemPrompt: SYSTEM,
  parse,
  Render: NewsRender,
};
