import type { Metadata, Viewport } from "next";
import {
  Geist,
  Geist_Mono,
  Fraunces,
  Source_Serif_4,
  JetBrains_Mono,
} from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ArtifactPanelProvider } from "@/components/ArtifactPanelContext";
import { ConfirmDialogProvider } from "@/components/ConfirmDialog";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-ui-mono", subsets: ["latin"] });

const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  axes: ["opsz", "SOFT"],
  display: "swap",
});

const serif = Source_Serif_4({
  variable: "--font-serif",
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sahayak",
  description: "Your local AI assistants",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} ${serif.variable} ${mono.variable} min-h-dvh antialiased`}
    >
      <body className="min-h-dvh flex flex-col bg-bg text-fg font-sans pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <ThemeProvider>
          <ConfirmDialogProvider>
            <ArtifactPanelProvider>{children}</ArtifactPanelProvider>
          </ConfirmDialogProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
