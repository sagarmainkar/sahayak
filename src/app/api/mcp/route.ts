import { NextResponse } from "next/server";
import {
  addServer,
  getStatus,
  listServers,
} from "@/lib/mcp/registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const servers = await listServers();
  const enriched = await Promise.all(
    servers.map(async (s) => {
      const { status, tools } = await getStatus(s.id);
      return {
        server: s,
        status,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
        })),
      };
    }),
  );
  return NextResponse.json({ servers: enriched });
}

export async function POST(req: Request) {
  const body = await req.json();
  const name = typeof body?.name === "string" ? body.name : "";
  if (!name) {
    return NextResponse.json(
      { error: "name is required" },
      { status: 400 },
    );
  }
  const transport =
    body?.transport === "http" || body?.transport === "stdio"
      ? body.transport
      : "stdio";

  try {
    if (transport === "http") {
      const url = typeof body?.url === "string" ? body.url.trim() : "";
      if (!url) {
        return NextResponse.json(
          { error: "url is required for http transport" },
          { status: 400 },
        );
      }
      const headers =
        body?.headers && typeof body.headers === "object"
          ? Object.fromEntries(
              Object.entries(body.headers as Record<string, unknown>).filter(
                (entry): entry is [string, string] =>
                  typeof entry[1] === "string",
              ),
            )
          : undefined;
      const server = await addServer({
        transport: "http",
        name,
        url,
        headers,
      });
      return NextResponse.json({ server });
    }

    // stdio (default)
    const command = typeof body?.command === "string" ? body.command : "";
    const args = Array.isArray(body?.args)
      ? (body.args as unknown[]).filter(
          (a): a is string => typeof a === "string",
        )
      : [];
    const env =
      body?.env && typeof body.env === "object"
        ? Object.fromEntries(
            Object.entries(body.env as Record<string, unknown>).filter(
              (entry): entry is [string, string] =>
                typeof entry[1] === "string",
            ),
          )
        : undefined;
    if (!command) {
      return NextResponse.json(
        { error: "command is required for stdio transport" },
        { status: 400 },
      );
    }
    const server = await addServer({
      transport: "stdio",
      name,
      command,
      args,
      env,
    });
    return NextResponse.json({ server });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
}
