"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  ["/ledger", "Ledger"],
  ["/member", "Member"],
  ["/claim", "Ask for help"],
  ["/panel", "Panel"],
  ["/council", "Council"],
  ["/install", "Install"],
  ["/break-it", "Break it"],
  ["/trust", "Trust"],
] as const;

export function Wave({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M2 9c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M2 14c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" opacity="0.65" />
      <path d="M2 19c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" opacity="0.35" />
    </svg>
  );
}

export function Nav() {
  const path = usePathname();
  return (
    <header className="site-head">
      <div className="wrap">
        <Link href="/" className="brand" aria-label="Tideover home">
          <Wave />
          Tideover
        </Link>
        <nav className="nav" aria-label="Main">
          {LINKS.map(([href, label]) => (
            <Link key={href} href={href} aria-current={path.startsWith(href) ? "page" : undefined}>
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
