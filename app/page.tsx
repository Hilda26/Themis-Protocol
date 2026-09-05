"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Card, Rule, Badge } from "@/components/ui/Primitives";
import { getAllApps, getAllCases } from "@/lib/genlayer/queries";
import { isContractConfigured, CONTRACT_ADDRESS, getGenlayerExplorerAddressUrl } from "@/lib/genlayer/config";

const GUARANTEES = [
  {
    n: "I",
    title: "Evidence is recorded once, at submission",
    body: "Every evidence URL is fetched and SHA-256 hashed the moment it is pinned. The verdict panel and any appeal panel read that recorded snapshot -- never the live web again. Nobody can edit a page after the other side has answered it.",
  },
  {
    n: "II",
    title: "No statement can impersonate the record",
    body: "Every party-authored string and every fetched excerpt is stripped of the fence sequence used to delimit trusted content. A forged 'recorded evidence' block can only ever arrive visibly defused.",
  },
  {
    n: "III",
    title: "Failure never settles",
    body: "A malformed verdict, an unreadable page, or an unresolvable case falls back to manual review -- it never pays anyone. State flips to terminal before any transfer, and no case can be claimed twice.",
  },
  {
    n: "IV",
    title: "Every case has an exit",
    body: "An unfunded case can be cancelled; a case stuck in manual review because the app owner vanished can be resolved permissionlessly after a grace period, as an even, unadjudicated split.",
  },
];

export default function HomePage() {
  const [counts, setCounts] = useState<{ apps: number; cases: number } | null>(null);

  useEffect(() => {
    if (!isContractConfigured()) return;
    Promise.all([getAllApps(), getAllCases()])
      .then(([apps, cases]) => setCounts({ apps: apps.length, cases: cases.length }))
      .catch(() => setCounts(null));
  }, []);

  return (
    <div className="space-y-16">
      <section>
        <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.24em] text-gold">
          GenLayer - Adjudication Infrastructure
        </div>
        <h1 className="max-w-3xl font-display text-4xl leading-[1.15] text-ink md:text-5xl">
          Disputes settled from the record,
          <br />
          not from the live web.
        </h1>
        <Rule className="mt-6 max-w-[8rem]" />
        <p className="mt-6 max-w-2xl font-body text-base leading-relaxed text-muted">
          Themis is reusable infrastructure, not a closed product. Any app registers, writes its dispute
          rules in plain English, and opens cases. GenLayer validator consensus reads the case and issues
          a verdict -- judged entirely from evidence that was fetched and hashed the moment it was
          submitted.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/cases">
            <Button variant="primary">Open the Case Register</Button>
          </Link>
          <Link href="/apps">
            <Button variant="secondary">Register an Integration</Button>
          </Link>
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          {isContractConfigured() ? (
            <>
              <Badge tone="gold">{counts ? `${counts.cases} cases` : "..."}</Badge>
              <Badge tone="neutral">{counts ? `${counts.apps} integrations` : "..."}</Badge>
              <a
                href={getGenlayerExplorerAddressUrl(CONTRACT_ADDRESS)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[11px] text-muted underline decoration-gold/50 underline-offset-4 hover:text-ink"
              >
                {CONTRACT_ADDRESS}
              </a>
            </>
          ) : (
            <Badge tone="warning">Contract not configured</Badge>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-6 font-display text-2xl text-ink">What the contract guarantees</h2>
        <div className="grid gap-px overflow-hidden rounded-card border border-line bg-line md:grid-cols-2">
          {GUARANTEES.map((g) => (
            <div key={g.n} className="bg-panel p-6">
              <div className="mb-3 flex items-baseline gap-3">
                <span className="font-display text-lg text-gold">{g.n}</span>
                <h3 className="font-display text-lg text-ink">{g.title}</h3>
              </div>
              <p className="font-body text-sm leading-relaxed text-muted">{g.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-6 font-display text-2xl text-ink">How a case moves</h2>
        <Card>
          <ol className="space-y-4">
            {[
              ["An app registers and writes a template", "Plain-English rules, the verdicts the panel may return, and how settlement works -- escrowed GEN, or a purely non-monetary attestation."],
              ["A complainant opens and funds a case", "Naming a respondent, a summary, a requested remedy, and an evidence deadline."],
              ["Both sides submit evidence", "Each URL is fetched and hashed on the spot. What is recorded then is what will be judged later."],
              ["Consensus issues a verdict", "Validators independently judge the recorded dossier against the template's rules and agree under an equivalence principle."],
              ["Either party may appeal once", "The appeal panel re-reads the same record, plus whatever the appellant pinned when filing -- also recorded at that moment."],
              ["Settlement executes", "After the appeal window closes, anyone may finalize; the split pays out exactly once, state flipped terminal before any transfer."],
            ].map(([title, body], i) => (
              <li key={i} className="flex gap-4">
                <span className="mt-0.5 font-mono text-xs text-gold">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <div className="font-body text-sm text-ink">{title}</div>
                  <div className="mt-1 font-body text-sm leading-relaxed text-muted">{body}</div>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </section>
    </div>
  );
}
