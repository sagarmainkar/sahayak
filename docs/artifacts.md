# Artifacts

Real React components rendered in a sandboxed iframe — not just markdown screenshots of components. The model writes JSX, the runtime compiles it, the panel mounts it.

## What's an artifact?

An artifact is a self-contained React component the model generates and Sahayak renders live in the right-hand panel. Unlike a screenshot or a code listing you copy-paste yourself, artifacts are interactive: the user can click tabs, adjust sliders, scroll charts, and the component re-renders. The model chooses the appropriate output format — if the answer benefits from interactivity (a dashboard, a multi-day itinerary, an interactive explainer), it opts for an artifact; if the answer is informational prose, it stays in the chat.

Artifacts differ from templates. Templates (like `template:news`) are pre-styled JSON shapes for specific repeatable output formats — the renderer in `src/lib/templates/` handles the styling. Artifacts are general-purpose React components with no predetermined structure. Inside an artifact the model can use Recharts (available as a global) and PapaParse (also global) for charting and CSV parsing respectively. Data that is too large or too dynamic to inline in JSX is fetched at runtime via `Sahayak.fetchData('<filename>')`, which routes through a `postMessage` bridge to the host. External HTTPS images (`<img src="https://...">`) are allowed and encouraged with appropriate `alt` text; loading external scripts, stylesheets, or making cross-origin `fetch()` calls from the iframe is off-policy by prompt convention.

## The pipeline

The model follows a four-step pattern to build artifacts that load backend data:

1. **`artifact_create({ id, title })`** — called once per session with a stable id (e.g. `powergrid-stock-analysis`). Subsequent revisions reuse the same id; calling `artifact_create` again returns `{status:"already_exists"}`, which is expected.
2. **`execute_command "python ..."` or equivalent** — runs a script (often using `yfinance`, `pandas`, `requests`) to fetch or compute data and write it to stdout.
3. **`artifact_write_file({ id, filename, content })`** — saves the stdout into the artifact's `files/` directory so the iframe can read it.
4. **Emit a fenced ` ```react-artifact ` block** with `// id: <same-id>` and `// title: <title>` headers. Inside `App()`, call `Sahayak.fetchData('<filename>')` to load the data at runtime.

When no external data is needed (a recipe card, an interactive explainer with hardcoded data), steps 2 and 3 are skipped and the model goes straight from step 1 to step 4.

## Examples

Six real artifacts pulled from pinned chat sessions. Each shows a different shape and a different backend.

---

### 1. Unseen Himachal Pradesh travel itinerary

**Assistant:** QWEN3.6-27B-LOCAL-LLAMA · **Backend:** llama.cpp (local gguf)
**Tools used:** `artifact_create`, `artifact_write_file`

> **Prompt:**
> create a nice itinerary of himachal pradesh unseen beautiful parts for 8 days and 9 nights. Use pictures from web , unsplash to create a beautiful visualization of what's in store

This example shows the simplest data pipeline: the model writes a rich JSON data file (`itinerary.json`) with day-by-day entries, region names, Unsplash image URLs, distances, and packing lists, saves it with `artifact_write_file`, then renders an interactive React component that loads the JSON via `Sahayak.fetchData`. Three tabs — itinerary, timeline, and packing list — let the user navigate 8 days without page reloads. It demonstrates how data-heavy content (8 days × multiple places, images, activity notes) can be cleanly separated from presentation logic, and how Unsplash images work seamlessly as long as they are HTTPS URLs with `alt` text.

<details>
<summary>Artifact source (~489 lines, key excerpt shown)</summary>

