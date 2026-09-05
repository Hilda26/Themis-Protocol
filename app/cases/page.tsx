"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Card, PageHeading, Notice, Rule } from "@/components/ui/Primitives";
import { getAllCases, type Case, type CaseStatus } from "@/lib/genlayer/queries";
import { shortAddr, formatEpoch, titleCase } from "@/lib/format";
import { isContractConfigured, CONTRACT_MISSING_MESSAGE } from "@/lib/genlayer/config";

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "gold"> = {
  case_opened: "neutral",
  cancelled: "neutral",
  evidence_open: "gold",
  evidence_closed: "gold",
  verdict_issued: "success",
  manual_review_required: "warning",
  insufficient_evidence: "warning",
  unverifiable: "warning",
  appeal_window_open: "warning",
  appeal_under_review: "warning",
  finalized: "success",
  settled: "success",
  settlement_failed: "danger",
};

export default function CasesPage() {
  const [cases, setCases] = useState<Case[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isContractConfigured()) {
      setError(CONTRACT_MISSING_MESSAGE);
      return;
    }
    getAllCases()
      .then((rows) => setCases([...rows].reverse()))
      .catch((e) => setError(String(e?.message || e)));
  }, []);

  return (
    <div>
      <PageHeading
        eyebrow="Public Record"
        title="Case Register"
        description="Every case ever opened on this deployment, in the order it was filed. The register shows what was decided and how -- it is the deliberately public surface of the protocol."
      />

      {error && <Notice tone="error">{error}</Notice>}
      {!error && cases === null && <div className="font-body text-sm text-muted">Loading the register...</div>}
      {cases && cases.length === 0 && (
        <Notice>No cases have been filed on this deployment yet.</Notice>
      )}

      <div className="space-y-4">
        {cases?.map((c) => (
          <Link key={c.case_id} href={`/cases/${c.case_id}`} className="block">
            <Card className="transition-colors hover:border-gold/50">
              <div className="flex items-start justify-between gap-4">
                <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                  Case No. {String(c.case_id).padStart(4, "0")}
                </div>
                <Badge tone={STATUS_TONE[c.status] || "neutral"}>{titleCase(c.status)}</Badge>
              </div>
              <p className="mt-3 line-clamp-2 font-display text-lg leading-snug text-ink">{c.case_summary}</p>
              <Rule className="my-4" />
              <div className="grid gap-3 font-body text-xs text-muted sm:grid-cols-3">
                <div>
                  Complainant <span className="font-mono text-ink">{shortAddr(c.complainant)}</span>
                </div>
                <div>
                  Respondent <span className="font-mono text-ink">{shortAddr(c.respondent)}</span>
                </div>
                <div>Filed {formatEpoch(c.created_at)}</div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
