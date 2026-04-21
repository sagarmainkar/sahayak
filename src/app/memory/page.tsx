import { MemoryPage } from "@/components/MemoryPage";
import { Header } from "@/components/Header";

export const dynamic = "force-dynamic";

export default function Memory() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <MemoryPage />
    </div>
  );
}
