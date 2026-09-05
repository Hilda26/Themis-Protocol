"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge, Button, Card, Input, Label, Notice, PageHeading, Rule, Select, TextArea,
} from "@/components/ui/Primitives";
import {
  getAllApps, getAppTemplates, registerApp, createTemplate, openCase,
  PRIMARY_VERDICTS, SETTLEMENT_MODES,
  type App, type Template,
} from "@/lib/genlayer/queries";
import { shortAddr, titleCase } from "@/lib/format";
import { classifyError } from "@/lib/errors";
import { isContractConfigured, CONTRACT_MISSING_MESSAGE } from "@/lib/genlayer/config";

export default function AppsPage() {
  const router = useRouter();
  const [apps, setApps] = useState<App[] | null>(null);
  const [templates, setTemplates] = useState<Record<number, Template[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // register app
  const [appName, setAppName] = useState("");
  const [appDomain, setAppDomain] = useState("");
  const [appDesc, setAppDesc] = useState("");

  // template
  const [tplAppId, setTplAppId] = useState("");
  const [tplName, setTplName] = useState("");
  const [tplCaseType, setTplCaseType] = useState("");
  const [tplRules, setTplRules] = useState("");
  const [tplEvidence, setTplEvidence] = useState("");
  const [tplVerdicts, setTplVerdicts] = useState<string[]>(["complainant_wins", "respondent_wins", "split_settlement", "no_fault"]);
  const [tplMode, setTplMode] = useState(SETTLEMENT_MODES[0]);
  const [tplAppeal, setTplAppeal] = useState(true);
  const [tplWindow, setTplWindow] = useState("3600");

  // case
  const [caseAppId, setCaseAppId] = useState("");
  const [caseTemplateId, setCaseTemplateId] = useState("");
  const [caseRespondent, setCaseRespondent] = useState("");
  const [caseSummary, setCaseSummary] = useState("");
  const [caseRemedy, setCaseRemedy] = useState("");
  const [caseDeadlineHours, setCaseDeadlineHours] = useState("24");

  async function load() {
    if (!isContractConfigured()) { setError(CONTRACT_MISSING_MESSAGE); return; }
    try {
      const rows = await getAllApps();
      setApps(rows);
      const map: Record<number, Template[]> = {};
      for (const a of rows) map[a.app_id] = await getAppTemplates(a.app_id);
      setTemplates(map);
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  }

  useEffect(() => { load(); }, []);

  async function run(label: string, fn: () => Promise<any>, successMsg: string) {
    setBusy(label); setError(null); setNotice(null);
    try {
      await fn();
      setNotice(successMsg);
      await load();
    } catch (e) {
      setError(classifyError(e).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-10">
      <PageHeading
        eyebrow="Integrations"
        title="Apps and Templates"
        description="Themis is infrastructure: an app registers once, defines templates describing its own dispute rules in plain English, and opens cases against them. The same protocol serves a marketplace, a DAO, or a pure attestation with no money at stake."
      />

      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}

      <section>
        <h2 className="mb-4 font-display text-xl text-ink">Registered integrations</h2>
        {apps === null && !error && <div className="font-body text-sm text-muted">Loading...</div>}
        {apps && apps.length === 0 && <Notice>No apps registered on this deployment yet.</Notice>}
        <div className="space-y-4">
          {apps?.map((a) => (
            <Card key={a.app_id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-display text-lg text-ink">{a.name}</div>
                  <div className="mt-1 font-mono text-[11px] text-muted">{a.domain}</div>
                </div>
                <Badge tone={a.active ? "success" : "neutral"}>{a.active ? "Active" : "Inactive"}</Badge>
              </div>
              <p className="mt-3 font-body text-sm text-muted">{a.description}</p>
              <Rule className="my-4" />
              <div className="font-mono text-[11px] text-muted">
                App #{a.app_id} - owner {shortAddr(a.owner)}
              </div>
              {templates[a.app_id]?.length > 0 && (
                <div className="mt-4 space-y-3">
                  {templates[a.app_id].map((t) => (
                    <div key={t.template_id} className="rounded-card border border-line bg-parchment/50 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-body text-sm text-ink">
                          Template #{t.template_id} - {t.name}
                        </div>
                        <Badge tone="neutral">{titleCase(t.settlement_mode)}</Badge>
                      </div>
                      <p className="mt-2 font-body text-xs leading-relaxed text-muted">{t.rules}</p>
                      <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                        Verdicts: {t.allowed_verdicts.join(", ")}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-4">
          <h2 className="font-display text-lg text-ink">Register an app</h2>
          <div>
            <Label>Name</Label>
            <Input value={appName} onChange={(e) => setAppName(e.target.value)} placeholder="Marketplace X" />
          </div>
          <div>
            <Label>Domain</Label>
            <Input value={appDomain} onChange={(e) => setAppDomain(e.target.value)} placeholder="marketplacex.example" />
          </div>
          <div>
            <Label>Description</Label>
            <TextArea rows={2} value={appDesc} onChange={(e) => setAppDesc(e.target.value)} />
          </div>
          <Button
            disabled={busy !== null || !appName || !appDomain || !appDesc}
            onClick={() => run("app", () => registerApp(appName, appDomain, appDesc), "App registered.")}
          >
            {busy === "app" ? "Registering..." : "Register App"}
          </Button>
        </Card>

        <Card className="space-y-4">
          <h2 className="font-display text-lg text-ink">Define a template</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>App ID</Label>
              <Input value={tplAppId} onChange={(e) => setTplAppId(e.target.value)} placeholder="1" />
            </div>
            <div>
              <Label>Template name</Label>
              <Input value={tplName} onChange={(e) => setTplName(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Case type</Label>
            <Input value={tplCaseType} onChange={(e) => setTplCaseType(e.target.value)} placeholder="marketplace_order" />
          </div>
          <div>
            <Label>Rules (30-3000 chars, plain English)</Label>
            <TextArea rows={3} value={tplRules} onChange={(e) => setTplRules(e.target.value)} />
          </div>
          <div>
            <Label>Required evidence</Label>
            <Input value={tplEvidence} onChange={(e) => setTplEvidence(e.target.value)} />
          </div>
          <div>
            <Label>Allowed verdicts</Label>
            <div className="flex flex-wrap gap-2">
              {PRIMARY_VERDICTS.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() =>
                    setTplVerdicts((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]))
                  }
                  className={`rounded-chip border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${
                    tplVerdicts.includes(v) ? "border-gold bg-gold-pale text-gold" : "border-line text-muted"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Settlement mode</Label>
              <Select value={tplMode} onChange={(e) => setTplMode(e.target.value)}>
                {SETTLEMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            </div>
            <div>
              <Label>Appeal window (seconds)</Label>
              <Input value={tplWindow} onChange={(e) => setTplWindow(e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 font-body text-sm text-muted">
            <input type="checkbox" checked={tplAppeal} onChange={(e) => setTplAppeal(e.target.checked)} />
            Appeals enabled
          </label>
          <Button
            disabled={busy !== null || !tplAppId || !tplRules || tplVerdicts.length === 0}
            onClick={() =>
              run("template", () => createTemplate({
                appId: Number(tplAppId), name: tplName, caseType: tplCaseType, rules: tplRules,
                requiredEvidence: tplEvidence, allowedVerdicts: tplVerdicts, settlementMode: tplMode,
                appealEnabled: tplAppeal, appealWindow: Number(tplWindow), publicVisibility: true,
              }), "Template created.")
            }
          >
            {busy === "template" ? "Creating..." : "Create Template"}
          </Button>
        </Card>
      </section>

      <section>
        <Card className="space-y-4">
          <h2 className="font-display text-lg text-ink">Open a case</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>App ID</Label>
              <Input value={caseAppId} onChange={(e) => setCaseAppId(e.target.value)} placeholder="1" />
            </div>
            <div>
              <Label>Template ID</Label>
              <Input value={caseTemplateId} onChange={(e) => setCaseTemplateId(e.target.value)} placeholder="1" />
            </div>
          </div>
          <div>
            <Label>Respondent address</Label>
            <Input value={caseRespondent} onChange={(e) => setCaseRespondent(e.target.value)} placeholder="0x..." />
          </div>
          <div>
            <Label>Case summary (30-3000 chars)</Label>
            <TextArea rows={3} value={caseSummary} onChange={(e) => setCaseSummary(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Requested remedy</Label>
              <Input value={caseRemedy} onChange={(e) => setCaseRemedy(e.target.value)} />
            </div>
            <div>
              <Label>Evidence window (hours)</Label>
              <Input value={caseDeadlineHours} onChange={(e) => setCaseDeadlineHours(e.target.value)} />
            </div>
          </div>
          <Button
            disabled={busy !== null || !caseAppId || !caseTemplateId || !caseRespondent || !caseSummary}
            onClick={() =>
              run("case", async () => {
                const deadline = Math.floor(Date.now() / 1000) + Number(caseDeadlineHours) * 3600;
                await openCase({
                  appId: Number(caseAppId), templateId: Number(caseTemplateId), respondent: caseRespondent,
                  caseSummary, requestedRemedy: caseRemedy, evidenceDeadline: deadline,
                });
                router.push("/cases");
              }, "Case opened.")
            }
          >
            {busy === "case" ? "Opening..." : "Open Case"}
          </Button>
        </Card>
      </section>
    </div>
  );
}
