import { Header } from "@/components/Header";
import { SettingsPage } from "@/components/SettingsPage";

export const dynamic = "force-dynamic";

export default function Settings() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <SettingsPage />
    </div>
  );
}
