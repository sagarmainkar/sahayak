import { readUpload } from "@/lib/uploads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  {
    params,
  }: {
    params: Promise<{
      assistantId: string;
      sessionId: string;
      filename: string;
    }>;
  },
) {
  const { assistantId, sessionId, filename } = await params;
  const data = await readUpload({ assistantId, sessionId }, filename);
  if (!data) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(data.buffer), {
    headers: {
      "Content-Type": data.mimeType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