```jsx
// title: Unseen Himachal Pradesh — 8-Day Offbeat Itinerary
// id: himachal-offbeat-itinerary

const COLORS = {
  deep: "#1a1a2e", accent: "#e94560", gold: "#f5c518", sage: "#4ade80",
  sky: "#38bdf8", purple: "#a78bfa", orange: "#fb923c", bg: "#0f172a",
  card: "#1e293b", cardHover: "#334155", text: "#f1f5f9", muted: "#94a3b8", border: "#334155",
};
const DAY_COLORS = [COLORS.accent, COLORS.sage, COLORS.sky, COLORS.purple, COLORS.gold, COLORS.orange, "#f472b6", "#34d399"];

function App() {
  const [data, setData] = useState(null);
  const [activeDay, setActiveDay] = useState(0);
  const [tab, setTab] = useState("itinerary");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Sahayak.fetchData('itinerary.json').then(json => {
      setData(json);
      setLoaded(true);
    });
  }, []);

  if (!loaded || !data) return <div style={{ background: COLORS.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.text }}>Loading Himachal itinerary...</div>;

  const { tripTitle, tripSubtitle, days, packingList, bestTime, totalKm, budgetRange } = data;
  const currentDay = days[activeDay];

  return (
    <div style={{ background: `linear-gradient(135deg, ${COLORS.bg} 0%, #1e1b4b 50%, ${COLORS.deep} 100%)`, minHeight: "100vh", fontFamily: "'Segoe UI', system-ui, sans-serif", color: COLORS.text }}>
      {/* HERO — full-bleed Unsplash image with gradient overlay */}
      <div style={{ position: "relative", height: "420px", overflow: "hidden" }}>
        <img src="https://images.unsplash.com/photo-1626621351116-58e0a120867e?w=1200&q=80&auto=format" alt="Himachal Pradesh Himalayan mountains" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(15,23,42,0.3) 0%, rgba(15,23,42,0.85) 100%)" }} />
        <div style={{ position: "absolute", bottom: "40px", left: "40px", right: "40px" }}>
          <h1 style={{ fontSize: "3rem", fontWeight: 800, margin: "0 0 8px 0" }}>{tripTitle}</h1>
          <p style={{ fontSize: "1.3rem", fontWeight: 300, color: "#cbd5e1", margin: "0 0 12px 0" }}>{tripSubtitle}</p>
          {/* Quick Stats row: Duration, Distance, Best Time, Budget */}
          <div style={{ display: "flex", gap: "24px", marginTop: "20px", flexWrap: "wrap" }}>
            {[{ label: "Duration", value: "8 Days / 9 Nights", icon: "📅" }, { label: "Distance", value: totalKm, icon: "🚗" }, { label: "Best Time", value: bestTime, icon: "🌤️" }, { label: "Budget", value: budgetRange, icon: "💰" }].map((s, i) => (
              <div key={i} style={{ background: "rgba(30,41,59,0.8)", backdropFilter: "blur(10px)", borderRadius: "12px", padding: "10px 18px", border: "1px solid rgba(51,65,85,0.5)" }}>
                <div style={{ fontSize: "1.2rem" }}>{s.icon}</div>
                <div style={{ fontSize: "0.7rem", color: COLORS.muted, textTransform: "uppercase" }}>{s.label}</div>
                <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* TABS: itinerary | timeline | packing */}
      <div style={{ display: "flex", gap: "4px", padding: "16px 40px 0", borderBottom: `1px solid ${COLORS.border}` }}>
        {["itinerary", "timeline", "packing"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ background: tab === t ? "rgba(233,69,96,0.15)" : "transparent", border: "none", borderBottom: tab === t ? `3px solid ${COLORS.accent}` : "3px solid transparent", color: tab === t ? COLORS.accent : COLORS.muted, padding: "12px 20px", fontSize: "0.9rem", fontWeight: 600, cursor: "pointer", borderRadius: "8px 8px 0 0", textTransform: "capitalize", transition: "all 0.2s" }}>
            {t === "itinerary" ? "🗺️ " : t === "timeline" ? "📊 " : "🎒 "}{t}
          </button>
        ))}
      </div>

      {/* CONTENT — per-tab panels: day cards with per-day images, timeline, packing list */}
      {/* ... ~290 more lines — full source at
          .data/AAft3EmyUcIT/mnFciB7lhhOd/artifacts/himachal-offbeat-itinerary/source.jsx ... */}
    </div>
  );
}
```

</details>

---

### 2. PowerGrid stock analysis dashboard

**Assistant:** QWEN3.6-27B-LOCAL-LLAMA · **Backend:** llama.cpp (local gguf)
**Tools used:** `artifact_create`, `execute_command`, `read_file`, `web_search`

> **Prompt:**
> Assume role of a expert stock market analyzer. Create a report on PowerGrid stock based on its price movement in past 2-3 months. I would like to see the candlestick chart with other indicators. Your task is also to analyze the stock price movement and correlate with news, and provide a final conclusion with reasoning on buy, hold or sell.

This is the most complex artifact in the gallery. The model ran a Python script (`yfinance` + `pandas`) to fetch 3 months of OHLCV data for NSE:POWERGRID, compute SMA-20, SMA-50, Bollinger Bands, RSI, MACD, and volume moving average, then saved the result as `data.csv` using `artifact_write_file`. The React component loads the CSV via `Sahayak.fetchData('data.csv')`, parses it with PapaParse, and renders a four-panel dashboard: a custom candlestick chart (SVG overlaid inside Recharts `ComposedChart`), RSI, MACD, and volume panels, plus a news timeline tab and an analysis-and-verdict tab with a structured BUY/ACCUMULATE recommendation, technicals table, and fundamental highlights.

<details>
<summary>Artifact source (~494 lines, key excerpt shown)</summary>

```jsx
// title: PowerGrid Stock Analysis Dashboard
// id: powergrid-stock-analysis
import { useState, useEffect, useMemo } from 'react';
import { ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid, Area } from 'recharts';

