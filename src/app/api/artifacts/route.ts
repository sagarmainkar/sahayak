import { NextResponse } from "next/server";
import { parse as babelParse } from "@babel/parser";
import { createArtifact } from "@/lib/artifacts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Parse the artifact JSX with Babel to catch syntax errors BEFORE the
 * iframe ever tries to transform and render. Returns a short message
 * on failure; null on success. Uses loose plugin set matching what the
 * iframe runtime accepts (JSX, optional chaining, nullish coalescing,
 * imports — runtime rewrites those, but the parser needs to accept
 * them). Doesn't catch runtime errors; those surface in the iframe.
 */
function validateJsx(source: string): string | null {
  try {
    babelParse(source, {
      sourceType: "module",
      errorRecovery: false,
      plugins: ["jsx", "typescript"],
    });
    return null;
  } catch (e) {
    const err = e as Error & {
      loc?: { line: number; column: number };
      reasonCode?: string;
    };
    const loc = err.loc ? ` (line ${err.loc.line}:${err.loc.column})` : "";
    const msg = String(err.message ?? "syntax error").replace(
      /^SyntaxError:\s*/,
      "",
    );
    return `${msg}${loc}`;
  }
}

export async function POST(req: Request) {
  const body = await req.json();
  if (!body.source || typeof body.source !== "string") {
    return NextResponse.json({ error: "source required" }, { status: 400 });
  }
  if (!body.assistantId || !body.sessionId) {
    return NextResponse.json(
      { error: "assistantId and sessionId are required" },
      { status: 400 },
    );
  }
  const validationError = validateJsx(body.source);
  if (validationError) {
    return NextResponse.json(
      { error: "validation_failed", message: validationError },
      { status: 422 },
    );
  }
  const a = await createArtifact(
    { assistantId: body.assistantId, sessionId: body.sessionId },
    {
      id: body.id,
      title: body.title ?? "Untitled",
      source: body.source,
    },
  );
  return NextResponse.json({ artifact: a });
}
