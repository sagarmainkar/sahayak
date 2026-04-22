import { ExternalLink, Newspaper } from "lucide-react";
import type { TemplateSpec } from "./types";

type NewsItem = {
  title: string;
  url?: string;
  source?: string;
  publishedAt?: string;
  summary?: string;
  thumbnail?: string;
  tags?: string[];
};

type NewsData = {
  headline?: string;
  items: NewsItem[];
};

const EXAMPLE = `\`\`\`template:news
{
  "headline": "Top AI stories · 2026-04-22",
  "items": [
    {
      "title": "Anthropic releases Claude 4.7",
      "url": "https://example.com/claude-4-7",
      "source": "Anthropic",
      "publishedAt": "2026-04-21",
      "summary": "New Opus and Sonnet variants focus on agentic benchmarks and prompt-cache-retention guarantees.",
      "thumbnail": "https://example.com/img/c47.jpg",
      "tags": ["models", "agents"]
    }
  ]
}
\`\`\``;

const SYSTEM = `You can respond with a news-brief template when the user asks for news, a round-up, headlines, or "what's new in X".

To use it, first gather source material via web_search and web_fetch as needed, then emit a fenced block:

${EXAMPLE}

Rules:
- Emit the fence as the PRIMARY body of your response. A 1–2 sentence lead above the fence is fine; avoid a long intro.
- Each item needs a title and a url. source, publishedAt (ISO date), summary, thumbnail, tags are optional but recommended.
- Keep the list to 4–12 items unless the user asks otherwise.
- Prefer real thumbnail URLs pulled from web_fetch'd pages (og:image or article-lead-image meta). If none, omit the field.
- summary: 1–2 sentences, neutral tone, no marketing language.
- publishedAt: ISO 8601 date when known; leave undefined otherwise — never fabricate.`;

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
    if (!title) continue;
    cleaned.push({
      title,
      url: typeof o.url === "string" ? o.url : undefined,
      source: typeof o.source === "string" ? o.source : undefined,
      publishedAt:
        typeof o.publishedAt === "string" ? o.publishedAt : undefined,
      summary: typeof o.summary === "string" ? o.summary : undefined,
      thumbnail:
        typeof o.thumbnail === "string" ? o.thumbnail : undefined,
      tags:
        Array.isArray(o.tags) && o.tags.every((t) => typeof t === "string")
          ? (o.tags as string[])
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
    year: "numeric",
    month: "short",
    day: "numeric",
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

function NewsCard({ item }: { item: NewsItem }) {
  const hasThumb = !!item.thumbnail;
  const host = hostname(item.url);
  const body = (
    <>
      <div className="relative aspect-[16/9] overflow-hidden rounded-t-sm border-b border-border bg-bg-muted">
        {hasThumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.thumbnail}
            alt=""
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            loading="lazy"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Newspaper className="h-8 w-8 text-fg-subtle/60" />
          </div>
        )}
        {item.source && (
          <span className="absolute bottom-1.5 left-1.5 rounded bg-bg-paper/90 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted backdrop-blur-[2px]">
            {item.source}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col px-3 py-2.5">
        <h3
          className="font-display text-[15.5px] italic leading-snug text-fg"
          style={{ fontVariationSettings: '"opsz" 144, "SOFT" 30' }}
        >
          {item.title}
        </h3>
        {item.summary && (
          <p className="mt-1.5 line-clamp-3 font-serif text-[12.5px] leading-snug text-fg-muted">
            {item.summary}
          </p>
        )}
        <div className="mt-auto flex items-center gap-2 pt-2 text-[10.5px] text-fg-subtle">
          {item.publishedAt && (
            <span className="font-mono">{fmtDate(item.publishedAt)}</span>
          )}
          {item.publishedAt && host && <span>·</span>}
          {host && (
            <span className="truncate font-mono">
              {host}
              <ExternalLink className="ml-1 inline h-2.5 w-2.5" />
            </span>
          )}
        </div>
        {item.tags && item.tags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {item.tags.slice(0, 4).map((t) => (
              <span
                key={t}
                className="rounded-sm border border-border bg-bg-paper/60 px-1.5 py-[1px] font-mono text-[9.5px] uppercase tracking-wider text-fg-subtle"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </>
  );
  const cardCls =
    "group flex flex-col overflow-hidden rounded-sm border border-border bg-bg-paper transition-all hover:border-accent/60 hover:shadow-[0_4px_16px_-8px_rgb(0_0_0/0.18)]";
  if (item.url) {
    return (
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        className={`${cardCls} cursor-pointer`}
      >
        {body}
      </a>
    );
  }
  return <div className={cardCls}>{body}</div>;
}

function NewsRender({ data }: { data: NewsData }) {
  return (
    <div className="my-3 not-italic">
      {data.headline && (
        <div className="byline mb-2 flex items-center gap-1.5">
          <Newspaper className="h-3 w-3" />
          {data.headline}
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {data.items.map((it, i) => (
          <NewsCard key={it.url ?? i} item={it} />
        ))}
      </div>
    </div>
  );
}

export const newsTemplate: TemplateSpec<NewsData> = {
  id: "news",
  name: "News brief",
  icon: "📰",
  description: "Search recent stories and render a scannable card grid",
  systemPrompt: SYSTEM,
  parse,
  Render: NewsRender,
};
