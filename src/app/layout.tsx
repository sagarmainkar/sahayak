import type { Metadata } from "next";
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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} ${serif.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-bg text-fg font-sans">
        <ThemeProvider>
          <ArtifactPanelProvider>{children}</ArtifactPanelProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
