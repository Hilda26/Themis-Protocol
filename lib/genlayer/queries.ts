import { read, writeAndWait, type WriteResult } from "./client";

export type App = {
  app_id: number;
  owner: string;
  name: string;
  domain: string;
  description: string;
  active: boolean;
  created_at: number;
};

export type Template = {
  template_id: number;
  app_id: number;
  name: string;
  case_type: string;
  rules: string;
  required_evidence: string;
  allowed_verdicts: string[];
  settlement_mode: string;
  appeal_enabled: boolean;
  appeal_window: number;
  public_visibility: boolean;
};

export type CaseStatus =
  | "case_opened"
  | "cancelled"
  | "evidence_open"
  | "evidence_closed"
  | "verdict_issued"
  | "manual_review_required"
  | "insufficient_evidence"
  | "unverifiable"
  | "appeal_window_open"
  | "appeal_under_review"
  | "finalized"
  | "settled"
  | "settlement_failed";

export type Case = {
  case_id: number;
  app_id: number;
  template_id: number;
  complainant: string;
  respondent: string;
  case_summary: string;
  requested_remedy: string;
  respondent_response: string;
  settlement_amount: string;
  funded_wei: bigint;
  status: CaseStatus;
  created_at: number;
  evidence_deadline: number;
  verdict_finalized: boolean;
  payout_claimed: boolean;
};

export type Evidence = {
  evidence_id: number;
  case_id: number;
  submitted_by: string;
  evidence_type: string;
  title: string;
  statement: string;
  public_url: string;
  source_host: string;
  submitted_at: number;
  fetched_hash: string;
  fetch_ok: boolean;
};

export type Verdict = {
  case_id: number;
  verdict: string;
  winner: string;
  complainant_bps: number;
  respondent_bps: number;
  confidence: number;
  evidence_alignment: string;
  rule_fit: string;
  appeal_allowed: boolean;
  reason_code: string;
  short_reason: string;
  issued_at: number;
};

export type Appeal = {
  appeal_id: number;
  case_id: number;
  filed_by: string;
  basis: string;
  statement: string;
  evidence_urls: string[];
  status: string;
  result: string;
  created_at: number;
};

const n = (v: any) => Number(v);

export async function getAllApps(): Promise<App[]> {
  const rows = await read("get_all_apps", []);
  return (rows as any[]).map((a) => ({ ...a, app_id: n(a.app_id), created_at: n(a.created_at) }));
}

export async function getApp(appId: number): Promise<App> {
  const a = await read("get_app", [appId]);
  return { ...a, app_id: n(a.app_id), created_at: n(a.created_at) };
}

export async function getAppTemplates(appId: number): Promise<Template[]> {
  const rows = await read("get_app_templates", [appId]);
  return (rows as any[]).map((t) => ({
    ...t,
    template_id: n(t.template_id),
    app_id: n(t.app_id),
    appeal_window: n(t.appeal_window),
  }));
}

export async function getTemplate(templateId: number): Promise<Template> {
  const t = await read("get_template", [templateId]);
  return { ...t, template_id: n(t.template_id), app_id: n(t.app_id), appeal_window: n(t.appeal_window) };
}

function toCase(c: any): Case {
  return {
    ...c,
    case_id: n(c.case_id),
    app_id: n(c.app_id),
    template_id: n(c.template_id),
    created_at: n(c.created_at),
    evidence_deadline: n(c.evidence_deadline),
    funded_wei: BigInt(c.funded_wei ?? 0),
  };
}

export async function getAllCases(): Promise<Case[]> {
  const rows = await read("get_all_cases", []);
  return (rows as any[]).map(toCase);
}

export async function getCase(caseId: number): Promise<Case> {
  return toCase(await read("get_case", [caseId]));
}

export async function getCasesByApp(appId: number): Promise<Case[]> {
  const rows = await read("get_cases_by_app", [appId]);
  return (rows as any[]).map(toCase);
}

export async function getCasesByParty(address: string): Promise<Case[]> {
  const rows = await read("get_cases_by_party", [address]);
  return (rows as any[]).map(toCase);
}

export async function getCaseEvidence(caseId: number): Promise<Evidence[]> {
  const rows = await read("get_case_evidence", [caseId]);
  return (rows as any[]).map((e) => ({
    ...e,
    evidence_id: n(e.evidence_id),
    case_id: n(e.case_id),
    submitted_at: n(e.submitted_at),
  }));
}

