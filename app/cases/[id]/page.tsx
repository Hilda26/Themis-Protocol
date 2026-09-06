"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useAccount } from "wagmi";
import {
  Badge, Button, Card, Field, Input, Label, Notice, PageHeading, Rule, Select, TextArea,
} from "@/components/ui/Primitives";
import {
  getCase, getCaseEvidence, getCaseVerdict, getCaseAppeal, getTemplate, isManualReviewStale,
  fundCase, cancelUnfundedCase, respondToCase, submitEvidence, closeEvidence, requestVerdict,
  fileAppeal, requestAppealReview, finalizeCase, claimSettlement, resolveStaleManualReview,
  APPEAL_BASES,
  type Case, type Evidence, type Verdict, type Appeal, type Template,
} from "@/lib/genlayer/queries";
import { shortAddr, shortHash, formatEpoch, titleCase, bpsToPct, parseGenToWei, formatGen } from "@/lib/format";
import { classifyError } from "@/lib/errors";
import { getGenlayerExplorerTxUrl, isContractConfigured, CONTRACT_MISSING_MESSAGE } from "@/lib/genlayer/config";

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "gold"> = {
  case_opened: "neutral", cancelled: "neutral", evidence_open: "gold", evidence_closed: "gold",
  verdict_issued: "success", manual_review_required: "warning", insufficient_evidence: "warning",
  unverifiable: "warning", appeal_window_open: "warning", appeal_under_review: "warning",
  finalized: "success", settled: "success", settlement_failed: "danger",
};


/** Detects a URL whose visible text is engineered to read as one site while
 * resolving to another: `https://reputable.example@attacker.test/x` fetches
 * from attacker.test, but a reader skimming the string sees the reputable
 * name first. Comparing parsed hosts cannot catch this -- every URL parser
 * strips userinfo, so both sides would agree. The tell is userinfo being
 * present in the authority at all. */
