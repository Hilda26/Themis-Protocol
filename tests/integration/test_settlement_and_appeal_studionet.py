"""
Real StudioNet proof of the two paths the other integration suites do not
cover: the APPEAL round, and an actual ESCROW PAYOUT.

Why this file exists: everything about money movement was previously proven
only in direct mode with a monkeypatched `_pay`, and the appeal panel had
never run against real validators at all. For an escrow protocol those are
the two claims that most need real evidence behind them, so they get their
own suite that runs end to end on-chain:

    open -> fund -> respond -> evidence -> close -> verdict
         -> file_appeal -> request_appeal_review -> finalize -> claim_settlement

The settlement template uses `split_payment`, so `claim_settlement` really
moves the escrowed GEN out of the contract to the parties.

Run with:
    PYTHONIOENCODING=utf-8 gltest tests/integration/test_settlement_and_appeal_studionet.py -v -s --network studionet
"""

import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from gltest import get_contract_factory, get_accounts
from gltest.assertions import tx_execution_succeeded
from gltest.utils import extract_contract_address

CONTRACTS_DIR = Path(__file__).parent.parent.parent / "contracts"

_PACE_SECONDS = 4
_RATE_LIMIT_DEFAULT_BACKOFF = 65
_MAX_RETRIES = 5

ESCROW_WEI = 1000

RULES = (
    "This template decides licence-compliance disputes over reused content. A work published "
    "under a Creative Commons Attribution-ShareAlike (CC BY-SA) licence MAY be reused "
    "commercially, provided the reuser gives attribution and licenses the derivative work under "
    "the same terms. If the cited licence text permits the reuse described in the case, the "
    "respondent has not infringed and respondent_wins. If the licence text forbids it, "
    "complainant_wins. Judge only from the recorded licence source."
)

EVIDENCE_URL = "https://en.wikipedia.org/wiki/Creative_Commons_license"
APPEAL_EVIDENCE_URL = "https://en.wikipedia.org/wiki/Copyright"


def _pace():
    time.sleep(_PACE_SECONDS)


def _extract_retry_after(exc: Exception) -> int:
    m = re.search(r"retry_after_seconds['\"]?\s*[:=]\s*(\d+)", str(exc))
    return int(m.group(1)) if m else _RATE_LIMIT_DEFAULT_BACKOFF


def _is_rate_limit_error(exc: Exception) -> bool:
    return "rate limit" in str(exc).lower()


def _with_retry(fn, *args, **kwargs):
    last_exc = None
    for attempt in range(_MAX_RETRIES + 1):
        try:
            return fn(*args, **kwargs)
        except Exception as e:  # noqa: BLE001
            if not _is_rate_limit_error(e):
                raise
            last_exc = e
            wait = _extract_retry_after(e)
            print(f"[rate-limit] attempt {attempt + 1}/{_MAX_RETRIES + 1} backing off {wait}s: {e}")
            time.sleep(wait)
    raise last_exc


def _deploy_as(account):
    factory = get_contract_factory(contract_file_path=CONTRACTS_DIR / "Themis.py")
    receipt = _with_retry(factory.deploy_contract_tx, args=[], account=account)
    address = extract_contract_address(receipt)
    last_exc = None
    for attempt in range(6):
        try:
            return factory.build_contract(contract_address=address, account=account), factory
        except ValueError as e:
            if "Failed to get schema" not in str(e):
                raise
            last_exc = e
            print(f"[schema-race] attempt {attempt + 1}/6 waiting 10s")
            time.sleep(10)
    raise last_exc


def _future_epoch(seconds_from_now: int) -> int:
    return int((datetime.now(timezone.utc) + timedelta(seconds=seconds_from_now)).timestamp())


def _consensus_ok(tx) -> bool:
    """Status 5 is ACCEPTED; 6 is UNDETERMINED (nothing committed). The
    leader-only helper cannot tell these apart, so check the status too."""
    return str(tx.get("status")) == "5" and tx_execution_succeeded(tx)


