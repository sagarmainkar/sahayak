# Mobile UI polish: bugs + responsive type pass

**Date:** 2026-04-30
**Scope:** Mobile-viewport fixes + a unified responsive type scale across the chat surface. Touches `src/app/globals.css`, `src/app/layout.tsx`, four components ([Header.tsx](src/components/Header.tsx), [Composer.tsx](src/components/Composer.tsx), [ArtifactPanel.tsx](src/components/ArtifactPanel.tsx), [Markdown.tsx](src/components/Markdown.tsx)), and the [ContextPie.tsx](src/components/ContextPie.tsx) popover anchoring. Out of scope: any of the other open-source-prep items (outputs dir, artifact image allowlist, README, peer-agent, memory). Memory work landed previously on this branch and is unrelated.

## Problem

The app reads as broken on a phone:

1. **Header overflows** at 375px. The title plus seven 28×28 icons plus gaps total ~388px, more than the viewport. The context-pie button gets clipped — visually pushed against neighboring icons or the page edge — and is hard to tap.
2. **Tables distort.** With no mobile-specific rules, narrow columns squeeze each value into character-by-character vertical stacks (e.g. `On / ho / ld` for "On hold"). The user explicitly does NOT want horizontal scroll as a fix.
3. **Composer eats vertical real estate.** The textarea + Paperclip + Sparkles + template chips + Send row consumes ~30–40% of visible height before the user types anything.
4. **Artifact panel screenshot button is broken**, and on mobile clicking Screenshot or Ask-to-fix should automatically close the panel and return to the chat.
5. **Top bar gets covered by mobile-browser chrome.** When the URL bar collapses/expands, the header ends up either hidden behind it or content disappears under the bottom of the viewport. Classic `100vh` vs. dynamic-viewport issue.
6. **Tap targets are stingy.** Header chrome icons are 28×28; Apple HIG recommends 44×44 minimum.

The user is not a UI expert and explicitly asked for "judgment calls" on the visual specifics; the design below is opinionated within that mandate.

## Goal

Sahayak feels like a real mobile app on a phone: tables read cleanly, the composer gets out of the way, the header doesn't overflow, the address bar doesn't fight the layout, and tap targets meet platform conventions. Desktop behavior is unchanged.

## Non-goals

- Tablet-specific layouts. The breakpoint is binary (< 640px vs. ≥ 640px) — phones get the new behaviors, anything wider keeps today's UI verbatim.
- A swipe-to-close gesture on the artifact bottom sheet. Tap-to-close on the drag handle is enough for v1.
- Code-block typography overhaul. Code blocks inherit the new mono scale token but no other treatment changes.
- Settings / Memory / Stats page audits. The user explicitly said they hadn't checked them; if they need work it's a separate spec.
- Replacing the hand-rolled `.prose` block with `@tailwindcss/typography`. The hand-rolled prose is part of the design language per CLAUDE.md.

## Design

### 1. Layout root: `100dvh` + safe area

In [src/app/layout.tsx](src/app/layout.tsx), the root element switches from `min-h-screen` (which compiles to `min-height: 100vh`) to a class or inline rule equivalent to `min-height: 100dvh`. Tailwind 4 supports `min-h-dvh` directly.

Add `padding-top: env(safe-area-inset-top)` to the sticky header so it sits below the iOS notch / Dynamic Island. Add `padding-bottom: env(safe-area-inset-bottom)` to the chat scroll container so the composer + artifact-sheet handle don't sit under the iOS home indicator.

### 2. Type scale (CSS custom properties)

At the top of [src/app/globals.css](src/app/globals.css), introduce six fluid scale tokens:

```css
:root {
  --fs-prose:    clamp(13px,    0.6vw + 12px, 14.5px);
  --fs-byline:   clamp(10.5px,  0.3vw + 10px, 11px);
  --fs-h3:       clamp(16px,    1vw + 14px,   20px);
  --fs-h2:       clamp(18px,    1.5vw + 14px, 24px);
  --fs-h1:       clamp(24px,    3vw + 18px,   40px);
  --fs-mono:     clamp(12px,    0.5vw + 11px, 13px);
}
```

