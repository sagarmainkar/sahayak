"use client";

import { use, useEffect, useState } from "react";
import { Header } from "@/components/Header";
import { AssistantEditor } from "@/components/AssistantEditor";
import type { Assistant } from "@/lib/types";

export default function EditAssistantPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [assistant, setAssistant] = useState<Assistant | null>(null);

  useEffect(() => {
    fetch(`/api/assistants/${id}`)
      .then((r) => r.json())
      .then((d: { assistant: Assistant }) => setAssistant(d.assistant));
  }, [id]);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        {assistant ? (
          <AssistantEditor initial={assistant} assistantId={id} />
        ) : (
          <div className="p-6 text-sm text-fg-muted">Loading…</div>
        )}
      </main>
    </div>
  );
}
