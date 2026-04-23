"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Header } from "@/components/Header";
import { AssistantCard } from "@/components/AssistantCard";
import type { Assistant } from "@/lib/types";

export default function Home() {
  const [assistants, setAssistants] = useState<Assistant[] | null>(null);

  async function load() {
    const r = await fetch("/api/assistants");
    const j = (await r.json()) as { assistants: Assistant[] };
    setAssistants(j.assistants);
  }

  useEffect(() => {
    load();
  }, []);

  async function del(id: string) {
    if (!confirm("Delete this assistant and all its chats?")) return;
    await fetch(`/api/assistants/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div>
            <div className="byline">your assistants</div>
            <h1
              className="mt-1 font-display text-[30px] italic leading-[1.05] text-fg sm:text-[42px] sm:leading-none"
              style={{ fontVariationSettings: '"opsz" 144, "SOFT" 60' }}
            >
              Who shall we talk to?
            </h1>
          </div>
          <Link
            href="/assistants/new"
            className="inline-flex w-max items-center gap-1.5 self-start rounded-md bg-accent px-3.5 py-2 font-sans text-[12px] font-medium text-accent-fg hover:opacity-90 sm:self-auto"
          >
            <Plus className="h-3.5 w-3.5" />
            New assistant
          </Link>
        </div>

        {!assistants && (
          <div className="font-serif italic text-fg-muted">loading…</div>
        )}
        {assistants && assistants.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-12 text-center font-serif italic text-fg-muted">
            No assistants yet.
          </div>
        )}
        {assistants && assistants.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {assistants.map((a) => (
              <div key={a.id} className="group relative">
                <AssistantCard a={a} />
                <div className="absolute right-3 top-3 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <Link
                    href={`/assistants/${a.id}`}
                    className="rounded bg-bg-muted/80 p-1.5 text-fg-muted backdrop-blur hover:text-fg"
                    aria-label="Edit"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Pencil className="h-3 w-3" />
                  </Link>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      del(a.id);
                    }}
                    className="rounded bg-bg-muted/80 p-1.5 text-fg-muted backdrop-blur hover:text-red-500"
                    aria-label="Delete"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
