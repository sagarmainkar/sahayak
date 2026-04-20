import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Unfurled = {
  url: string;
  title: string;
  description: string;
  image: string | null;
  favicon: string;
  domain: string;
};

const cache = new Map<string, { ts: number; data: Unfurled | null }>();
const TTL = 1000 * 60 * 30; // 30 min

function pick(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m?.[1] ? decodeEntities(m[1].trim()) : null;
}

function decodeEntities(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

async function unfurl(url: string): Promise<Unfurled | null> {
  try {
    const u = new URL(url);
    const favicon = `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=64`;
    const domain = u.hostname.replace(/^www\./, "");

    // If the URL itself points at an image (by file extension), short-circuit.
    if (/\.(png|jpe?g|gif|webp|avif|svg|bmp)(\?|#|$)/i.test(u.pathname)) {
      return {
        url,
        title: u.pathname.split("/").filter(Boolean).pop() ?? u.hostname,
        description: "",
        image: url,
        favicon,
        domain,
      };
    }

    const r = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Sahayak/1.0; +https://localhost)",
        Accept: "text/html,application/xhtml+xml,image/*;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;

    const ct = (r.headers.get("content-type") ?? "").toLowerCase();
    // Non-HTML responses: if image, use URL as thumbnail; else bail politely.
    if (ct.startsWith("image/")) {
      // consume body to let keep-alive reuse the socket
      try {
        await r.body?.cancel();
      } catch {}
      return {
        url,
        title: u.pathname.split("/").filter(Boolean).pop() ?? u.hostname,
        description: "",
        image: url,
        favicon,
        domain,
      };
    }
    if (!ct.includes("html")) {
      try {
        await r.body?.cancel();
      } catch {}
      return {
        url,
        title: u.hostname,
        description: "",
        image: null,
        favicon,
        domain,
      };
    }

    const html = (await r.text()).slice(0, 150_000);
    const title =
      pick(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ??
      pick(html, /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i) ??
      pick(html, /<title[^>]*>([^<]+)<\/title>/i) ??
      u.hostname;
    const description =
      pick(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ??
      pick(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ??
      pick(html, /<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["']/i) ??
      "";
    let image =
      pick(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
      pick(html, /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
    if (image && image.startsWith("//")) image = `${u.protocol}${image}`;
    else if (image && image.startsWith("/")) image = `${u.origin}${image}`;

    return {
      url,
      title: title.slice(0, 180),
      description: description.slice(0, 300),
      image: image ?? null,
      favicon,
      domain,
    };
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get("url");
  if (!url) return NextResponse.json({ error: "url required" }, { status: 400 });
  try {
    new URL(url);
  } catch {
    return NextResponse.json({ error: "bad url" }, { status: 400 });
  }
  const hit = cache.get(url);
  if (hit && Date.now() - hit.ts < TTL) {
    return NextResponse.json({ data: hit.data });
  }
  const data = await unfurl(url);
  cache.set(url, { ts: Date.now(), data });
  return NextResponse.json({ data });
}
