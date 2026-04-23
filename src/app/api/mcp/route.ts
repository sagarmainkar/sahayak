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

  if (!name || !command) {
    return NextResponse.json(
      { error: "name and command are required" },
      { status: 400 },
    );
  }
  try {
    const server = await addServer({ name, command, args, env });
    return NextResponse.json({ server });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
}