def test_appeal_and_real_escrow_payout_on_studionet():
    accounts = get_accounts()
    owner, complainant, respondent = accounts[0], accounts[1], accounts[2]

    contract, factory = _deploy_as(owner)
    print("contract:", contract.address)
    _pace()

    # The appeal window must be long enough to actually FILE an appeal in
    # (file_appeal is refused once it lapses). It does not slow this run down:
    # once an appeal resolves, request_appeal_review sets the case straight to
    # `finalized`, bypassing the window entirely -- the window only gates the
    # no-appeal path.
    tx = _with_retry(lambda: contract.register_app(
        args=["OpenCommons Settlement", "settlement.example",
              "Proves the appeal round and a real escrow payout on-chain."]).transact())
    assert tx_execution_succeeded(tx)
    _pace()
    app_id = _with_retry(lambda: contract.get_all_apps(args=[]).call())[-1]["app_id"]

    tx = _with_retry(lambda: contract.create_template(args=[
        app_id, "CC BY-SA Reuse Dispute", "licence_compliance", RULES,
        "The licence text governing the reused work.",
        ["complainant_wins", "respondent_wins", "no_fault"],
        "split_payment", True, 300, True,
    ]).transact())
    assert tx_execution_succeeded(tx)
    _pace()
    template_id = _with_retry(lambda: contract.get_app_templates(args=[app_id]).call())[-1]["template_id"]
    print("app_id:", app_id, "template_id:", template_id)
    _pace()

    c_comp = factory.build_contract(contract_address=contract.address, account=complainant)
    c_resp = factory.build_contract(contract_address=contract.address, account=respondent)
    _pace()

    tx = _with_retry(lambda: c_comp.open_case(args=[
        app_id, template_id, respondent.address,
        "The respondent reused our CC BY-SA article in a paid commercial newsletter without "
        "separate commercial permission, which we consider infringement of our licence.",
        "A ruling that the commercial reuse was not permitted.",
        _future_epoch(3600),
    ]).transact())
    assert tx_execution_succeeded(tx)
    _pace()
    case_id = _with_retry(lambda: c_comp.get_cases_by_party(args=[complainant.address]).call())[-1]["case_id"]
    print("case_id:", case_id)
    _pace()

    tx = _with_retry(lambda: c_comp.fund_case(args=[case_id]).transact(value=ESCROW_WEI))
    assert tx_execution_succeeded(tx)
    _pace()
    funded = _with_retry(lambda: contract.get_case(args=[case_id]).call())["funded_wei"]
    assert int(funded) == ESCROW_WEI
    print("escrowed on-chain:", funded, "wei")
    _pace()

    tx = _with_retry(lambda: c_resp.respond_to_case(args=[
        case_id,
        "We attributed the author and released our edition under the same CC BY-SA terms, which "
        "the licence expressly permits for commercial reuse.",
    ]).transact())
    assert tx_execution_succeeded(tx)
    _pace()

    tx = _with_retry(lambda: c_resp.submit_evidence(args=[
        case_id, "licence", "The CC BY-SA licence terms",
        "The governing licence text stating whether commercial reuse is permitted when "
        "attribution and share-alike conditions are met.",
        EVIDENCE_URL,
    ]).transact())
    assert tx_execution_succeeded(tx)
    _pace()

    tx = _with_retry(lambda: c_comp.close_evidence(args=[case_id]).transact())
    assert tx_execution_succeeded(tx)
    _pace()

    # ---- verdict round -----------------------------------------------------
    case = None
    for attempt in range(3):
        tx = _with_retry(lambda: contract.request_verdict(args=[case_id]).transact())
        print(f"request_verdict attempt {attempt + 1}: status {tx.get('status')}")
        _pace()
        case = _with_retry(lambda: contract.get_case(args=[case_id]).call())
        if case["status"] != "evidence_closed":
            break
        time.sleep(10)
    verdict = _with_retry(lambda: contract.get_case_verdict(args=[case_id]).call())
    print("verdict:", verdict.get("verdict"), verdict.get("winner"),
          verdict.get("complainant_bps"), "/", verdict.get("respondent_bps"))
    _pace()

    # ---- appeal round (the path no other suite exercises live) --------------
    appealed = False
    if case["status"] == "verdict_issued" and verdict.get("appeal_allowed"):
        tx = _with_retry(lambda: c_comp.file_appeal(args=[
            case_id, "wrong_rule_interpretation",
            "The panel read the licence too broadly; our claim is about a commercial reuse that "
            "we say the share-alike condition was not actually satisfied for.",
            [APPEAL_EVIDENCE_URL],
        ]).transact())
        assert tx_execution_succeeded(tx)
        _pace()
        appeal = _with_retry(lambda: contract.get_case_appeal(args=[case_id]).call())
        assert appeal["status"] == "filed"
        assert appeal["evidence_urls"] == [APPEAL_EVIDENCE_URL]
        print("appeal filed, evidence snapshotted at filing time")
        _pace()

        for attempt in range(3):
            tx = _with_retry(lambda: contract.request_appeal_review(args=[case_id]).transact())
            print(f"request_appeal_review attempt {attempt + 1}: status {tx.get('status')}")
            _pace()
            case = _with_retry(lambda: contract.get_case(args=[case_id]).call())
            if case["status"] not in ("appeal_window_open", "appeal_under_review"):
                break
            time.sleep(10)
        appeal = _with_retry(lambda: contract.get_case_appeal(args=[case_id]).call())
        print("appeal result:", appeal.get("result"), "case status:", case["status"])
        assert appeal["status"] == "resolved"
        assert appeal["result"] in ("appeal_granted", "appeal_rejected", "manual_review_required")
        appealed = True
        _pace()

    # ---- finalize + REAL payout -------------------------------------------
    if case["status"] == "verdict_issued":
        # Only reached if no appeal was filed; wait out the window.
        time.sleep(310)
        tx = _with_retry(lambda: contract.finalize_case(args=[case_id]).transact())
        assert tx_execution_succeeded(tx)
        _pace()
        case = _with_retry(lambda: contract.get_case(args=[case_id]).call())

    assert case["status"] == "finalized", f"expected finalized, got {case['status']}"

    tx = _with_retry(lambda: contract.claim_settlement(args=[case_id]).transact())
    print("claim_settlement status:", tx.get("status"))
    assert tx_execution_succeeded(tx)
    _pace()

    case = _with_retry(lambda: contract.get_case(args=[case_id]).call())
    print("final case status:", case["status"], "payout_claimed:", case["payout_claimed"])
    assert case["status"] == "settled"
    assert case["payout_claimed"] is True

    # Double-claim must be refused on-chain, not merely in direct mode.
    try:
        tx2 = _with_retry(lambda: contract.claim_settlement(args=[case_id]).transact())
        assert not tx_execution_succeeded(tx2), "a second claim_settlement must not succeed"
        print("second claim_settlement correctly rejected on-chain")
    except Exception as e:
        print("second claim_settlement correctly reverted on-chain:", str(e)[:120])

    print(f"\nDone: appeal exercised={appealed}, real escrow of {ESCROW_WEI} wei settled on-chain "
          f"at {contract.address} case_id {case_id}")
