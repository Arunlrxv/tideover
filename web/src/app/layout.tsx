import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from "next/font/google";
import type { ReactNode } from "react";
import { Nav } from "@/components/Nav";
import "./globals.css";

const serif = Newsreader({ subsets: ["latin"], variable: "--font-serif", display: "swap", weight: ["400", "500"] });
const sans = IBM_Plex_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap", weight: ["400", "500", "600"] });
const mono = IBM_Plex_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap", weight: ["400"] });

export const metadata: Metadata = {
  title: "Tideover",
  description: "A community hardship fund on NEAR. Nobody can see who got paid or why, and anyone can check that every rule was followed.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <div className="testnet-flag">NEAR testnet demo. All money here is a worthless test token.</div>
        <Nav />
        <main>{children}</main>
        <footer className="foot">
          <div className="wrap">
            <span>Tideover. Built at NEAR HACKATHON, November 2026.</span>
            <span>
              <a href="/trust">What stays hidden, and what does not</a>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
