"use client";

import { Header } from "@/components/Header";
import { AssistantEditor } from "@/components/AssistantEditor";

export default function NewAssistantPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <AssistantEditor />
      </main>
    </div>
  );
}
