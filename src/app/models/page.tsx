import { Header } from "@/components/Header";
import { LlamaDashboard } from "@/components/LlamaDashboard";

export const dynamic = "force-dynamic";

export default function ModelsPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <Header />
      <LlamaDashboard />
    </div>
  );
}
