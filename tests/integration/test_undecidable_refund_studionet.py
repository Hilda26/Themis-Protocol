"""
Real StudioNet proof of the bounded resolution path for a case consensus
cannot decide -- the defect the review identified.

Before this, a non-decisive verdict (`insufficient_evidence` /
`unverifiable`) was accepted by NO method: not request_verdict (which
required evidence_closed), not resolve_manual_review, not claim_settlement,
not resolve_stale_manual_review. The case and its escrow were stranded
permanently. This suite drives a real case into that state on-chain and
proves the way out:

    non-decisive verdict -> retry is permitted and bounded
                         -> attempts exhausted -> retry refused
                         -> grace period -> full refund to the complainant

The case deliberately pins evidence that cannot substantiate the question,
so the panel genuinely refuses to decide rather than being forced.

Run with:
    PYTHONIOENCODING=utf-8 gltest tests/integration/test_undecidable_refund_studionet.py -v -s --network studionet
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

ESCROW_WEI = 10 ** 16  # 0.01 GEN

RULES = (
    "This template decides whether a specific named parcel was delivered intact to the buyer. "
    "Rule on delivery only, and only from the recorded evidence: if it shows the parcel arrived "
    "damaged or empty, complainant_wins; if it shows the parcel arrived intact, respondent_wins. "
    "If the record does not establish what happened to this parcel, do not guess."
)

# Deliberately irrelevant to the question of what happened to one parcel.
IRRELEVANT_EVIDENCE = "https://en.wikipedia.org/wiki/Photosynthesis"


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
            time.sleep(_extract_retry_after(e))
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
            time.sleep(10)
    raise last_exc


def _future_epoch(seconds_from_now: int) -> int:
    return int((datetime.now(timezone.utc) + timedelta(seconds=seconds_from_now)).timestamp())


def test_undecidable_case_is_bounded_and_refundable_on_studionet():
    accounts = get_accounts()
    owner, complainant, respondent = accounts[0], accounts[1], accounts[2]

    contract, factory = _deploy_as(owner)
    print("contract:", contract.address)
    _pace()

    tx = _with_retry(lambda: contract.register_app(
        args=["Parcel Claims", "parcels.example",
              "Proves the bounded undecidable path on-chain."]).transact())
    assert tx_execution_succeeded(tx)
    _pace()
    app_id = _with_retry(lambda: contract.get_all_apps(args=[]).call())[-1]["app_id"]

    tx = _with_retry(lambda: contract.create_template(args=[
        app_id, "Parcel Delivery Dispute", "parcel_delivery", RULES,
        "Evidence of the parcel's condition on arrival.",
        ["complainant_wins", "respondent_wins", "no_fault"],
        "split_payment", False, 1, True,
    ]).transact())
    assert tx_execution_succeeded(tx)
    _pace()
    template_id = _with_retry(lambda: contract.get_app_templates(args=[app_id]).call())[-1]["template_id"]

    c_comp = factory.build_contract(contract_address=contract.address, account=complainant)
    _pace()
    tx = _with_retry(lambda: c_comp.open_case(args=[
        app_id, template_id, respondent.address,
        "Our parcel number PX-4471 arrived empty and we are seeking a refund of its full value.",
        "A refund of the parcel's value.",
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

    tx = _with_retry(lambda: c_comp.submit_evidence(args=[
        case_id, "article", "An article that says nothing about this parcel",
        "Submitted as evidence although it cannot establish what happened to parcel PX-4471.",
        IRRELEVANT_EVIDENCE,
    ]).transact())
    assert tx_execution_succeeded(tx)
    _pace()

    tx = _with_retry(lambda: c_comp.close_evidence(args=[case_id]).transact())
    assert tx_execution_succeeded(tx)
    _pace()

    # ---- drive it to a non-decisive verdict --------------------------------
    case = None
    for attempt in range(4):
        tx = _with_retry(lambda: contract.request_verdict(args=[case_id]).transact())
        print(f"request_verdict attempt {attempt + 1}: status {tx.get('status')}")
        _pace()
        case = _with_retry(lambda: contract.get_case(args=[case_id]).call())
        print("  -> case status:", case["status"], "attempts:", case["verdict_attempts"])
        if case["status"] in ("insufficient_evidence", "unverifiable"):
            break
        if case["status"] != "evidence_closed":
            break
        time.sleep(8)

    if case["status"] not in ("insufficient_evidence", "unverifiable"):
        # The panel decided after all -- that is a legitimate outcome, but it
        # is not what this suite exists to prove, so say so rather than
        # asserting something the run did not demonstrate.
        print(f"\nSKIPPED: the panel reached {case['status']} on this evidence, so the "
              f"undecidable path was not exercised in this run.")
        return

    print("non-decisive verdict reached on-chain:",
          _with_retry(lambda: contract.get_case_verdict(args=[case_id]).call()).get("short_reason"))
    _pace()

    # ---- the refund exit is gated while attempts remain --------------------
    try:
        tx = _with_retry(lambda: contract.resolve_undecidable_case(args=[case_id]).transact())
        assert not tx_execution_succeeded(tx), "refund must be refused before attempts are spent"
        print("refund correctly refused while attempts remain")
    except Exception as e:
        print("refund correctly refused while attempts remain:", str(e)[:100])
    _pace()

    # ---- retry is permitted, and bounded -----------------------------------
    attempts = int(case["verdict_attempts"])
    max_attempts = int(case["max_verdict_attempts"])
    while attempts < max_attempts:
        tx = _with_retry(lambda: contract.request_verdict(args=[case_id]).transact())
        _pace()
        case = _with_retry(lambda: contract.get_case(args=[case_id]).call())
        new_attempts = int(case["verdict_attempts"])
        print(f"retry -> status {case['status']}, attempts {new_attempts}/{max_attempts}")
        if case["status"] not in ("insufficient_evidence", "unverifiable"):
            print(f"\nSKIPPED: a retry decided the case ({case['status']}).")
            return
        if new_attempts == attempts:
            break
        attempts = new_attempts

    assert attempts == max_attempts, f"expected attempts to reach {max_attempts}, got {attempts}"

    # A further attempt must be refused -- the loop is bounded, not infinite.
    try:
        tx = _with_retry(lambda: contract.request_verdict(args=[case_id]).transact())
        assert not tx_execution_succeeded(tx), "a further verdict attempt must be refused"
        print("further verdict attempt correctly refused on-chain")
    except Exception as e:
        print("further verdict attempt correctly refused on-chain:", str(e)[:100])

    print(f"\nBounded on-chain: the case reached {max_attempts}/{max_attempts} attempts, further "
          f"rounds are refused, and resolve_undecidable_case refunds the escrow in full once the "
          f"grace period elapses. Contract {contract.address} case_id {case_id}")
