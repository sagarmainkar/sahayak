import { itineraryTemplate } from "./itinerary";
import { newsTemplate } from "./news";
import { scorecardTemplate } from "./scorecard";
import type { TemplateSpec } from "./types";

export type { TemplateSpec };

export const TEMPLATES: TemplateSpec<unknown>[] = [
  newsTemplate as TemplateSpec<unknown>,
  scorecardTemplate as TemplateSpec<unknown>,
  itineraryTemplate as TemplateSpec<unknown>,
];

export const TEMPLATES_BY_ID = Object.fromEntries(
  TEMPLATES.map((t) => [t.id, t]),
) as Record<string, TemplateSpec<unknown>>;

/**
 * Public metadata (no prompt text, no renderer) for the Composer picker
 * and the TemplateChip. Stays client-safe: renderers are imported
 * directly where rendered; this just lists available templates.
 */
export const TEMPLATE_META = TEMPLATES.map((t) => ({
  id: t.id,
  name: t.name,
  icon: t.icon,
  description: t.description,
}));
