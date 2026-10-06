"""Alert when an extension's outbound volume jumps above its recent average.

The extension 4912 dialer placed thousands of outbound calls in one morning.
Comparing today's count with the prior days' daily average catches that pattern
while the calls are still going out, instead of after scoring finishes.
"""

from __future__ import annotations

import logging
import math
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from src.config import get_settings

logger = logging.getLogger(__name__)


def spike_threshold(baseline_avg: float, *, ratio: float, min_calls: int) -> int:
    """Smallest today-count that is both 200% of average and past the noise floor."""
    averaged = math.ceil(max(0.0, float(baseline_avg)) * max(1.0, float(ratio)) - 1e-9)
    return max(max(1, int(min_calls)), averaged)


def extensions_over_baseline(
    rows: list[dict[str, Any]],
    *,
    ratio: float,
    min_calls: int,
) -> list[dict[str, Any]]:
    spikes: list[dict[str, Any]] = []
    for row in rows:
        ext = str(row.get("ext") or "").strip()
        if not ext:
            continue
        today = int(row.get("today_count") or 0)
        average = float(row.get("baseline_avg") or 0)
        threshold = spike_threshold(average, ratio=ratio, min_calls=min_calls)
        if today < threshold:
            continue
        spikes.append(
            {
                "ext": ext,
                "agent_name": (row.get("agent_name") or "").strip() or None,
                "today_count": today,
                "baseline_avg": average,
                "threshold": threshold,
            }
        )
    return spikes


def check_outbound_volume_alerts() -> dict[str, Any]:
    """Scan outbound CDRs and post at most one Call Alerts message per extension per day."""
    settings = get_settings()
    if not settings.outbound_volume_alert_enabled or not settings.alerts_enabled:
        return {"sent": 0, "skipped": 0, "checked": 0}
    if settings.database_backend != "postgres":
        return {"sent": 0, "skipped": 0, "checked": 0, "errors": ["postgres required"]}
    if not (settings.gchat_webhook_url or "").strip():
        return {"sent": 0, "skipped": 0, "checked": 0}

    from src import database as db
    from src.notify import alert_outbound_volume_spike

    ratio = float(settings.outbound_volume_alert_ratio or 2)
    min_calls = int(settings.outbound_volume_min_calls or 15)
    baseline_days = max(1, int(settings.outbound_volume_baseline_days or 14))
    zone_name = settings.outbound_volume_timezone or "America/Los_Angeles"
    try:
        rows = db.list_outbound_daily_volumes(
            baseline_days=baseline_days,
            timezone_name=zone_name,
        )
    except Exception:
        logger.exception("Outbound volume query failed")
        return {"sent": 0, "skipped": 0, "checked": 0, "errors": ["query failed"]}

    spikes = extensions_over_baseline(rows, ratio=ratio, min_calls=min_calls)
    today = datetime.now(ZoneInfo(zone_name)).date().isoformat()
    sent = 0
    skipped = 0
    for spike in spikes:
        ext = spike["ext"]
        key = f"outbound_volume:{ext}:{today}"
        try:
            if db.alert_recently_sent(key, cooldown_minutes=26 * 60):
                skipped += 1
                continue
        except Exception:
            logger.exception("Outbound volume dedup failed for %s", ext)
        ok = alert_outbound_volume_spike(
            extension=ext,
            agent_name=spike.get("agent_name"),
            today_count=int(spike["today_count"]),
            baseline_avg=float(spike["baseline_avg"]),
            baseline_days=baseline_days,
            ratio=ratio,
            dedup_key=key,
        )
        if ok:
            sent += 1
        else:
            skipped += 1
    if sent:
        logger.info("Outbound volume alerts sent=%s checked=%s", sent, len(rows))
    return {"sent": sent, "skipped": skipped, "checked": len(rows), "spikes": len(spikes)}
