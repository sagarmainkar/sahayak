import { ok, type ToolSpec } from "./types";

export const askUser: ToolSpec = {
  name: "ask_user",
  group: "interaction",
  description:
    "Ask the user a question, present options, or request clarification. " +
    "Use this when you need user input before proceeding — for example, " +
    "choosing between approaches, confirming a destructive action, or " +
    "brainstorming options together. The user will see your question and " +
    "options as an interactive prompt and can pick one or type a custom answer.",
  parameters: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "The question or prompt to show the user.",
      },
      options: {
        type: "string",
        description:
          "Comma-separated list of options to present as clickable choices. " +
          "The user can also type a custom response. Example: 'Option A, Option B, Skip'",
      },
    },
    required: ["question"],
  },
  handler: async (args) => {
    // The actual pause/resume is handled by the job runner's beforeToolCall
    // or a dedicated event. This handler is called AFTER the user responds;
    // the response is injected by the job runner before reaching here.
    // If we somehow reach here without injection, return the args as-is.
    return ok({
      question: args.question,
      options: args.options,
      note: "Awaiting user response...",
    });
  },
};
