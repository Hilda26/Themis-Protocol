import type { Metadata } from "next";
import { Playfair_Display, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/auth/Providers";
import { AppShell } from "@/components/layout/AppShell";

const display = Playfair_Display({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-display" });
const body = Inter({ subsets: ["latin"], variable: "--font-body" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Themis - AI-consensus dispute and attestation protocol",
  description:
    "Themis is reusable GenLayer infrastructure: any app defines dispute rules, opens cases, and gets a validator-consensus verdict judged from tamper-evident recorded evidence.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