// Hardcoded news events correlated with price action
const NEWS_EVENTS = [
  { date: '2026-02-02', title: 'Capex Guidance Raised', desc: 'FY26 capex raised to ₹32,000 cr. Stock jumped 8%.', color: '#22c55e' },
  { date: '2026-02-04', title: 'Budget 2026: ₹37,000 cr Investment', desc: 'FM proposes ₹37,000 cr for FY27.', color: '#22c55e' },
  { date: '2026-04-23', title: 'All-Time High Zone', desc: 'Trading near ₹322, near 52-week high of ₹321.75.', color: '#22c55e' },
];

function App() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showBB, setShowBB] = useState(true);
  const [showSMA20, setShowSMA20] = useState(true);
  const [showSMA50, setShowSMA50] = useState(true);
  const [activeTab, setActiveTab] = useState('chart');

  useEffect(() => {
    // Full Python pipeline: yfinance fetch → pandas compute → CSV via artifact_write_file
    Sahayak.fetchData('data.csv').then(csv => {
      const parsed = Papa.parse(csv, { header: true, dynamicTyping: true });
      const cleaned = parsed.data.map(row => ({
        ...row,
        Open: row.Open || null, High: row.High || null, Low: row.Low || null, Close: row.Close || null,
        Volume: row.Volume || 0, bullish: row.Close >= row.Open,
      }));
      setData(cleaned);
      setLoading(false);
    });
  }, []);

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 400, color: '#9ca3af' }}>Loading PowerGrid data...</div>;

  return (
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', color: '#e5e7eb', padding: '16px' }}>
      {/* Header row: logo, name, ISIN, live price, 3M/1M returns */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid #374151' }}>
        <img src="https://upload.wikimedia.org/wikipedia/en/thumb/9/9b/Power_Grid_Corporation_of_India_logo.svg/120px-Power_Grid_Corporation_of_India_logo.svg.png" alt="PowerGrid Logo" width={48} height={48} style={{ borderRadius: 8 }} />
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#fff' }}>⚡ Power Grid Corporation of India Ltd.</h1>
          <div style={{ display: 'flex', gap: 16, marginTop: 4, fontSize: 13, color: '#9ca3af' }}>
            <span>NSE: <b style={{ color: '#e5e7eb' }}>POWERGRID</b></span>
            <span>ISIN: <b style={{ color: '#e5e7eb' }}>INE752E01010</b></span>
          </div>
        </div>
      </div>

      {/* Key metrics grid: 52W high/low, P/E, EPS, Market Cap, MF/FPI holding, 3Y return */}
      {/* Tabs: 📊 Charts | 📰 News Timeline | 🎯 Analysis & Verdict */}
      {/* Chart tab: CandlestickChart (custom SVG wick+body inside ComposedChart), RSIColumn, MACDColumn, VolumeChart */}
      {/* Verdict tab: BUY/ACCUMULATE box, technicals table, fundamentals table, reasoning + risks */}

      {/* ... ~350 more lines — full source at
          .data/AAft3EmyUcIT/xzVMWR82pL9X/artifacts/powergrid-stock-analysis/source.jsx ... */}
    </div>
  );
}
```

</details>

---

### 3. Shakshuka recipe card

**Assistant:** QWEN3.6-27B-LOCAL-LLAMA · **Backend:** llama.cpp (local gguf)
**Tools used:** `artifact_create`

> **Prompt:**
> make me a recipe card for shakshuka with a hero image and an ingredient list. one cohesive react component.

The recipe card is the leanest artifact in the gallery — no data file, no `execute_command`, just `artifact_create` followed immediately by the JSX fence. It shows the external-images flow at its simplest: a single Unsplash hero image dropped straight into the component. The ingredient list uses interactive checkboxes and a live servings scaler (1–12, with proportional quantity math), so the component has stateful interactivity despite requiring no backend at all. Prep/cook time pills and a numbered step list round out a polished cooking-card layout in 171 lines.

<details>
<summary>Artifact source (~171 lines)</summary>

```jsx
// title: Shakshuka Recipe Card
// id: shakshuka-recipe-card
function App() {
  const [servings, setServings] = useState(4);
  const [checked, setChecked] = useState({});
  const baseServings = 4;
  const ratio = servings / baseServings;

  const ingredients = [
    { name: "Eggs", amount: 6, unit: "large" },
    { name: "Canned crushed tomatoes", amount: 400, unit: "g" },
    { name: "Yellow onion", amount: 1, unit: "medium" },
    { name: "Garlic cloves", amount: 3, unit: "" },
    { name: "Green bell pepper", amount: 1, unit: "medium" },
    { name: "Olive oil", amount: 2, unit: "tbsp" },
    { name: "Ground cumin", amount: 1, unit: "tsp" },
    { name: "Paprika", amount: 1, unit: "tsp" },
    { name: "Harissa paste", amount: 1, unit: "tsp" },
    { name: "Salt", amount: 1, unit: "tsp" },
    { name: "Black pepper", amount: 0.5, unit: "tsp" },
    { name: "Fresh cilantro", amount: 1, unit: "bunch" },
    { name: "Crumpled feta cheese", amount: 50, unit: "g" },
  ];

  const steps = [
    { title: "Sauté the vegetables", desc: "Heat olive oil in a large skillet over medium heat. Add diced onion and bell pepper, cook until softened (5 min). Stir in minced garlic, cumin, paprika, and harissa paste. Cook 1 minute until fragrant." },
    { title: "Build the sauce", desc: "Pour in crushed tomatoes, salt, and pepper. Simmer on medium-low for 10–15 minutes until thickened and rich." },
    { title: "Nestle the eggs", desc: "Make small wells in the sauce with a spoon. Crack an egg into each well, keeping the yolks intact." },
    { title: "Poach in the sauce", desc: "Cover and cook 5–8 minutes, until egg whites are set but yolks are still runny." },
    { title: "Garnish & serve", desc: "Sprinkle crumbled feta and fresh cilantro on top. Serve immediately with crusty bread for dipping." },
  ];

  const toggle = (idx) => setChecked(prev => ({ ...prev, [idx]: !prev[idx] }));
  const fmt = (v) => ratio === 1 ? v : Number((v * ratio).toFixed(1));

  return (
    <div style={{ maxWidth: 680, margin: "40px auto", fontFamily: "'Segoe UI', system-ui, sans-serif", background: "#fffef9", borderRadius: 20, overflow: "hidden", boxShadow: "0 8px 40px rgba(0,0,0,0.10)" }}>
      {/* Hero Image */}
      <div style={{ position: "relative", height: 360 }}>
        <img
          src="https://images.unsplash.com/photo-15259634330-dc10f6fff36d?w=800&q=80&auto=format&fit=crop"
          alt="Shakshuka — eggs poached in a vibrant spiced tomato sauce"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "linear-gradient(transparent, rgba(0,0,0,0.70))", padding: "60px 32px 24px" }}>
          <h1 style={{ color: "#fff", fontSize: 36, fontWeight: 800, margin: 0 }}>🍳 Shakshuka</h1>
          <p style={{ color: "rgba(255,255,255,0.85)", fontSize: 16, margin: "8px 0 0" }}>Eggs poached in a rich, spiced tomato &amp; pepper sauce — a North African breakfast classic.</p>
        </div>
      </div>

      {/* Meta bar: Prep 10 min | Cook 25 min | Serves N */}
      <div style={{ display: "flex", justifyContent: "space-around", padding: "16px 24px", background: "#fdf5e6", borderBottom: "1px solid #f0e0c0" }}>
        {[{ icon: "⏱", label: "Prep", val: "10 min" }, { icon: "🔥", label: "Cook", val: "25 min" }, { icon: "🍽", label: "Serves", val: `${servings}` }].map(m => (
          <div key={m.label} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 22 }}>{m.icon}</div>
            <div style={{ fontSize: 12, color: "#888", fontWeight: 600 }}>{m.label}</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{m.val}</div>
          </div>
        ))}
      </div>

      {/* Servings scaler */}
      <div style={{ padding: "16px 32px", display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "#666" }}>Serving size:</span>
        <button onClick={() => setServings(Math.max(1, servings - 1))} style={btnStyle}>−</button>
        <span style={{ fontSize: 18, fontWeight: 700, width: 30, textAlign: "center" }}>{servings}</span>
        <button onClick={() => setServings(Math.min(12, servings + 1))} style={btnStyle}>+</button>
        {ratio !== 1 && <span style={{ fontSize: 12, color: "#b8860b", fontStyle: "italic" }}>(scaled from {baseServings}×)</span>}
      </div>

      {/* Ingredient checklist with live quantity scaling */}
      <div style={{ padding: "0 32px 24px" }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: "#2d1b00", margin: "0 0 16px" }}>🧂 Ingredients</h2>
        {ingredients.map((ing, i) => {
          const isChecked = checked[i];
          return (
            <label key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderRadius: 8, cursor: "pointer", textDecoration: isChecked ? "line-through" : "none", color: isChecked ? "#888" : "#333" }}>
              <input type="checkbox" checked={!!isChecked} onChange={() => toggle(i)} style={{ accentColor: "#c0392b", width: 16, height: 16 }} />
              <span style={{ fontSize: 15, fontWeight: 500, minWidth: 130 }}>{fmt(ing.amount)} {ing.unit}</span>
              <span>{ing.name}</span>
            </label>
          );
        })}
      </div>

      {/* Numbered step instructions */}
      <div style={{ padding: "24px 32px 32px" }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: "#2d1b00", margin: "0 0 16px" }}>👩‍🍳 Instructions</h2>
        {steps.map((s, i) => (
          <div key={i} style={{ display: "flex", gap: 14, marginBottom: 16 }}>
            <div style={{ minWidth: 32, height: 32, borderRadius: "50%", background: "#c0392b", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700 }}>{i + 1}</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#2d1b00" }}>{s.title}</div>
              <div style={{ fontSize: 14, color: "#555", lineHeight: 1.55, marginTop: 4 }}>{s.desc}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ margin: "0 32px 28px", padding: "14px 18px", background: "#fff8e1", borderRadius: 10, borderLeft: "4px solid #f0c040", fontSize: 14, color: "#7a6400" }}>
        <strong>💡 Pro tip:</strong> Serve with warm crusty bread to soak up every drop of the sauce.
      </div>
    </div>
  );
}

