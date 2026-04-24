import { NextResponse } from "next/server";
import { saveUpload, PdfEncryptedError } from "@/lib/uploads";
import { isValidIdSegment } from "@/lib/paths";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB — docs can be larger than images

export async function POST(req: Request) {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "expected multipart/form-data" },
      { status: 400 },
    );
  }
  const form = await req.formData();
  const file = form.get("file");
  const password = form.get("password");
  const assistantId = form.get("assistantId");
  const sessionId = form.get("sessionId");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  if (
    typeof assistantId !== "string" ||
    typeof sessionId !== "string" ||
    !isValidIdSegment(assistantId) ||
    !isValidIdSegment(sessionId)
  ) {
    return NextResponse.json(
      { error: "assistantId and sessionId (form fields) are required" },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `max ${MAX_BYTES} bytes, got ${file.size}` },
      { status: 413 },
    );
  }
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const up = await saveUpload(
      { assistantId, sessionId },
      buf,
      file.type || "",
      file.name,
      typeof password === "string" && password.length ? password : undefined,
    );
    return NextResponse.json({ attachment: up });
  } catch (e) {
    if (e instanceof PdfEncryptedError) {
      return NextResponse.json(
        {
          error: e.badPassword ? "pdf_bad_password" : "pdf_encrypted",
          message: e.badPassword
            ? "The password didn't unlock the PDF. Try again."
            : "This PDF is password-protected. Provide a password to unlock.",
          filename: file.name,
        },
        { status: e.badPassword ? 400 : 401 },
      );
    }
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
}
