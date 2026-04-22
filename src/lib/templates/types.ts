import type { ComponentType } from "react";

export type TemplateId = string;

/**
 * A structured-output template. The model is given `systemPrompt` so it
 * knows to emit a ```template:<id>``` fence with a JSON body matching
 * `exampleJson`'s shape. The client parses the fence, validates via
 * `parse` (light duck-typing over JSON.parse), and renders.
 */
export type TemplateSpec<TData = unknown> = {
  id: TemplateId;
  name: string;
  /** Emoji or small symbol shown in the picker and composer chip. */
  icon: string;
  /** One-line description for the picker. */
  description: string;
  /** Appended to the system prompt when this template is active for a
   *  turn. Must include a literal fenced JSON example the model can copy
   *  the shape of. */
  systemPrompt: string;
  /** Validates + normalizes the parsed JSON body. Return null if the
   *  shape is too far gone to render; the fence will fall back to raw
   *  JSON code display. */
  parse: (raw: unknown) => TData | null;
  /** Renderer. Receives validated data. */
  Render: ComponentType<{ data: TData }>;
};
