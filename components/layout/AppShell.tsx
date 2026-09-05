"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletMenu } from "@/components/auth/WalletMenu";
import { cn } from "@/lib/utils/cn";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/cases", label: "Case Register" },
  { href: "/apps", label: "Integrations" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen bg-parchment text-ink">
      <header className="border-b border-line bg-parchment/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <Link href="/" className="flex items-baseline gap-3">
            <span className="font-display text-xl tracking-wide text-ink">Themis</span>
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.24em] text-gold sm:inline">
              Adjudication Protocol
            </span>
          </Link>
          <nav className="hidden gap-6 md:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "font-body text-sm transition-colors",
                  pathname === item.href
                    ? "text-ink underline decoration-gold decoration-2 underline-offset-8"
                    : "text-muted hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <WalletMenu />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-12">{children}</main>
      <footer className="mx-auto max-w-5xl px-6 pb-12">
        <div className="border-t border-rule pt-6 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
          Themis Protocol - GenLayer Studionet - evidence recorded once, judged from the record
        </div>
      </footer>
    </div>
  );
}