The `clamp(min, fluid, max)` form means a 320px viewport gets the lower bound, a 1024px viewport gets the upper, smooth in between — no breakpoint cliffs and no JavaScript.

Update the existing `.prose` block in `globals.css` so its `font-size`, `h1/h2/h3`, `code`, `table`, and `.byline` rules consume these tokens instead of literal pixel values. The literal `text-[Npx]` Tailwind utilities scattered through chrome components (buttons, label pills, numeric stats) stay as-is — those don't need to scale per breakpoint.

### 3. Header (kebab pattern)

[src/components/Header.tsx](src/components/Header.tsx) gains a `sm:`-gated layout:

- **`sm:` and up (≥ 640px):** unchanged — Sahayak title, ContextPie in the children slot, then Memory / Stats / Settings / StyleSwitcher / ThemeToggle.
- **Below 640px:** title + ContextPie + ThemeToggle + a single `⋮` kebab button. The kebab opens a `createPortal` popover (mirror the existing pattern in [ContextPie.tsx](src/components/ContextPie.tsx)) listing Memory / Stats / Settings / Style as menu items with their lucide icons. Tap-outside or item-tap closes it.

Header is `position: sticky; top: 0` with the safe-area padding from §1. With the `100dvh` root fix, sticky behavior is consistent through browser-chrome show/hide.

ContextPie's existing popover positioning is correct math; no change needed there. The clipping was the *button* itself being squeezed by overflow, which the kebab pattern eliminates.

### 4. Composer (`+` action menu)

[src/components/Composer.tsx](src/components/Composer.tsx) gains the same `sm:` switch:

