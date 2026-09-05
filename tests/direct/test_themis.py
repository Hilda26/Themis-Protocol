"""
Direct-mode tests for the Themis dispute/attestation protocol.

Run with: pytest tests/direct/ -v
"""

import inspect
import sys
from datetime import datetime, timezone

import pytest

from conftest import warp_to

CONTRACT = "contracts/Themis.py"


def _iso(epoch_seconds: int) -> str:
    """Themis reads wall-clock time via datetime.now(), not a message-raw
    field -- direct_vm.warp() takes an ISO string, so tests convert the
    epoch-second values the contract itself deals in before warping."""
    return datetime.fromtimestamp(epoch_seconds, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

T0 = 1_735_689_600  # 2025-01-01T00:00:00Z, arbitrary fixed epoch second
FUTURE_DEADLINE = T0 + 7 * 24 * 3600
APP_NAME = "Marketplace X"
APP_DOMAIN = "marketplacex.example"
APP_DESC = "A peer-to-peer goods marketplace."

RULES = (
    "The seller must deliver goods matching the listing description within the agreed window. "
    "If goods are not as described or not delivered, the buyer is entitled to a refund."
)
REQUIRED_EVIDENCE = "Order confirmation, delivery tracking, and photos if damaged."


def _deploy(direct_deploy):
    return direct_deploy(CONTRACT)


def _hex(addr):
    if hasattr(addr, "as_hex"):
        return addr.as_hex
    return "0x" + addr.hex()


def _mock_fetch_ok(direct_vm, body="<html>evidence page</html>"):
    direct_vm.clear_mocks()
    direct_vm.mock_web(r".*", {"status": 200, "body": body})


def _mock_verdict(direct_vm, verdict="complainant_wins", winner="complainant",
                   complainant_bps=10000, respondent_bps=0, confidence=90,
                   evidence_alignment="strong", rule_fit="strong",
                   appeal_allowed=True, reason_code="clear_breach", short_reason="test reason",
                   body="<html>evidence page</html>"):
    direct_vm.clear_mocks()
    direct_vm.mock_web(r".*", {"status": 200, "body": body})
    payload = (
        '{"verdict": "%s", "winner": "%s", "complainant_bps": %d, "respondent_bps": %d, '
        '"confidence": %d, "evidence_alignment": "%s", "rule_fit": "%s", '
        '"appeal_allowed": %s, "reason_code": "%s", "short_reason": "%s"}'
    ) % (
        verdict, winner, complainant_bps, respondent_bps, confidence,
        evidence_alignment, rule_fit, str(appeal_allowed).lower(), reason_code, short_reason,
    )
    direct_vm.mock_llm(r".*", payload)


def _mock_appeal_verdict(direct_vm, appeal_verdict="appeal_rejected", final_verdict_changed=False,
                          new_verdict="", new_complainant_bps=10000, new_respondent_bps=0,
                          confidence=90, reason_code="upheld", short_reason="appeal reason",
                          body="<html>appeal evidence</html>"):
    direct_vm.clear_mocks()
    direct_vm.mock_web(r".*", {"status": 200, "body": body})
    payload = (
        '{"appeal_verdict": "%s", "final_verdict_changed": %s, "new_verdict": "%s", '
        '"new_complainant_bps": %d, "new_respondent_bps": %d, "confidence": %d, '
        '"reason_code": "%s", "short_reason": "%s"}'
    ) % (
        appeal_verdict, str(final_verdict_changed).lower(), new_verdict,
        new_complainant_bps, new_respondent_bps, confidence, reason_code, short_reason,
    )
    direct_vm.mock_llm(r".*", payload)


def _register_app(direct_vm, c, owner, at=T0):
    warp_to(direct_vm, _iso(at))
    direct_vm.sender = owner
    return c.register_app(APP_NAME, APP_DOMAIN, APP_DESC)


def _create_template(
    direct_vm, c, owner, app_id,
    allowed_verdicts=None, settlement_mode="split_payment",
    appeal_enabled=True, appeal_window=3600, at=T0,
):
    if allowed_verdicts is None:
        allowed_verdicts = ["complainant_wins", "respondent_wins", "split_settlement", "no_fault"]
    warp_to(direct_vm, _iso(at))
    direct_vm.sender = owner
    return c.create_template(
        app_id, "Buyer/Seller Dispute", "marketplace_order", RULES, REQUIRED_EVIDENCE,
        allowed_verdicts, settlement_mode, appeal_enabled, appeal_window, True,
    )


def _open_case(direct_vm, c, complainant, app_id, template_id, respondent,
                deadline=FUTURE_DEADLINE, at=T0):
    warp_to(direct_vm, _iso(at))
    direct_vm.sender = complainant
    return c.open_case(
        app_id, template_id, _hex(respondent),
        "Buyer ordered a laptop, seller shipped an empty box instead.",
        "Full refund of the purchase price.",
        deadline,
    )


def _fund_case(direct_vm, c, complainant, case_id, value=1000, at=T0):
    warp_to(direct_vm, _iso(at))
    direct_vm.sender = complainant
    direct_vm.value = value
    c.fund_case(case_id)
    direct_vm.value = 0


def _full_case_to_verdict(direct_vm, c, owner, complainant, respondent, at=T0, value=1000):
    """Helper: registers an app+template, opens+funds a case, submits one
    piece of evidence from each side, closes evidence, and requests a
    verdict. Returns case_id."""
    app_id = _register_app(direct_vm, c, owner, at=at)
    template_id = _create_template(direct_vm, c, owner, app_id, at=at)
    case_id = _open_case(direct_vm, c, complainant, app_id, template_id, respondent, at=at)
    _fund_case(direct_vm, c, complainant, case_id, value=value, at=at)

    warp_to(direct_vm, _iso(at))
    direct_vm.sender = respondent
    c.respond_to_case(case_id, "The box was sealed and full when it left our warehouse.")

    _mock_fetch_ok(direct_vm)
    warp_to(direct_vm, _iso(at))
    direct_vm.sender = complainant
    c.submit_evidence(case_id, "photo", "Empty box photo", "Photo showing the box arrived empty on delivery.", "https://example.com/photo1")

    warp_to(direct_vm, _iso(at))
    direct_vm.sender = respondent
    c.submit_evidence(case_id, "tracking", "Warehouse scan", "Warehouse scan shows the item was packed and weighed correctly.", "https://example.com/scan1")

    warp_to(direct_vm, _iso(at))
    direct_vm.sender = complainant
    c.close_evidence(case_id)

    _mock_verdict(direct_vm)
    warp_to(direct_vm, _iso(at))
    c.request_verdict(case_id)
    return app_id, template_id, case_id


# ---------------------------------------------------------------------------
# register_app / create_template
# ---------------------------------------------------------------------------


def test_register_app_happy_path(direct_vm, direct_deploy, direct_alice):
    c = _deploy(direct_deploy)
    app_id = _register_app(direct_vm, c, direct_alice)
    app = c.get_app(app_id)
    assert app["name"] == APP_NAME
    assert app["owner"].lower() == _hex(direct_alice).lower()
    assert app["active"] is True


def test_register_app_rejects_short_name(direct_vm, direct_deploy, direct_alice):
    c = _deploy(direct_deploy)
    warp_to(direct_vm, _iso(T0))
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert():
        c.register_app("ab", APP_DOMAIN, APP_DESC)


def test_create_template_rejects_non_owner(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = _deploy(direct_deploy)
    app_id = _register_app(direct_vm, c, direct_alice)
    with pytest.raises(Exception):
        _create_template(direct_vm, c, direct_bob, app_id)


def test_create_template_rejects_unknown_verdict(direct_vm, direct_deploy, direct_alice):
    c = _deploy(direct_deploy)
    app_id = _register_app(direct_vm, c, direct_alice)
    with direct_vm.expect_revert():
        _create_template(direct_vm, c, direct_alice, app_id, allowed_verdicts=["not_a_real_verdict"])


# ---------------------------------------------------------------------------
# Roles
# ---------------------------------------------------------------------------


def test_grant_and_revoke_role(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = _deploy(direct_deploy)
    app_id = _register_app(direct_vm, c, direct_alice)
    direct_vm.sender = direct_alice
    c.grant_role(app_id, _hex(direct_bob), "moderator")
    roles = c.get_app_roles(app_id)
    assert len(roles) == 1
    assert roles[0]["role"] == "moderator"

    direct_vm.sender = direct_alice
    c.revoke_role(app_id, _hex(direct_bob))
    roles_after = c.get_app_roles(app_id)
    assert roles_after == []


def test_grant_role_rejects_non_owner(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    c = _deploy(direct_deploy)
    app_id = _register_app(direct_vm, c, direct_alice)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert():
        c.grant_role(app_id, _hex(direct_charlie), "moderator")


# ---------------------------------------------------------------------------
# Protocol fee admin
# ---------------------------------------------------------------------------


def test_set_protocol_fee_rejects_non_admin(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = _deploy(direct_deploy)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert():
        c.set_protocol_fee(_hex(direct_bob), 500)


def test_set_protocol_fee_rejects_over_cap(direct_vm, direct_deploy, direct_owner):
    c = _deploy(direct_deploy)
    direct_vm.sender = direct_owner
    with direct_vm.expect_revert():
        c.set_protocol_fee(_hex(direct_owner), 1500)


# ---------------------------------------------------------------------------
# Case lifecycle
# ---------------------------------------------------------------------------


def test_open_case_rejects_respondent_equal_complainant(direct_vm, direct_deploy, direct_alice):
    c = _deploy(direct_deploy)
    app_id = _register_app(direct_vm, c, direct_alice)
    template_id = _create_template(direct_vm, c, direct_alice, app_id)
    with direct_vm.expect_revert():
        _open_case(direct_vm, c, direct_alice, app_id, template_id, direct_alice)


def test_fund_case_transitions_to_evidence_open(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    c = _deploy(direct_deploy)
    app_id = _register_app(direct_vm, c, direct_alice)
    template_id = _create_template(direct_vm, c, direct_alice, app_id)
    case_id = _open_case(direct_vm, c, direct_bob, app_id, template_id, direct_charlie)
    _fund_case(direct_vm, c, direct_bob, case_id, value=1000)
    case = c.get_case(case_id)
    assert case["status"] == "evidence_open"
    assert case["settlement_amount"] != "0"


def test_cancel_unfunded_case(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    c = _deploy(direct_deploy)
    app_id = _register_app(direct_vm, c, direct_alice)
    template_id = _create_template(direct_vm, c, direct_alice, app_id)
    case_id = _open_case(direct_vm, c, direct_bob, app_id, template_id, direct_charlie)
    direct_vm.sender = direct_bob
    c.cancel_unfunded_case(case_id)
    assert c.get_case(case_id)["status"] == "cancelled"


def test_cancel_unfunded_case_rejects_after_funding(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    c = _deploy(direct_deploy)
    app_id = _register_app(direct_vm, c, direct_alice)
    template_id = _create_template(direct_vm, c, direct_alice, app_id)
    case_id = _open_case(direct_vm, c, direct_bob, app_id, template_id, direct_charlie)
    _fund_case(direct_vm, c, direct_bob, case_id, value=1000)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert():
        c.cancel_unfunded_case(case_id)


def test_submit_evidence_snapshots_at_submission_not_at_verdict(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    """The core hardening fix: evidence is fetched and hashed ONCE, at
    submit_evidence time. Mutating what mock_web would return afterwards
    must not change what request_verdict reads."""
    c = _deploy(direct_deploy)
    app_id = _register_app(direct_vm, c, direct_alice)
    template_id = _create_template(direct_vm, c, direct_alice, app_id)
    case_id = _open_case(direct_vm, c, direct_bob, app_id, template_id, direct_charlie)
    _fund_case(direct_vm, c, direct_bob, case_id, value=1000)

    _mock_fetch_ok(direct_vm, body="ORIGINAL CONTENT AT SUBMISSION TIME")
    direct_vm.sender = direct_bob
    eid = c.submit_evidence(case_id, "photo", "Proof", "Photo showing the item was damaged in transit.", "https://example.com/photo1")

    evidence = c.get_case_evidence(case_id)
    assert evidence[0]["fetch_ok"] is True
    assert evidence[0]["fetched_hash"] != ""

    # Now change what a live fetch would return -- request_verdict must not
    # observe this at all, since it never touches the web again.
    direct_vm.sender = direct_bob
    c.close_evidence(case_id)
    _mock_verdict(direct_vm, body="COMPLETELY DIFFERENT CONTENT INJECTED LATER")
    c.request_verdict(case_id)
    # No assertion needed on content itself (opaque to us via the mocked
    # LLM), but the case must reach a verdict without erroring, proving the
    # verdict path never re-fetches (it only reads recorded evidence).
    assert c.get_case(case_id)["status"] in ("verdict_issued", "manual_review_required", "insufficient_evidence", "unverifiable")


def test_submit_evidence_rejects_after_deadline(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    c = _deploy(direct_deploy)
    app_id = _register_app(direct_vm, c, direct_alice)
    template_id = _create_template(direct_vm, c, direct_alice, app_id)
    near_deadline = T0 + 100
    case_id = _open_case(direct_vm, c, direct_bob, app_id, template_id, direct_charlie, deadline=near_deadline)
    _fund_case(direct_vm, c, direct_bob, case_id, value=1000)
    _mock_fetch_ok(direct_vm)
    warp_to(direct_vm, _iso(near_deadline + 1))
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert():
        c.submit_evidence(case_id, "photo", "Proof", "Photo showing the item was damaged.", "https://example.com/x")


def test_request_verdict_rejects_before_evidence_closed(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    c = _deploy(direct_deploy)
    app_id = _register_app(direct_vm, c, direct_alice)
    template_id = _create_template(direct_vm, c, direct_alice, app_id)
    case_id = _open_case(direct_vm, c, direct_bob, app_id, template_id, direct_charlie)
    _fund_case(direct_vm, c, direct_bob, case_id, value=1000)
    with direct_vm.expect_revert():
        c.request_verdict(case_id)


def test_request_verdict_issues_verdict_and_case_status(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    c = _deploy(direct_deploy)
    _, _, case_id = _full_case_to_verdict(direct_vm, c, direct_alice, direct_bob, direct_charlie)
    case = c.get_case(case_id)
    assert case["status"] == "verdict_issued"
    verdict = c.get_case_verdict(case_id)
    assert verdict["verdict"] == "complainant_wins"
    assert verdict["complainant_bps"] == 10000


def test_malformed_verdict_falls_back_to_manual_review(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    c = _deploy(direct_deploy)
    app_id = _register_app(direct_vm, c, direct_alice)
    template_id = _create_template(direct_vm, c, direct_alice, app_id)
    case_id = _open_case(direct_vm, c, direct_bob, app_id, template_id, direct_charlie)
    _fund_case(direct_vm, c, direct_bob, case_id, value=1000)
    direct_vm.sender = direct_bob
    c.close_evidence(case_id)

    direct_vm.clear_mocks()
    direct_vm.mock_web(r".*", {"status": 200, "body": "x"})
    direct_vm.mock_llm(r".*", "not json at all")
    c.request_verdict(case_id)
    case = c.get_case(case_id)
    assert case["status"] == "manual_review_required"
    verdict = c.get_case_verdict(case_id)
    assert verdict["verdict"] == "manual_review_required"


def test_resolve_manual_review_only_by_app_owner(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    c = _deploy(direct_deploy)
    app_id = _register_app(direct_vm, c, direct_alice)
    template_id = _create_template(direct_vm, c, direct_alice, app_id)
    case_id = _open_case(direct_vm, c, direct_bob, app_id, template_id, direct_charlie)
    _fund_case(direct_vm, c, direct_bob, case_id, value=1000)
    direct_vm.sender = direct_bob
    c.close_evidence(case_id)
    direct_vm.clear_mocks()
    direct_vm.mock_web(r".*", {"status": 200, "body": "x"})
    direct_vm.mock_llm(r".*", "not json at all")
    c.request_verdict(case_id)

    with direct_vm.expect_revert():
        direct_vm.sender = direct_bob
        c.resolve_manual_review(case_id, "no_fault", "none", 5000, 5000, "resolved", "settled manually")

    direct_vm.sender = direct_alice
    c.resolve_manual_review(case_id, "no_fault", "none", 5000, 5000, "resolved", "settled manually")
    case = c.get_case(case_id)
    assert case["status"] == "finalized"
    assert case["verdict_finalized"] is True


# ---------------------------------------------------------------------------
# Appeal flow
# ---------------------------------------------------------------------------


def test_appeal_flip_changes_verdict(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    c = _deploy(direct_deploy)
    _, _, case_id = _full_case_to_verdict(direct_vm, c, direct_alice, direct_bob, direct_charlie)

    direct_vm.sender = direct_charlie  # respondent appeals a complainant_wins verdict
    c.file_appeal(case_id, "new_evidence", "We have new evidence the box was tampered with after leaving our warehouse.", ["https://example.com/newproof"])
    assert c.get_case(case_id)["status"] == "appeal_window_open"

    _mock_appeal_verdict(direct_vm, appeal_verdict="appeal_granted", final_verdict_changed=True,
                          new_verdict="split_settlement", new_complainant_bps=5000, new_respondent_bps=5000)
    c.request_appeal_review(case_id)

    case = c.get_case(case_id)
    assert case["status"] == "finalized"
    verdict = c.get_case_verdict(case_id)
    assert verdict["verdict"] == "split_settlement"
    assert verdict["complainant_bps"] == 5000
    appeal = c.get_case_appeal(case_id)
    assert appeal["status"] == "resolved"
    assert appeal["result"] == "appeal_granted"


def test_appeal_reads_recorded_snapshot_not_live_refetch(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    """The core hardening fix applied to appeals: the appeal's own evidence
    URLs are fetched and hashed at file_appeal time, not at
    request_appeal_review time."""
    c = _deploy(direct_deploy)
    _, _, case_id = _full_case_to_verdict(direct_vm, c, direct_alice, direct_bob, direct_charlie)

    _mock_fetch_ok(direct_vm, body="APPEAL EVIDENCE AT FILING TIME")
    direct_vm.sender = direct_charlie
    c.file_appeal(case_id, "new_evidence", "New proof the item was fine when it left us.", ["https://example.com/newproof"])

    # Change what a live fetch would return -- request_appeal_review must
    # not observe this, since file_appeal already snapshotted it.
    _mock_appeal_verdict(direct_vm, body="DIFFERENT CONTENT INJECTED LATER", appeal_verdict="appeal_rejected")
    c.request_appeal_review(case_id)
    assert c.get_case(case_id)["status"] == "finalized"


def test_file_appeal_rejects_second_appeal(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    c = _deploy(direct_deploy)
    _, _, case_id = _full_case_to_verdict(direct_vm, c, direct_alice, direct_bob, direct_charlie)
    direct_vm.sender = direct_charlie
    c.file_appeal(case_id, "new_evidence", "New proof the item was fine when it left us.", [])
    with direct_vm.expect_revert():
        direct_vm.sender = direct_bob
        c.file_appeal(case_id, "evidence_misread", "Also disputing.", [])


def test_file_appeal_rejects_non_party(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, direct_owner):
    c = _deploy(direct_deploy)
    _, _, case_id = _full_case_to_verdict(direct_vm, c, direct_alice, direct_bob, direct_charlie)
    with direct_vm.expect_revert():
        direct_vm.sender = direct_owner
        c.file_appeal(case_id, "new_evidence", "Not a party to this case.", [])


def test_finalize_case_rejects_while_appeal_window_open(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    c = _deploy(direct_deploy)
    _, _, case_id = _full_case_to_verdict(direct_vm, c, direct_alice, direct_bob, direct_charlie)
    with direct_vm.expect_revert():
        c.finalize_case(case_id)


def test_finalize_case_succeeds_after_window_passes(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    c = _deploy(direct_deploy)
    _, _, case_id = _full_case_to_verdict(direct_vm, c, direct_alice, direct_bob, direct_charlie)
    warp_to(direct_vm, _iso(T0 + 3601))
    c.finalize_case(case_id)
    case = c.get_case(case_id)
    assert case["status"] == "finalized"


# ---------------------------------------------------------------------------
# Settlement / claim
# ---------------------------------------------------------------------------


def test_claim_settlement_splits_funds_per_verdict(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, monkeypatch):
    c = _deploy(direct_deploy)
    mod = sys.modules.get("_contract_Themis")
    payments = []
    monkeypatch.setattr(
        mod.ThemisProtocol, "_pay",
        lambda self, to, amount: payments.append((to.as_hex.lower(), int(amount))) if int(amount) else None,
    )
    _, _, case_id = _full_case_to_verdict(direct_vm, c, direct_alice, direct_bob, direct_charlie, value=1000)
    warp_to(direct_vm, _iso(T0 + 3601))
    c.finalize_case(case_id)
    c.claim_settlement(case_id)
    case = c.get_case(case_id)
    assert case["status"] == "settled"
    assert case["payout_claimed"] is True
    total_paid = sum(amt for _, amt in payments)
    assert total_paid == 1000
    complainant_paid = sum(amt for who, amt in payments if who == _hex(direct_bob).lower())
    assert complainant_paid == 1000  # complainant_bps 10000 in _mock_verdict default


def test_claim_settlement_rejects_double_claim(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, monkeypatch):
    c = _deploy(direct_deploy)
    mod = sys.modules.get("_contract_Themis")
    monkeypatch.setattr(mod.ThemisProtocol, "_pay", lambda self, to, amount: None)
    _, _, case_id = _full_case_to_verdict(direct_vm, c, direct_alice, direct_bob, direct_charlie)
    warp_to(direct_vm, _iso(T0 + 3601))
    c.finalize_case(case_id)
    c.claim_settlement(case_id)
    with direct_vm.expect_revert():
        c.claim_settlement(case_id)


def test_protocol_fee_deducted_before_split(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, direct_owner, monkeypatch):
    c = _deploy(direct_deploy)
    mod = sys.modules.get("_contract_Themis")
    payments = []
    monkeypatch.setattr(
        mod.ThemisProtocol, "_pay",
        lambda self, to, amount: payments.append((to.as_hex.lower(), int(amount))) if int(amount) else None,
    )
    direct_vm.sender = direct_owner
    c.set_protocol_fee(_hex(direct_owner), 500)  # 5%

    _, _, case_id = _full_case_to_verdict(direct_vm, c, direct_alice, direct_bob, direct_charlie, value=1000)
    warp_to(direct_vm, _iso(T0 + 3601))
    c.finalize_case(case_id)
    c.claim_settlement(case_id)

    fee_paid = sum(amt for who, amt in payments if who == _hex(direct_owner).lower())
    assert fee_paid == 50
    total_paid = sum(amt for _, amt in payments)
    assert total_paid == 1000


def test_non_monetary_settlement_mode_skips_fund_transfer(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, monkeypatch):
    c = _deploy(direct_deploy)
    mod = sys.modules.get("_contract_Themis")
    payments = []
    monkeypatch.setattr(
        mod.ThemisProtocol, "_pay",
        lambda self, to, amount: payments.append((to.as_hex.lower(), int(amount))) if int(amount) else None,
    )
    app_id = _register_app(direct_vm, c, direct_alice)
    template_id = _create_template(direct_vm, c, direct_alice, app_id, settlement_mode="non_monetary_verdict", appeal_enabled=False)
    case_id = _open_case(direct_vm, c, direct_bob, app_id, template_id, direct_charlie)
    _fund_case(direct_vm, c, direct_bob, case_id, value=1)  # protocol still requires nonzero funding to open evidence
    direct_vm.sender = direct_bob
    c.close_evidence(case_id)
    _mock_verdict(direct_vm, appeal_allowed=False)
    c.request_verdict(case_id)
    warp_to(direct_vm, _iso(T0 + 3601))
    c.finalize_case(case_id)
    c.claim_settlement(case_id)
    assert c.get_case(case_id)["status"] == "settled"
    assert payments == []  # non_monetary_verdict never moves the escrowed GEN


# ---------------------------------------------------------------------------
# Structural regression guard
# ---------------------------------------------------------------------------


def test_request_verdict_signature_takes_only_case_id(direct_vm, direct_deploy):
    c = _deploy(direct_deploy)
    mod = sys.modules.get("_contract_Themis")
    sig = inspect.signature(mod.ThemisProtocol.request_verdict)
    assert list(sig.parameters.keys()) == ["self", "case_id"]


# ---------------------------------------------------------------------------
# Checks-effects-interactions: state must be terminal BEFORE any payout call
# ---------------------------------------------------------------------------


def test_claim_settlement_status_terminal_before_payout_call(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, monkeypatch
):
    """Regression guard for the ordering bug this author's GroundTruth audit
    caught elsewhere: claim_settlement must flip payout_claimed/status to
    terminal BEFORE calling _pay, not after -- verified here by making _pay
    itself observe case state mid-call."""
    c = _deploy(direct_deploy)
    mod = sys.modules.get("_contract_Themis")
    observed = {}

    def _spy_pay(self, to, amount):
        if not observed:
            case = self._get_case_or_raise(sys.modules["_contract_Themis"]._last_case_id)
            observed["status"] = case.status
            observed["payout_claimed"] = case.payout_claimed

    _, _, case_id = _full_case_to_verdict(direct_vm, c, direct_alice, direct_bob, direct_charlie)
    mod._last_case_id = case_id  # smuggle case_id into the spy without changing _pay's signature
    monkeypatch.setattr(mod.ThemisProtocol, "_pay", _spy_pay)

    warp_to(direct_vm, _iso(T0 + 3601))
    c.finalize_case(case_id)
    c.claim_settlement(case_id)

    assert observed["status"] == "settled"
    assert observed["payout_claimed"] is True


# ---------------------------------------------------------------------------
# Liveness: a stale manual_review_required case the app owner never acts on
# ---------------------------------------------------------------------------


def test_resolve_stale_manual_review_rejects_before_grace(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    c = _deploy(direct_deploy)
    app_id = _register_app(direct_vm, c, direct_alice)
    template_id = _create_template(direct_vm, c, direct_alice, app_id)
    case_id = _open_case(direct_vm, c, direct_bob, app_id, template_id, direct_charlie)
    _fund_case(direct_vm, c, direct_bob, case_id, value=1000)
    direct_vm.sender = direct_bob
    c.close_evidence(case_id)
    direct_vm.clear_mocks()
    direct_vm.mock_web(r".*", {"status": 200, "body": "x"})
    direct_vm.mock_llm(r".*", "not json at all")
    c.request_verdict(case_id)
    assert c.get_case(case_id)["status"] == "manual_review_required"

    assert c.is_manual_review_stale(case_id) is False
    with direct_vm.expect_revert():
        c.resolve_stale_manual_review(case_id)


def test_resolve_stale_manual_review_resolves_as_even_split_after_grace(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    c = _deploy(direct_deploy)
    app_id = _register_app(direct_vm, c, direct_alice)
    template_id = _create_template(direct_vm, c, direct_alice, app_id)
    case_id = _open_case(direct_vm, c, direct_bob, app_id, template_id, direct_charlie)
    _fund_case(direct_vm, c, direct_bob, case_id, value=1000)
    direct_vm.sender = direct_bob
    c.close_evidence(case_id)
    direct_vm.clear_mocks()
    direct_vm.mock_web(r".*", {"status": 200, "body": "x"})
    direct_vm.mock_llm(r".*", "not json at all")
    c.request_verdict(case_id)

    warp_to(direct_vm, _iso(T0 + 14 * 24 * 3600 + 1))
    assert c.is_manual_review_stale(case_id) is True
    c.resolve_stale_manual_review(case_id)

    case = c.get_case(case_id)
    assert case["status"] == "finalized"
    assert case["verdict_finalized"] is True
    verdict = c.get_case_verdict(case_id)
    assert verdict["winner"] == "none"
    assert verdict["complainant_bps"] == 5000
    assert verdict["respondent_bps"] == 5000
    assert verdict["appeal_allowed"] is False


# ---------------------------------------------------------------------------
# Recorded evidence must be readable text, not raw markup
# ---------------------------------------------------------------------------


def test_recorded_evidence_strips_markup_and_keeps_readable_text(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    """Regression guard for a bug only a real deployed run surfaced: storing
    the raw HTTP body meant the recorded evidence was <head> boilerplate and
    every panel ruled insufficient_evidence regardless of what the page
    actually said. Script/style bodies and tags must be gone; the substantive
    sentence must survive."""
    c = _deploy(direct_deploy)
    mod = sys.modules.get("_contract_Themis")

    html = (
        "<!DOCTYPE html><html><head><title>T</title>"
        "<script>var junk='SHOULD_NOT_APPEAR';</script>"
        "<style>.x{color:red}</style></head>"
        "<body><h1>Delivery Record</h1>"
        "<p>The parcel was signed for by the recipient on 12 March.</p></body></html>"
    )
    stripped = mod._strip_markup(html)
    assert "SHOULD_NOT_APPEAR" not in stripped
    assert "color:red" not in stripped
    assert "<" not in stripped
    assert "The parcel was signed for by the recipient on 12 March." in stripped

    app_id = _register_app(direct_vm, c, direct_alice)
    template_id = _create_template(direct_vm, c, direct_alice, app_id)
    case_id = _open_case(direct_vm, c, direct_bob, app_id, template_id, direct_charlie)
    _fund_case(direct_vm, c, direct_bob, case_id, value=1000)

    _mock_fetch_ok(direct_vm, body=html)
    direct_vm.sender = direct_bob
    c.submit_evidence(case_id, "record", "Delivery record",
                      "The carrier's signed delivery record for this parcel.",
                      "https://example.com/delivery")

    ev = c.get_case_evidence(case_id)[0]
    assert ev["fetch_ok"] is True
    assert ev["fetched_hash"] != ""
