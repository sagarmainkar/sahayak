"use client";

import { use } from "react";
import Chat from "@/components/Chat";

export default function ChatBySession({
  params,
}: {
  params: Promise<{ assistantId: string; sessionId: string }>;
}) {
  const { assistantId, sessionId } = use(params);
  return <Chat assistantId={assistantId} sessionId={sessionId} />;
}
