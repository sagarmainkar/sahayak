import { readDataFile } from "@/lib/artifacts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; filename: string }> },
) {
  const { id, filename } = await params;
  const d = await readDataFile(id, filename);
  if (!d) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(d.buffer), {
    headers: {
      "Content-Type": d.mimeType,
      "Cache-Control": "no-store",
    },
  });
}
