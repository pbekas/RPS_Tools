"""English readings for non-English transcript turns.

Scoring uses the spoken text. text_en is a literal reading aid for reviewers
and is never substituted for the spoken turn.
"""

from __future__ import annotations

import json
import re
from typing import Any, Callable

# Unambiguous Spanish cues. Short function words (el, la, de, en, es, un, para)
# are omitted because they show up in English clinic calls ("LA", names, "Dr").
_SPANISH_CHARS = re.compile(r"[áéíóúüñ¿¡]", re.IGNORECASE)
_SPANISH_WORD = re.compile(
    r"\b("
    r"hola|gracias|usted|ustedes|señor|señora|senor|senora|"
    r"buenos|buenas|días|dias|tardes|noches|"
    r"por\s+favor|necesito|necesita|número|numero|teléfono|telefono|"
    r"cita|clínica|clinica|dónde|donde|cuándo|cuando|también|tambien|"
    r"llamo|llamada|puedo|puede|quiero|ayuda"
    r")\b",
    re.IGNORECASE,
)

BedrockTextFn = Callable[..., str]


def looks_spanish(text: str) -> bool:
    """True when text is clearly Spanish, not English that merely shares short words."""
    if not text or not text.strip():
        return False
    if _SPANISH_CHARS.search(text):
        return True
    return len(_SPANISH_WORD.findall(text)) >= 2


def turn_language(turn: dict[str, Any]) -> str:
    raw = str(turn.get("language") or "").strip().lower()
    if not raw:
        return ""
    return raw.split("-")[0]


def turn_needs_english(turn: dict[str, Any]) -> bool:
    """Whether this spoken turn should get a separate English reading."""
    text = str(turn.get("text") or "").strip()
    if not text:
        return False
    lang = turn_language(turn)
    if lang == "en":
        return False
    if lang and lang != "und":
        return True
    return looks_spanish(text)


def attach_english_readings(
    turns: list[dict[str, Any]],
    *,
    bedrock_text: BedrockTextFn | None = None,
    batch_size: int = 8,
) -> list[dict[str, Any]]:
    """Add text_en on non-English turns. Spoken text is left unchanged."""
    result = [dict(t) for t in (turns or [])]
    indexes = [i for i, turn in enumerate(result) if turn_needs_english(turn)]
    if not indexes:
        return result

    if bedrock_text is None:
        from src.bedrock_analyst import bedrock_text as _bedrock_text

        bedrock_text = _bedrock_text

    for start in range(0, len(indexes), batch_size):
        batch_idx = indexes[start : start + batch_size]
        batch = [result[i] for i in batch_idx]
        try:
            texts = _translate_batch(batch, bedrock_text=bedrock_text)
        except Exception:
            continue
        if len(texts) != len(batch):
            continue
        for index, translated in zip(batch_idx, texts):
            source = str(result[index].get("text") or "").strip()
            reading = str(translated or "").strip()
            if not reading or reading == source:
                continue
            if not _faithful_length(source, reading):
                continue
            result[index]["text_en"] = reading
    return result


def _faithful_length(source: str, translated: str) -> bool:
    """Reject readings that balloon into commentary or collapse a real turn."""
    source_words = source.split()
    translated_words = translated.split()
    if not source_words or not translated_words:
        return False
    if len(source_words) < 6:
        return True
    ratio = len(translated_words) / len(source_words)
    return 0.35 <= ratio <= 2.0


def _translate_batch(
    turns: list[dict[str, Any]],
    *,
    bedrock_text: BedrockTextFn,
) -> list[str]:
    lines = []
    for i, turn in enumerate(turns):
        text = str(turn.get("text") or "").replace("\n", " ").strip()
        lines.append(f"{i}|{text}")
    n = len(turns)
    prompt = (
        "Translate these medical-office phone transcript turns into literal English.\n"
        "Rules:\n"
        f"- Return exactly {n} strings, in the same order.\n"
        "- Translate only. Do not add politeness, summaries, labels, or explanations.\n"
        "- Keep names, phone numbers, dates, medication names, and procedure names as spoken.\n"
        "- Keep short answers short.\n"
        "- If a turn is already English, copy it unchanged.\n"
        'Return ONLY JSON: {"texts":["...", "..."]}\n\n'
        "TURNS (index|text):\n"
        + "\n".join(lines)
    )
    raw = bedrock_text(
        system=(
            "You produce literal English readings of call-center transcript turns. "
            "Return only JSON with a texts array of the requested length."
        ),
        user=prompt,
        temperature=0,
        max_tokens=min(4096, 128 + 160 * n),
    )
    data = _extract_json(raw)
    texts_raw = data.get("texts")
    if not isinstance(texts_raw, list):
        return []
    return [str(t if t is not None else "").strip() for t in texts_raw]


def _extract_json(text: str) -> dict[str, Any]:
    text = (text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", text)
        if not match:
            return {}
        try:
            parsed = json.loads(match.group(0))
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