const btnStyle = { width: 32, height: 32, borderRadius: 8, border: "1px solid #ddd", background: "#fff", fontSize: 18, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#555" };
```

</details>

---

### 4. Model architectures explainer (no artifact)

**Assistant:** QWEN3.6-35B-Local · **Backend:** Ollama (local)
**Tools used:** `recall_memory`

> **Prompt:**
> need to learn the model architectures, hybrid , attention all of that.
>
> Take me through this help me learn master the AI models so I can be crisp in talking about attention heads, MoE, calculations of VRAM etc.
>
> May be best place to start would be to thoroughly understand the attention and attention heads , K,V cache etc and then dive deeper. Big ask dont know, you are the best teacher. Use visuals to explain, be creative, feel free to search web.

Pure prose mode — no `react-artifact` fence was emitted. The model produced a multi-part long-form tutorial directly in the chat: markdown headings, a comparison table for Q/K/V matrix roles, code-style math annotations, and step-by-step derivations of the scaled dot-product attention formula. This demonstrates that artifacts are opt-in: when the Sparkles button is off, the assistant answers in rich markdown that Sahayak renders with Shiki-highlighted code, properly styled tables, and responsive heading hierarchy. For teaching topics where progressive reading beats interactive clicking, prose mode is often the right call.

<details>
<summary>Excerpt from the assistant response (~40 lines)</summary>

```markdown
# 🧠 Mastering AI Model Architectures — Let's Begin

Sagar, I'll take you from the **ground zero of attention** all the way to MoE, KV cache, and VRAM math. We'll go step by step. Let's start with the **core**.

---

## Part 1: Self-Attention — The Heart of Transformers

### The Problem Attention Solves

Before transformers, RNNs processed words one by one. They struggled with **long-range dependencies** — the word "it" at the start of a paragraph might refer to a noun 20 words back, and RNNs forgot that.

**Self-attention** solves this by letting every word "look at" every other word in the sequence simultaneously.

### The Three Magic Matrices: Q, K, V

Every input token passes through three learned linear projections:

```
Input Embedding (d_model)
├── W_Q → Query (d_model)
├── W_K → Key (d_model)
└── W_V → Value (d_model)
```

Here's **exactly what each represents**:

| Matrix | Analogy | What it does |
|--------|---------|--------------|
| **Q (Query)** | You walking into a library asking "show me books about AI" | The *probe* — what info I'm looking for |
| **K (Key)** | The library's catalog entries, each tagged with topics | The *index* — what info each token contains |
| **V (Value)** | The actual books on the shelves | The *content* — the real information to retrieve |

### The Attention Score Calculation

The magic formula — **Scaled Dot-Product Attention**:

```
Attention(Q, K, V) = softmax(Q × K^T / √d_k) × V
```

**Step 1: Dot Product Q × K^T** — Each query vector dot-products with every key vector. Result: a **score matrix** showing how much each token attends to every other.

**Step 2: Scale by √d_k** — Without scaling, dot products grow large → softmax saturates → gradients vanish.

**Step 3: Softmax** — Converts raw scores into a probability distribution (sums to 1).

**Step 4: Multiply by V** — Weighted sum of values using the attention weights.
```

</details>

---

### 5. Latest news digest (template)

**Assistant:** QWEN3.6-35B-Local · **Backend:** Ollama (local)
**Tools used:** `execute_command`, `web_search`

> **Prompt:**
> Give me latest news

The model searched the web for current headlines, then emitted a fenced ` ```template:news ` block with structured JSON rather than a `react-artifact` block. The renderer in `src/lib/templates/news.tsx` styles this JSON with categorical sections, emoji tags, thumbnail images, source attribution, and clickable URLs — a consistent visual treatment the user gets every time, regardless of which model session ran. This demonstrates that templates give repeatable format without the user having to describe layout preferences each session. See `docs/templates.md` for the full template catalogue.

<details>
<summary>Template-fill JSON excerpt (~35 lines)</summary>

```json
{
  "headline": "Top Stories · 29-Apr-2026",
  "items": [
    {
      "title": "Iran War Enters Day 60 — UAE Quits OPEC, Strait of Hormuz Still Closed",
      "summary": "The UAE announced it will withdraw from OPEC and OPEC+ this week as the Iran conflict roils energy markets and the Strait of Hormuz remains shut. Iran has submitted a revised peace proposal to end the war and reopen Hormuz without resolving nuclear issues, but the U.S. remains unenthusiastic. Brent crude hit a three-week high above $111.",
      "thumbnails": ["https://cdn.cnn.com/cnnnext/dam/assets/260428-hormuz-blockade.jpg"],
      "url": "https://www.cnn.com/2026/04/28/world/live-news/iran-war-trump-israel",
      "source": "CNN",
      "publishedAt": "2026-04-28",
      "tags": ["War", "Geopolitics", "Oil"]
    },
    {
      "title": "U.S. Cools on Iran's New Hormuz Proposal — Nuclear Sticking Point Persists",
      "summary": "Iran offered to reopen the Strait of Hormuz and end the war without settling nuclear ambitions, but Secretary of State Rubio signaled Washington won't lift its naval blockade without a definitive nuclear agreement.",
      "thumbnails": [],
      "url": "https://www.nbcnews.com/world/iran/trumpl-iran-proposal-end-war-reopen-hormuz-nuclear-deal-oil-storage-rcna342441",
      "source": "NBC News",
      "publishedAt": "2026-04-28",
      "tags": ["War", "Diplomacy", "Iran"]
    },
    {
      "title": "Sensex Surges 609 pts to 77,496 — Nifty Reaches 24,177 on Earnings & Realty Rally",
      "summary": "Indian markets rallied on April 29 with Sensex up 0.79% and Nifty up 0.76%. Realty and FMCG stocks led (+2%), while Maruti Suzuki surged 4% on strong Q4 results. The rupee hit a record closing low at 94.85/USD as oil prices surged.",
      "thumbnails": [],
      "url": "https://www.thehindubusinessline.com/markets/sensex-nifty50-today-stock-market-live-updates-29th-april-2026/article70916125.ece",
      "source": "The Hindu BusinessLine",
      "publishedAt": "2026-04-29",
      "tags": ["Markets", "NIFTY", "India"]
    }
  ]
}
```

</details>

---

### 6. DeepSeek v4 interactive explainer

**Assistant:** MiniMax · **Backend:** Ollama Cloud (`minimax-m2.7:cloud`)
**Tools used:** `artifact_create`

> **Prompt:**
> Build an interactive deepseek v4 explainer.
> click through the paper and learn about hybrid attention, muon optimizer and megaMoE kernel

A click-through interactive explainer of DeepSeek-V4's architecture covering three sections: Hybrid Attention (MLA + Sparse Rolling Attention), the Muon optimizer (Newton-Schulz orthogonal updates), and the MegaMoE kernel (expert parallelism + FP8). Each section has a key points panel, a technical parameters table, a collapsible benefits accordion, section-specific Recharts bar charts comparing performance, and an animated SVG architecture diagram that highlights the active component with a pulsing ring. This example showcases the Ollama Cloud backend — MiniMax is a hosted model, not a local gguf — but produces exactly the same artifact shape as the llama.cpp examples. Same chat surface, same `Sahayak.fetchData` bridge (unused here since all data is hardcoded), same iframe pipeline. The only difference is the upstream model server.

<details>
<summary>Artifact source (~564 lines, key excerpt shown)</summary>

```jsx
// title: DeepSeek V4 Interactive Explainer
// id: deepseek-v4-explainer
import { useState, useEffect, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const sections = [
  {
    id: 'hybrid-attention',
    title: '🔍 Hybrid Attention',
    icon: '👁️',
    description: 'Multi-head Latent Attention + Sparse Rolling Attention',
    details: {
      overview: 'DeepSeek-V4 combines Multi-head Latent Attention (MLA) with Sparse Rolling Attention to achieve both efficiency and long-context capability. MLA compresses key-value states into low-rank latent vectors, dramatically reducing memory during inference.',
      keyPoints: [
        { title: 'Multi-head Latent Attention (MLA)', desc: 'Compresses KV cache into latent space, reducing memory by 5-8x while maintaining attention quality' },
        { title: 'Context Length', desc: 'Supports up to 256K tokens context with linear complexity' },
      ],
      techDetails: [
        { param: 'Latent Dim', value: '512', impact: 'Compression ratio' },
        { param: 'Window Size', value: '4K tokens', impact: 'Local context' },
      ]
    }
  },
  // ... muon-optimizer, megaMoE sections follow same shape
];

// Recharts data for per-section performance bar charts
const attentionData = [{ name: 'MHA', memory: 100, speed: 100 }, { name: 'MLA', memory: 15, speed: 85 }];
const optimizerData = [{ name: 'AdamW', memory: 4, steps: 100 }, { name: 'Muon', memory: 2, steps: 72 }];
const moeEfficiency = [{ name: 'Naive MoE', throughput: 40 }, { name: 'MegaMoE', throughput: 95 }];

function DeepSeekV4Explainer() {
  const [activeSection, setActiveSection] = useState(0);
  const [showBenefits, setShowBenefits] = useState(false);
  const [animationProgress, setAnimationProgress] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setAnimationProgress(prev => (prev + 1) % 100), 50);
    return () => clearInterval(timer);
  }, []);

  const section = sections[activeSection];

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #312e81 100%)', padding: '24px', fontFamily: 'system-ui, sans-serif', color: '#e2e8f0' }}>
      <div style={{ textAlign: 'center', marginBottom: '32px' }}>
        <h1 style={{ fontSize: '2.5rem', fontWeight: '800', background: 'linear-gradient(135deg, #a855f7, #6366f1, #ec4899)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          🧠 DeepSeek-V4 Architecture
        </h1>
      </div>

      {/* Tab nav — 3 section buttons */}
      <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginBottom: '32px' }}>
        {sections.map((s, i) => (
          <button key={s.id} onClick={() => setActiveSection(i)} style={{ padding: '14px 24px', borderRadius: '12px', border: 'none', background: activeSection === i ? 'linear-gradient(135deg, #6366f1, #a855f7)' : 'rgba(255,255,255,0.1)', color: activeSection === i ? '#fff' : '#94a3b8', fontWeight: '600', cursor: 'pointer', transition: 'all 0.3s ease' }}>
            <span style={{ fontSize: '1.5rem', marginRight: '8px' }}>{s.icon}</span>{s.title}
          </button>
        ))}
      </div>

      {/* Main card: overview text, key points, tech params table, collapsible benefits, Recharts bar chart, animated SVG diagram */}
      {/* Prev / dot nav / Next navigation at bottom */}
      {/* ... ~380 more lines — full source at
          .data/hv_49QKaCPSu/ypsD-tuHhSjt/artifacts/deepseek-v4-explainer/source.jsx ... */}
    </div>
  );
}

function App() { return <DeepSeekV4Explainer />; }
```

</details>

---

## Adding your own artifact

Toggle artifact mode with the Sparkles button in the composer (on mobile, the + menu's "Artifact mode" item). Describe what you want — the model handles the pipeline: it creates the artifact id, optionally runs backend commands to fetch data, writes any data files, then emits the `react-artifact` fence. When you want to refine or extend an existing artifact, say so in the follow-up; the model reuses the same id and re-emits the fence rather than creating a new artifact from scratch.

## Limitations

- **Single React tree per artifact.** Each fence mounts one `function App()`. Multi-page artifacts aren't a thing — model composes them as routed sub-components inside one App.
- **No external scripts / fonts / cross-origin fetch.** Prompt-policy only (no CSP today). Bring data in via `Sahayak.fetchData()` and assets via HTTPS images per the prompt's allowlist.
- **Babel Standalone compiles JSX in-browser.** Adds ~500 KB to the iframe but lets the model emit JSX-flavored React without a build step. Production-grade artifacts that warrant precompilation aren't in scope.
- **No TypeScript in artifacts.** The compiler accepts JSX but not TS syntax. The model writes plain JS + JSX.