export async function getCaseVerdict(caseId: number): Promise<Verdict | null> {
  const v = await read("get_case_verdict", [caseId]);
  if (!v || Object.keys(v).length === 0) return null;
  return {
    ...v,
    case_id: n(v.case_id),
    complainant_bps: n(v.complainant_bps),
    respondent_bps: n(v.respondent_bps),
    confidence: n(v.confidence),
    issued_at: n(v.issued_at),
  };
}

export async function getCaseAppeal(caseId: number): Promise<Appeal | null> {
  const a = await read("get_case_appeal", [caseId]);
  if (!a || Object.keys(a).length === 0) return null;
  return { ...a, appeal_id: n(a.appeal_id), case_id: n(a.case_id), created_at: n(a.created_at) };
}

export async function isManualReviewStale(caseId: number): Promise<boolean> {
  return Boolean(await read("is_manual_review_stale", [caseId]));
}

export async function getProtocolFeeInfo(): Promise<{ admin: string; fee_recipient: string; fee_bps: number }> {
  const f = await read("get_protocol_fee_info", []);
  return { ...f, fee_bps: n(f.fee_bps) };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export const registerApp = (name: string, domain: string, description: string): Promise<WriteResult> =>
  writeAndWait("register_app", [name, domain, description]);

export const createTemplate = (p: {
  appId: number;
  name: string;
  caseType: string;
  rules: string;
  requiredEvidence: string;
  allowedVerdicts: string[];
  settlementMode: string;
  appealEnabled: boolean;
  appealWindow: number;
  publicVisibility: boolean;
}): Promise<WriteResult> =>
  writeAndWait("create_template", [
    p.appId, p.name, p.caseType, p.rules, p.requiredEvidence,
    p.allowedVerdicts, p.settlementMode, p.appealEnabled, p.appealWindow, p.publicVisibility,
  ]);

export const openCase = (p: {
  appId: number;
  templateId: number;
  respondent: string;
  caseSummary: string;
  requestedRemedy: string;
  evidenceDeadline: number;
}): Promise<WriteResult> =>
  writeAndWait("open_case", [
    p.appId, p.templateId, p.respondent, p.caseSummary, p.requestedRemedy, p.evidenceDeadline,
  ]);

export const fundCase = (caseId: number, value: bigint): Promise<WriteResult> =>
  writeAndWait("fund_case", [caseId], value);

export const cancelUnfundedCase = (caseId: number): Promise<WriteResult> =>
  writeAndWait("cancel_unfunded_case", [caseId]);

export const respondToCase = (caseId: number, statement: string): Promise<WriteResult> =>
  writeAndWait("respond_to_case", [caseId, statement]);

export const submitEvidence = (p: {
  caseId: number;
  evidenceType: string;
  title: string;
  statement: string;
  publicUrl: string;
}): Promise<WriteResult> =>
  writeAndWait("submit_evidence", [p.caseId, p.evidenceType, p.title, p.statement, p.publicUrl]);

export const closeEvidence = (caseId: number): Promise<WriteResult> =>
  writeAndWait("close_evidence", [caseId]);

export const requestVerdict = (caseId: number): Promise<WriteResult> =>
  writeAndWait("request_verdict", [caseId]);

export const fileAppeal = (caseId: number, basis: string, statement: string, evidenceUrls: string[]): Promise<WriteResult> =>
  writeAndWait("file_appeal", [caseId, basis, statement, evidenceUrls]);

export const requestAppealReview = (caseId: number): Promise<WriteResult> =>
  writeAndWait("request_appeal_review", [caseId]);

export const finalizeCase = (caseId: number): Promise<WriteResult> =>
  writeAndWait("finalize_case", [caseId]);

export const claimSettlement = (caseId: number): Promise<WriteResult> =>
  writeAndWait("claim_settlement", [caseId]);

export const resolveStaleManualReview = (caseId: number): Promise<WriteResult> =>
  writeAndWait("resolve_stale_manual_review", [caseId]);

export const APPEAL_BASES = [
  "new_evidence",
  "wrong_rule_interpretation",
  "evidence_misread",
  "timeline_misread",
  "settlement_disproportionate",
  "identity_or_party_error",
];

export const PRIMARY_VERDICTS = [
  "complainant_wins",
  "respondent_wins",
  "split_settlement",
  "partial_refund",
  "redo_required",
  "no_fault",
];

export const SETTLEMENT_MODES = [
  "split_payment",
  "escrow_release",
  "refund",
  "non_monetary_verdict",
  "external_settlement_instruction",
];
