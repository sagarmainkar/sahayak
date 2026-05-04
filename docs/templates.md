# Templates

Pre-styled JSON shapes for repeatable formats. Distinct from [artifacts](artifacts.md): templates lock in a layout the renderer styles consistently; artifacts are bespoke React the model writes from scratch.

## When to use a template vs an artifact

- **Template** for a shape you'd want again — news digest, itinerary, scorecard. Consistent visual treatment, no JSX from the model. Built-ins are the only ones today; adding a new template means writing a renderer (small TSX file).
- **Artifact** for one-offs and interactive components — dashboards, custom visualizations, click-through explainers. Model writes JSX; the runtime compiles and mounts.

A scorecard for "compare these 5 phones" is a template; a live filterable table of those phones is an artifact.

## How a template works

1. The user selects a template from the composer (template picker icon — appears when at least one template exists in the session).
2. The selected template's name + JSON schema gets appended to the system prompt for that turn only.
3. The model emits a fenced block: ` ```template:<id>\n{...json...}\n``` `.
4. The renderer in [`src/lib/templates/<id>.tsx`](../src/lib/templates/) parses the JSON and styles it.
5. Fall-through: if the model fails to emit a valid template fence (or the JSON doesn't match the schema), the renderer surfaces a parse error inline; the user can ask for a retry.

## Built-in templates

### `news` — categorical digest

Source: [`src/lib/templates/news.tsx`](../src/lib/templates/news.tsx).

Renders a horizontal carousel of editorial news cards. Each card pairs a thumbnail stack (up to 3 images in a mosaic layout, with a styled fallback when none are available) with an AI-composed headline, a 2–4 sentence synthesis, and attribution chips. A typical use: "What happened in AI this week?" — the model runs `web_search`, composes its own summary for each story (never copy-pastes ledes), and collects `og:image` URLs via `web_fetch` for the thumbnails.

JSON shape:

```ts
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
```

### `itinerary` — day-by-day travel plan

Source: [`src/lib/templates/itinerary.tsx`](../src/lib/templates/itinerary.tsx).

Renders a vertical timeline with numbered day nodes connected by a rail line. Each day can show an optional cover-image banner, a date + label header, and a list of activity rows. Activity rows use kind-based icons (food, lodging, sight, transit, experience) or transport icons (flight, train, drive, walk, ferry), and can carry a small thumbnail, a 24h time chip, a duration chip, a location tag, and a short description. A typical use: "Plan me 5 days in Kyoto" — the model structures each day with realistic transit buffers and 3–8 activities.

JSON shape:

```ts
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
```

### `scorecards` — KPI metric grid

Source: [`src/lib/templates/scorecard.tsx`](../src/lib/templates/scorecard.tsx).

Renders a responsive auto-fit grid of metric cards. Each card has a coloured left-border tone bar (good / warn / bad / neutral), a large italic value with an optional unit, a delta pill showing directional change with an up/down arrow, an optional sparkline polyline, and an optional footnote. The tone colours the delta pill and sparkline independently of the delta's sign — rising churn is `"bad"` even though the number went up. A typical use: "Show me our Q1 KPIs" or "how's the site doing?" — the model picks 2–6 cards and assigns tones based on what the numbers mean.

Note: the template id in the fence is `scorecards` (plural), matching the `id` field in the spec.

JSON shape:

```ts
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
```

## Adding your own template

Three steps:

1. **Write a renderer.** Create `src/lib/templates/<id>.tsx` exporting a `function MyTemplate({ data }: { data: MyShape }) { ... }`. Style it however you want — the file is plain React with Tailwind.
2. **Register it.** Add an entry to [`src/lib/templates/index.ts`](../src/lib/templates/index.ts): import your exported `TemplateSpec` and append it to the `TEMPLATES` array. The spec must include `id`, `name`, `icon` (an emoji), `description`, `systemPrompt`, `parse`, and `Render`.
3. **Write the system prompt.** The `systemPrompt` field on your `TemplateSpec` is appended to the system prompt for the turn the template is active. Include a literal fenced JSON example (` ```template:<id> `) so the model knows exactly what shape to emit.

The composer picker auto-discovers all entries in `TEMPLATES`; no further wiring needed.

For a working example, copy `news.tsx` and adapt — it's the simplest of the three.
