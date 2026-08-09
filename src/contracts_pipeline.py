"""Background processing for uploaded contracts (Textract → Bedrock)."""

from __future__ import annotations

import logging
import threading
from typing import Any

from src import database as db
from src.config import get_settings
from src.contract_analyst import extract_contract_fields
from src.textract_docs import extract_text_from_s3

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_worker_started = False


def ensure_worker_started() -> None:
    global _worker_started
    with _lock:
        if _worker_started:
            return
        _worker_started = True
        t = threading.Thread(target=_worker_loop, daemon=True, name="contracts-worker")
        t.start()


def process_pending_contracts(*, limit: int = 10) -> dict[str, Any]:
    """Process up to `limit` pending contracts synchronously (also kicks worker)."""
    ensure_worker_started()
    settings = get_settings()
    if settings.database_backend != "postgres":
        return {"processed": 0, "errors": ["Contracts require DB_BACKEND=postgres"]}

    pending = db.list_pending_contracts(limit=max(1, min(limit, 50)))
    results: list[dict[str, Any]] = []
    errors: list[str] = []
    for row in pending:
        contract_id = str(row.get("id") or "")
        try:
            out = process_contract_sync(contract_id)
            results.append({"id": contract_id, "status": out.get("status")})
        except Exception as exc:  # noqa: BLE001
            logger.exception("Contract processing failed for %s", contract_id)
            errors.append(f"{contract_id}: {exc}")
    return {"processed": len(results), "results": results, "errors": errors}


def process_contract_sync(contract_id: str) -> dict[str, Any]:
    settings = get_settings()
    if settings.database_backend != "postgres":
        raise RuntimeError("Contracts require DB_BACKEND=postgres")

    contract = db.get_contract(contract_id)
    if not contract:
        raise LookupError(f"Contract not found: {contract_id}")

    db.update_contract(
        contract_id,
        {"status": "processing", "error_message": None},
    )

    try:
        s3_uri = str(contract.get("s3_uri") or "")
        s3_key = str(contract.get("s3_key") or "")
        if not s3_uri and s3_key and settings.s3_bucket:
            s3_uri = f"s3://{settings.s3_bucket}/{s3_key}"
        if not s3_uri:
            raise RuntimeError("Contract has no S3 URI/key")

        text = extract_text_from_s3(s3_uri=s3_uri)
        extracted = extract_contract_fields(
            text,
            original_filename=contract.get("original_filename"),
        )

        vendor_id = contract.get("vendor_id")
        vendor_name = extracted.get("vendor_name") or ""
        if not vendor_id and vendor_name:
            vendor = db.find_or_create_vendor(vendor_name)
            vendor_id = vendor.get("id")

        group_id = contract.get("group_id")
        if not group_id:
            group = db.get_contract_group_by_slug(extracted.get("group_hint") or "other")
            group_id = group.get("id") if group else None

        confidence = extracted.get("confidence")
        needs_review = (
            confidence is None
            or float(confidence) < 0.7
            or not extracted.get("effective_date")
            or (
                not extracted.get("expiration_date")
                and not extracted.get("term_end_date")
            )
            or not vendor_name
        )

        updates: dict[str, Any] = {
            "title": extracted.get("title")
            or contract.get("title")
            or contract.get("original_filename")
            or "Untitled contract",
            "vendor_id": vendor_id,
            "group_id": group_id,
            "effective_date": extracted.get("effective_date"),
            "has_defined_term": bool(extracted.get("has_defined_term")),
            "term_end_date": extracted.get("term_end_date"),
            "expiration_date": extracted.get("expiration_date"),
            "notice_period_days": extracted.get("notice_period_days"),
            "auto_renews": bool(extracted.get("auto_renews")),
            "cost_amount": extracted.get("cost_amount"),
            "cost_currency": extracted.get("cost_currency") or "USD",
            "cost_frequency": extracted.get("cost_frequency") or "unknown",
            "next_payment_date": extracted.get("next_payment_date"),
            "cost_notes": extracted.get("cost_notes") or "",
            "summary": extracted.get("summary") or "",
            "extracted_json": extracted.get("raw") or extracted,
            "extraction_confidence": confidence,
            "extracted_text": text[:500_000],
            "status": "needs_review" if needs_review else "active",
            "error_message": None,
        }
        return db.update_contract(contract_id, updates)
    except Exception as exc:  # noqa: BLE001
        db.update_contract(
            contract_id,
            {"status": "error", "error_message": str(exc)},
        )
        raise


def _worker_loop() -> None:
    import time

    while True:
        try:
            settings = get_settings()
            if settings.database_backend == "postgres":
                pending = db.list_pending_contracts(limit=5)
                for row in pending:
                    cid = str(row.get("id") or "")
                    if not cid:
                        continue
                    try:
                        process_contract_sync(cid)
                    except Exception:
                        logger.exception("Background contract job failed: %s", cid)
        except Exception:
            logger.exception("Contracts worker loop error")
        time.sleep(5)