- **`sm:` and up:** unchanged — full toolbar (Paperclip, Sparkles, template chips, Send).
- **Below 640px:** single row — `[+ button] · [textarea] · [Send]`. Tap `+` → popover opens above the composer with three items: **Attach file** (forwards to today's Paperclip handler), **Artifact mode** (toggles today's Sparkles state), **Templates** (opens today's template picker UI, just relocated).

Behavior:

- Textarea is `min-height: 36px` (one line) when empty, expands as the user types, capped at ~5 lines then internal scroll.
- The `+` button shows a small accent dot when artifact mode is on, so the user can tell at a glance without opening the menu.
- Send is a circular icon button right of the textarea.
- The popover dismisses on outside-tap or after a menu item is chosen.

### 5. Tables (hybrid card/table on mobile)

CSS-only transformation in [src/app/globals.css](src/app/globals.css), driven by a single attribute set in [src/components/Markdown.tsx](src/components/Markdown.tsx).

In `Markdown.tsx`, the `table` component override counts the header cells (`<th>` count of the first row) and adds `data-cols="3+"` when the count is ≥ 3. Default attribute is `data-cols="2"`.

In `globals.css`, inside a `@media (max-width: 640px)` block:

- `.prose table[data-cols="2"]` — keep the `<table>` element, tighten cell padding, shrink type to `--fs-prose` clamp's lower end. Reads cleanly on a phone.
- `.prose table[data-cols="3+"]` — flip to a card-stack via `display: block` on the table, `display: block` + border + padding on each `<tr>`, `display: block` on each `<td>`. Each `<td>` shows its column label via a CSS `::before` rule that reads the `data-label` attribute (e.g. `td::before { content: attr(data-label) ": "; ... }`).

The `data-label` attribute is set in `Markdown.tsx`. Implementation: when overriding the `table` component, walk children to capture the `<th>` texts of the first row (headers) into a small array, then render `<tbody>` with a React Context provider that exposes `(rowChildren) => mappedChildren` — the `<td>` override looks up its column index from the surrounding `<tr>` order and pulls `headers[i]` to inject `data-label`. Single React Context, scoped per table render, no global state.

The model writes plain `| col | col |` markdown; the renderer adapts.

### 6. Artifact panel (bottom sheet on mobile)

[src/components/ArtifactPanel.tsx](src/components/ArtifactPanel.tsx) gains a `sm:`-gated rendering branch:

- **`sm:` and up:** unchanged — the existing `<aside>` sidebar pattern.
- **Below 640px:** fixed-position bottom sheet at `bottom: 0`, height `~80dvh`, anchored to the right edge of the viewport. CSS-driven transform on a `data-state="open|closed"` attribute (Tailwind 4 `transition-transform`). The current `iframeRef`, `srcDoc`, and source-toggle behavior stay identical — only the chrome around the iframe changes.

Closing behavior:

- A drag-handle visual at the top of the sheet is a tappable button that dispatches close.
- Tapping the chat area above the sheet also closes it. Implementation: a transparent full-viewport overlay sits at a `z-index` between the chat (low) and the sheet (high) — taps on the overlay call `close()`; the sheet itself is above the overlay so taps inside the sheet pass through to its content.
- **Tapping Screenshot or Ask-to-fix dispatches close *after* the action fires.** The user lands back in the chat where the resulting tool-call turn is rendering.
- A swipe-down gesture is **not** in v1.

### 7. Screenshot bug investigation

The Screenshot button is broken (per user report). Root-cause investigation, then fix:

- Confirm the iframe's sandbox attributes are `allow-scripts allow-same-origin` (verified in [src/components/ArtifactPanel.tsx:431](src/components/ArtifactPanel.tsx#L431) at brainstorming time — but worth re-confirming the canvas capture path doesn't trip a CORS/tainted-canvas issue).
- The capture call at [src/components/ArtifactPanel.tsx:49](src/components/ArtifactPanel.tsx#L49) reaches into `iframe?.contentDocument`. Guard it on `iframeReady && contentDocument && !contentDocument.body?.classList.contains("err")` to avoid trying to capture a render-error state.
- When capture fails, surface a one-line toast (the project doesn't appear to have a toast system today; settle for an inline `<div role="alert">` near the artifact-panel header that disappears after 4s) instead of the silent `console.error` at line 53.
- File any deeper issues (e.g. SVG `foreignObject` capture quirks) as follow-ups; if a 30-minute fix doesn't land it, revert to the silent-fail behavior so the rest of the panel remains usable.

### 8. Tap targets

Mechanical sweep:

- Header chrome icons (Memory / Stats / Settings / StyleSwitcher / ThemeToggle) and ContextPie button: change `h-7 w-7` (28×28) → `h-10 w-10` (40×40), keep the lucide icon at `h-3.5 w-3.5` (14×14) visually centered. The hover/focus background ring already uses `rounded` so it scales naturally.
- Same change to the kebab `⋮` button added in §3.
- Composer's `+`, Send, and any toolbar buttons exposed in the popover: 40×40 hit area.

Desktop layout-shift consequence: the header chrome row gets ~12px taller. Acceptable, even visually nicer.

## Risks and trade-offs

**Two visual languages for tables.** 2-col tables stay tabular; 3+col flip to cards. Mixed in the same scrollback. Mitigation: this is intentional — the alternative is "everything is cards" which loses scannability of key/value tables, or "everything is a small-font table" which loses readability of wide tables. The user signed off after seeing both alternatives mocked.

**Breakpoint is binary at 640px.** A 600px iPad mini in landscape, or a 640px split-view, will see the desktop layout. We accept this; tablet-specific tuning is a future spec if pain emerges.

**`100dvh` not supported on older Safari.** Below iOS 15.4 it falls back to `100vh` and the bug recurs. Sahayak doesn't claim to support older browsers and we accept this gracefully.

**Card-stack `data-cols="3+"` requires a small JSX change.** The CSS can't introspect column counts without help. The `Markdown.tsx` change is a few lines but introduces a tiny ad-hoc state for "current table headers" so each `<td>` knows its column label. Risk: nested tables would break the state. Mitigation: chat-emitted markdown rarely nests tables; if it ever does, the inner table just renders without a column label — degraded but not broken.

**Bottom sheet interferes with on-screen keyboards on iOS.** When the user taps an input inside the artifact (some artifacts are interactive forms), iOS will float the keyboard over the bottom of the sheet. Mitigation: the sheet auto-resizes to `max-height: 80dvh` and the iframe is internally scrollable, so the user can still reach the input. Acceptable v1.

## Verification

There is no test suite. Verification is manual via `npm run dev` and a phone (or browser devtools at iPhone 12 / iPhone SE viewports):

1. Open the chat at iPhone SE width (375px). Confirm the header shows title + context pie + theme + kebab — no clipping. Tap the kebab; Memory/Stats/Settings/Style options appear and route correctly.
2. Tap the context pie; popover opens within viewport bounds, shows compact / export options, all readable.
3. Send a message that produces a 3-column markdown table. Confirm it renders as cards with column labels visible inline (e.g. "Metric: FY2026 Growth").
4. Send a message that produces a 2-column key/value table. Confirm it stays as a tight table.
5. Confirm composer is one row when idle (no Paperclip/Sparkles/templates visible). Tap `+`; popover shows three items. Toggle Artifact mode; confirm the `+` button shows the accent dot. Tap an item; confirm the action fires and the popover dismisses.
6. Open an artifact card; the bottom sheet slides up. Tap the drag handle; sheet closes. Re-open; tap Screenshot — sheet closes and (a) screenshot succeeds *or* (b) an inline error toast appears (no silent failure).
7. Scroll the chat. Confirm the header doesn't disappear under the URL bar; the composer stays anchored above the home-indicator area.
8. At desktop width (≥ 640px), the chat looks identical to today's behavior. No regressions.
9. Tap-target check: header icons, theme toggle, style switcher all hit-test cleanly with a finger (≥ 40px).

## What changes, file by file

- **`src/app/layout.tsx`** — `min-h-screen` → `min-h-dvh` on the root; safe-area padding for header sticky and chat scroll bottom.
- **`src/app/globals.css`** — six new `--fs-*` tokens at `:root`; `.prose` rules consume them; new `@media (max-width: 640px)` block for `.prose table[data-cols="2"]` and `.prose table[data-cols="3+"]` card-stack transformation; safe-area helper if needed.
- **`src/components/Header.tsx`** — `sm:` switch between current row and the new mobile row (title + ContextPie + ThemeToggle + kebab); kebab popover component (or inline `createPortal` mirroring ContextPie).
- **`src/components/Composer.tsx`** — `sm:` switch between current toolbar and the mobile single row (`+` button + textarea + Send); `+` popover with Attach / Artifact mode / Templates; accent-dot indicator on `+` when artifact mode is on.
- **`src/components/ArtifactPanel.tsx`** — `sm:` branch for sheet vs. sidebar; sheet uses `data-state` + Tailwind `transition-transform`; tap-handle and tap-outside both call close; Screenshot and Ask-to-fix handlers fire `close()` after their action; investigate + fix the screenshot capture bug; inline alert on capture failure.
- **`src/components/Markdown.tsx`** — `table` component override sets `data-cols="2"` or `data-cols="3+"`; `td` override surfaces the parent header text via `data-label` for the card-stack pattern.
- **Tap-target sweep** — `h-7 w-7` → `h-10 w-10` on icon buttons in [Header.tsx](src/components/Header.tsx), [ContextPie.tsx](src/components/ContextPie.tsx), [ThemeToggle.tsx](src/components/ThemeToggle.tsx), [StyleSwitcher.tsx](src/components/StyleSwitcher.tsx), and the new mobile kebab + composer `+` / Send buttons.

## Open items intentionally deferred

- Settings / Memory / Stats / Artifact-source-view page audits (separate spec if needed).
- Swipe-to-close gesture on the artifact bottom sheet.
- Tablet-specific layouts (we treat ≥ 640px as "desktop").
- Code-block typography beyond the `--fs-mono` adoption.
- A real toast system (this spec uses an inline alert as a one-off).
