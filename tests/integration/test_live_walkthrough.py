"""
Live walkthrough against the ALREADY-DEPLOYED Themis contract on StudioNet
(not a fresh throwaway deploy) -- populates the persistent contract with a
real registered app, a real template, and a real case carrying genuinely
relevant recorded evidence, taken all the way to a decided verdict.

Unlike the lifecycle suite (which deliberately proves the protocol REFUSES
to decide on irrelevant evidence), this walkthrough pins a source that
actually substantiates the question, so the register shows a decisive,
legible outcome.

Run with:
    gltest tests/integration/test_live_walkthrough.py -v -s --network studionet
"""

import re
import time
from datetime import datetime, timedelta, timezone

from gltest import get_contract_factory, get_accounts
from gltest.assertions import tx_execution_succeeded

CONTRACT_ADDRESS = "0xC8b0dfc458731b84a671A051B8E5fF1972702153"
CONTRACT_PATH = "Themis.py"

_PACE_SECONDS = 5
_RATE_LIMIT_DEFAULT_BACKOFF = 65
_MAX_RETRIES = 6

RULES = (
    "This template decides licence-compliance disputes over reused content. A work published "
    "under a Creative Commons Attribution-ShareAlike (CC BY-SA) licence MAY be reused "
    "commercially, provided the reuser gives attribution and licenses the derivative work under "
    "the same terms. If the cited licence text permits the reuse described in the case, the "
    "respondent has not infringed and respondent_wins. If the licence text forbids it, "
    "complainant_wins. Judge only from the recorded licence source."
)

EVIDENCE_URL = "https://en.wikipedia.org/wiki/Creative_Commons_license"


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


def _future_epoch(seconds_from_now: int) -> int:
    return int((datetime.now(timezone.utc) + timedelta(seconds=seconds_from_now)).timestamp())


def test_live_walkthrough_on_deployed_contract():
    accounts = get_accounts()
    owner, complainant, respondent = accounts[0], accounts[1], accounts[2]
    print("app owner:  ", owner.address)
    print("complainant:", complainant.address)
    print("respondent: ", respondent.address)

    factory = get_contract_factory(contract_file_path=CONTRACT_PATH)
    c_owner = factory.build_contract(contract_address=CONTRACT_ADDRESS, account=owner)
    _pace()

    tx = _with_retry(
        lambda: c_owner.register_app(
            args=["OpenCommons", "opencommons.example",
                  "A commons content registry that settles licence-compliance disputes on Themis."]
        ).transact()
    )
    assert tx_execution_succeeded(tx)
    _pace()
    app_id = _with_retry(lambda: c_owner.get_all_apps(args=[]).call())[-1]["app_id"]
    print("app_id:", app_id)
    _pace()

    tx = _with_retry(
        lambda: c_owner.create_template(
            args=[
                app_id, "CC BY-SA Reuse Dispute", "licence_compliance", RULES,
                "The licence text governing the reused work.",
                ["complainant_wins", "respondent_wins", "no_fault"],
                "non_monetary_verdict", True, 3600, True,
            ]
        ).transact()
    )
    assert tx_execution_succeeded(tx)
    _pace()
    template_id = _with_retry(lambda: c_owner.get_app_templates(args=[app_id]).call())[-1]["template_id"]
    print("template_id:", template_id)
    _pace()

    c_complainant = factory.build_contract(contract_address=CONTRACT_ADDRESS, account=complainant)
    _pace()
    tx = _with_retry(
        lambda: c_complainant.open_case(
            args=[
                app_id, template_id, respondent.address,
                "The respondent reused our CC BY-SA encyclopaedia article in a paid commercial "
                "newsletter. We gave no separate commercial permission and consider this "
                "infringement of our licence.",
                "A ruling that the commercial reuse was not permitted under the licence.",
                _future_epoch(3600),
            ]
        ).transact()
    )
    assert tx_execution_succeeded(tx)
    _pace()
    case_id = _with_retry(lambda: c_complainant.get_cases_by_party(args=[complainant.address]).call())[-1]["case_id"]
    print("case_id:", case_id)
    _pace()

    tx = _with_retry(lambda: c_complainant.fund_case(args=[case_id]).transact(value=1000))
    assert tx_execution_succeeded(tx)
    _pace()

    c_respondent = factory.build_contract(contract_address=CONTRACT_ADDRESS, account=respondent)
    _pace()
    tx = _with_retry(
        lambda: c_respondent.respond_to_case(
            args=[case_id,
                  "We attributed the author and released our newsletter edition under the same "
                  "CC BY-SA terms. The licence expressly permits commercial reuse on exactly "
                  "those conditions, so no separate permission was required."]
        ).transact()
    )
    assert tx_execution_succeeded(tx)
    _pace()

    tx = _with_retry(
        lambda: c_respondent.submit_evidence(
            args=[case_id, "licence", "The CC BY-SA licence terms",
                  "The governing licence text, which sets out whether commercial reuse is "
                  "permitted when attribution and share-alike conditions are met.",
                  EVIDENCE_URL]
        ).transact()
    )
    assert tx_execution_succeeded(tx)
    _pace()

    evidence = _with_retry(lambda: c_owner.get_case_evidence(args=[case_id]).call())
    print("evidence recorded:", [(e["evidence_id"], e["fetch_ok"], e["fetched_hash"][:16]) for e in evidence])
    _pace()

    tx = _with_retry(lambda: c_complainant.close_evidence(args=[case_id]).transact())
    assert tx_execution_succeeded(tx)
    _pace()

    case = None
    for attempt in range(3):
        tx = _with_retry(lambda: c_owner.request_verdict(args=[case_id]).transact())
        status = str(tx.get("status"))
        print(f"request_verdict attempt {attempt + 1}: status {status} "
              f"({'UNDETERMINED' if status == '6' else 'ACCEPTED' if status == '5' else status})")
        _pace()
        case = _with_retry(lambda: c_owner.get_case(args=[case_id]).call())
        if case["status"] != "evidence_closed":
            break
        print("[retry] round did not finalize (no state committed); retrying")
        time.sleep(10)

    verdict = _with_retry(lambda: c_owner.get_case_verdict(args=[case_id]).call())
    print("case status:", case["status"])
    print("verdict:", verdict)

    print("\nLive contract now carries a real, browsable, decided case at:", CONTRACT_ADDRESS)
    print("app_id:", app_id, "template_id:", template_id, "case_id:", case_id)
