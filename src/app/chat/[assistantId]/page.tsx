"use client";

import { use } from "react";
import Chat from "@/components/Chat";

export default function ChatByAssistant({
  params,
}: {
  params: Promise<{ assistantId: string }>;
}) {
  const { assistantId } = use(params);
  return <Chat assistantId={assistantId} />;
}
