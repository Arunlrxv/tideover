import type { Metadata } from "next";
import { Figures, LedgerList } from "@/components/Ledger";

export const metadata: Metadata = { title: "Public ledger · Tideover" };

export default function LedgerPage() {
  return (
    <div className="page">
      <div className="wrap">
        <p className="eyebrow">Public ledger</p>
        <h1>Audit everything. Expose no one.</h1>
        <p className="lede">
          Every claim the fund has ever handled. There is no name and no reason on this page, because neither is on the
          chain. Open a claim to check each rule yourself.
        </p>
        <Figures />
        <div style={{ height: 22 }} />
        <LedgerList limit={50} />
      </div>
    </div>
  );
}