function hasDeceptiveUserinfo(e: Evidence): boolean {
  const authority = e.public_url.replace(/^https?:\/\//i, "").split(/[/?#]/)[0];
  return authority.includes("@");
}

function eq(a?: string, b?: string) {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

export default function CaseDetailPage() {
  const params = useParams<{ id: string }>();
  const caseId = Number(params.id);
  const { address } = useAccount();

  const [c, setCase] = useState<Case | null>(null);
  const [template, setTemplate] = useState<Template | null>(null);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [appeal, setAppeal] = useState<Appeal | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const [fundAmount, setFundAmount] = useState("0.01");
  const [response, setResponse] = useState("");
  const [evType, setEvType] = useState("document");
  const [evTitle, setEvTitle] = useState("");
  const [evStatement, setEvStatement] = useState("");
  const [evUrl, setEvUrl] = useState("");
  const [appealBasis, setAppealBasis] = useState(APPEAL_BASES[0]);
  const [appealStatement, setAppealStatement] = useState("");
  const [appealUrl, setAppealUrl] = useState("");

  const load = useCallback(async () => {
    if (!isContractConfigured()) { setError(CONTRACT_MISSING_MESSAGE); return; }
    try {
      const cs = await getCase(caseId);
      setCase(cs);
      const [ev, vd, ap, tpl] = await Promise.all([
        getCaseEvidence(caseId), getCaseVerdict(caseId), getCaseAppeal(caseId), getTemplate(cs.template_id),
      ]);
      setEvidence(ev); setVerdict(vd); setAppeal(ap); setTemplate(tpl);
      if (cs.status === "manual_review_required") setStale(await isManualReviewStale(caseId));
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  }, [caseId]);

  useEffect(() => { load(); }, [load]);

  async function run(label: string, fn: () => Promise<{ hash: string }>) {
    setBusy(label); setError(null); setTxHash(null);
    try {
      const r = await fn();
      setTxHash(r.hash);
      await load();
    } catch (e) {
      setError(classifyError(e).message);
    } finally {
      setBusy(null);
    }
  }

  if (error && !c) return <Notice tone="error">{error}</Notice>;
  if (!c) return <div className="font-body text-sm text-muted">Loading case...</div>;

  const isComplainant = eq(address, c.complainant);
  const isRespondent = eq(address, c.respondent);
  const isParty = isComplainant || isRespondent;

  return (
    <div className="space-y-8">
      <PageHeading eyebrow={`Case No. ${String(c.case_id).padStart(4, "0")}`} title={c.case_summary} />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[c.status] || "neutral"}>{titleCase(c.status)}</Badge>
        {template && <Badge tone="neutral">{titleCase(template.settlement_mode)}</Badge>}
        {isComplainant && <Badge tone="gold">You are the complainant</Badge>}
        {isRespondent && <Badge tone="gold">You are the respondent</Badge>}
      </div>

      <Card>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Complainant" value={<span className="font-mono text-xs">{shortAddr(c.complainant)}</span>} />
          <Field label="Respondent" value={<span className="font-mono text-xs">{shortAddr(c.respondent)}</span>} />
          <Field label="Requested remedy" value={c.requested_remedy} />
          <Field label="Escrowed" value={c.funded_wei === 0n ? "Not funded" : formatGen(c.funded_wei)} />
          <Field label="Filed" value={formatEpoch(c.created_at)} />
          <Field label="Evidence deadline" value={formatEpoch(c.evidence_deadline)} />
        </div>
        {c.respondent_response && (
          <>
            <Rule className="my-5" />
            <Field label="Respondent's answer" value={c.respondent_response} />
          </>
        )}
        {template && (
          <>
            <Rule className="my-5" />
            <Field label="Rules applied" value={<span className="leading-relaxed">{template.rules}</span>} />
          </>
        )}
      </Card>

      <section>
        <h2 className="mb-3 font-display text-xl text-ink">Recorded evidence</h2>
        <p className="mb-4 font-body text-sm text-muted">
          Each item was fetched and hashed at the moment it was submitted. Every panel reads these
          recordings -- the live page is never fetched again.
        </p>
        {evidence.length === 0 ? (
          <Notice>No evidence has been submitted.</Notice>
        ) : (
          <div className="space-y-3">
            {evidence.map((e) => (
              <Card key={e.evidence_id}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-display text-base text-ink">{e.title || "(untitled)"}</div>
                    <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                      {e.evidence_type} - submitted by {eq(e.submitted_by, c.complainant) ? "complainant" : "respondent"}
                    </div>
                  </div>
                  <Badge tone={e.fetch_ok ? "success" : "danger"}>{e.fetch_ok ? "Recorded" : "Unreachable"}</Badge>
                </div>
                <p className="mt-3 font-body text-sm leading-relaxed text-muted">{e.statement}</p>
                <Rule className="my-4" />
                <div className="grid gap-2 font-mono text-[11px] text-muted sm:grid-cols-2">
                  <div className="truncate">
                    <a href={e.public_url} target="_blank" rel="noreferrer" className="underline decoration-gold/50 underline-offset-4 hover:text-ink">
                      {e.public_url}
                    </a>
                  </div>
                  <div>sha256 {shortHash(e.fetched_hash)}</div>
                  {/* The host the content genuinely came from, parsed with
                      userinfo stripped. A URL reading as one site can resolve
                      to another, so the effective source is always shown. */}
                  <div>
                    fetched from{" "}
                    <span className={hasDeceptiveUserinfo(e) ? "text-danger" : "text-ink"}>
                      {e.source_host}
                    </span>
                  </div>
                  {hasDeceptiveUserinfo(e) && (
                    <div className="text-danger">
                      URL embeds credentials before the host - it reads as one site but was
                      fetched from {e.source_host}
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {verdict && (
        <section>
          <h2 className="mb-3 font-display text-xl text-ink">Verdict</h2>
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="gold">{titleCase(verdict.verdict)}</Badge>
              <Badge tone="neutral">Winner: {titleCase(verdict.winner)}</Badge>
              <Badge tone="neutral">
                Split {bpsToPct(verdict.complainant_bps)} / {bpsToPct(verdict.respondent_bps)}
              </Badge>
              <Badge tone="neutral">Confidence {verdict.confidence}</Badge>
            </div>
            <p className="mt-4 font-body text-sm leading-relaxed text-ink">{verdict.short_reason}</p>
            <Rule className="my-4" />
            <div className="grid gap-3 font-body text-xs text-muted sm:grid-cols-3">
              <div>Evidence alignment: {titleCase(verdict.evidence_alignment)}</div>
              <div>Rule fit: {titleCase(verdict.rule_fit)}</div>
              <div>Issued {formatEpoch(verdict.issued_at)}</div>
            </div>
          </Card>
        </section>
      )}

      {appeal && (
        <section>
          <h2 className="mb-3 font-display text-xl text-ink">Appeal</h2>
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral">{titleCase(appeal.basis)}</Badge>
              <Badge tone={appeal.result === "appeal_granted" ? "success" : "neutral"}>
                {appeal.result ? titleCase(appeal.result) : titleCase(appeal.status)}
              </Badge>
              <span className="font-mono text-[11px] text-muted">
                filed by {eq(appeal.filed_by, c.complainant) ? "complainant" : "respondent"}
              </span>
            </div>
            <p className="mt-4 font-body text-sm leading-relaxed text-ink">{appeal.statement}</p>
          </Card>
        </section>
      )}

      {error && <Notice tone="error">{error}</Notice>}
      {txHash && (
        <Notice tone="success">
          Transaction confirmed:{" "}
          <a className="underline" href={getGenlayerExplorerTxUrl(txHash)} target="_blank" rel="noreferrer">
            {shortHash(txHash)}
          </a>
        </Notice>
      )}

      <section>
        <h2 className="mb-3 font-display text-xl text-ink">Available actions</h2>
        <Card className="space-y-6">
          {c.status === "case_opened" && (
            <div className="space-y-3">
              <p className="font-body text-sm text-muted">
                This case is not funded yet. Funding it escrows the disputed amount and opens the evidence window.
              </p>
              {isComplainant && (
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-40">
                    <Label>Amount (GEN)</Label>
                    <Input value={fundAmount} onChange={(e) => setFundAmount(e.target.value)} />
                  </div>
                  <Button
                    disabled={busy !== null}
                    onClick={() => {
                      const wei = parseGenToWei(fundAmount);
                      if (!wei) { setError("Enter a valid GEN amount."); return; }
                      return run("fund", () => fundCase(c.case_id, wei));
                    }}
                  >
                    {busy === "fund" ? "Funding..." : "Fund Case"}
                  </Button>
                  <Button variant="danger" disabled={busy !== null} onClick={() => run("cancel", () => cancelUnfundedCase(c.case_id))}>
                    {busy === "cancel" ? "Cancelling..." : "Cancel"}
                  </Button>
                </div>
              )}
            </div>
          )}

          {c.status === "evidence_open" && (
            <>
              {isRespondent && !c.respondent_response && (
                <div className="space-y-3">
                  <Label>Your answer to this case</Label>
                  <TextArea rows={3} value={response} onChange={(e) => setResponse(e.target.value)} />
                  <Button disabled={busy !== null || !response} onClick={() => run("respond", () => respondToCase(c.case_id, response))}>
                    {busy === "respond" ? "Submitting..." : "Submit Answer"}
                  </Button>
                </div>
              )}
              {isParty && (
                <div className="space-y-3 border-t border-line pt-5">
                  <h3 className="font-display text-base text-ink">Submit evidence</h3>
                  <p className="font-body text-xs text-muted">
                    The URL is fetched and hashed in this same transaction. Whatever it says now is what will be judged.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label>Type</Label>
                      <Input value={evType} onChange={(e) => setEvType(e.target.value)} placeholder="photo / document / tracking" />
                    </div>
                    <div>
                      <Label>Title</Label>
                      <Input value={evTitle} onChange={(e) => setEvTitle(e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <Label>Statement (20-2000 chars)</Label>
                    <TextArea rows={2} value={evStatement} onChange={(e) => setEvStatement(e.target.value)} />
                  </div>
                  <div>
                    <Label>Public URL</Label>
                    <Input value={evUrl} onChange={(e) => setEvUrl(e.target.value)} placeholder="https://..." />
                  </div>
                  <Button
                    disabled={busy !== null || !evStatement || !evUrl}
                    onClick={() => run("evidence", () => submitEvidence({
                      caseId: c.case_id, evidenceType: evType, title: evTitle,
                      statement: evStatement, publicUrl: evUrl,
                    }))}
                  >
                    {busy === "evidence" ? "Recording..." : "Record Evidence"}
                  </Button>
                </div>
              )}
              <div className="border-t border-line pt-5">
                <Button variant="secondary" disabled={busy !== null} onClick={() => run("close", () => closeEvidence(c.case_id))}>
                  {busy === "close" ? "Closing..." : "Close Evidence Window"}
                </Button>
              </div>
            </>
          )}

          {c.status === "evidence_closed" && (
            <div className="space-y-3">
              <p className="font-body text-sm text-muted">
                Evidence is closed. Anyone may now trigger the validator panel -- a real multi-minute consensus round.
              </p>
              <Button disabled={busy !== null} onClick={() => run("verdict", () => requestVerdict(c.case_id))}>
                {busy === "verdict" ? "Judging..." : "Request Verdict"}
              </Button>
            </div>
          )}

          {c.status === "verdict_issued" && (
            <div className="space-y-5">
              <div>
                <Button variant="secondary" disabled={busy !== null} onClick={() => run("finalize", () => finalizeCase(c.case_id))}>
                  {busy === "finalize" ? "Finalizing..." : "Finalize (after appeal window)"}
                </Button>
              </div>
              {isParty && verdict?.appeal_allowed && (
                <div className="space-y-3 border-t border-line pt-5">
                  <h3 className="font-display text-base text-ink">File an appeal</h3>
                  <div>
                    <Label>Basis</Label>
                    <Select value={appealBasis} onChange={(e) => setAppealBasis(e.target.value)}>
                      {APPEAL_BASES.map((b) => <option key={b} value={b}>{titleCase(b)}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label>Statement</Label>
                    <TextArea rows={2} value={appealStatement} onChange={(e) => setAppealStatement(e.target.value)} />
                  </div>
                  <div>
                    <Label>Supplementary evidence URL (optional)</Label>
                    <Input value={appealUrl} onChange={(e) => setAppealUrl(e.target.value)} placeholder="https://..." />
                  </div>
                  <Button
                    variant="secondary"
                    disabled={busy !== null || !appealStatement}
                    onClick={() => run("appeal", () => fileAppeal(c.case_id, appealBasis, appealStatement, appealUrl ? [appealUrl] : []))}
                  >
                    {busy === "appeal" ? "Filing..." : "File Appeal"}
                  </Button>
                </div>
              )}
            </div>
          )}

          {c.status === "appeal_window_open" && (
            <div className="space-y-3">
              <p className="font-body text-sm text-muted">
                An appeal is pending. Anyone may trigger the appeal panel, which re-reads the same recorded dossier.
              </p>
              <Button disabled={busy !== null} onClick={() => run("appealReview", () => requestAppealReview(c.case_id))}>
                {busy === "appealReview" ? "Reviewing..." : "Request Appeal Review"}
              </Button>
            </div>
          )}

          {c.status === "manual_review_required" && (
            <div className="space-y-3">
              <p className="font-body text-sm text-muted">
                The panel could not decide this case, so it is flagged for the app owner. If they never act,
                it can be resolved permissionlessly as an even split once the grace period elapses.
              </p>
              <Button variant="secondary" disabled={busy !== null || !stale} onClick={() => run("stale", () => resolveStaleManualReview(c.case_id))}>
                {busy === "stale" ? "Resolving..." : stale ? "Resolve as Even Split" : "Grace period still running"}
              </Button>
            </div>
          )}

          {c.status === "finalized" && !c.payout_claimed && (
            <div className="space-y-3">
              <p className="font-body text-sm text-muted">
                This case is final. Settlement pays out exactly once and may be triggered by anyone.
              </p>
              <Button disabled={busy !== null} onClick={() => run("claim", () => claimSettlement(c.case_id))}>
                {busy === "claim" ? "Settling..." : "Execute Settlement"}
              </Button>
            </div>
          )}

          {["settled", "cancelled"].includes(c.status) && (
            <p className="font-body text-sm text-muted">This case is closed. No further action is possible.</p>
          )}
        </Card>
      </section>
    </div>
  );
}
