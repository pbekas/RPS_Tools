"""Detect non-English (esp. Spanish) transcripts and translate turns to English via Bedrock."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Callable

_SPANISH_CHARS = re.compile(r"[áéíóúüñ¿¡]", re.IGNORECASE)
_SPANISH_WORD = re.compile(
    r"\b("
    r"el|la|los|las|de|del|que|en|un|una|unos|unas|es|está|estan|están|"
    r"por|para|con|sin|como|más|pero|porque|también|aquí|ahora|muy|"
    r"hola|buenos|buenas|días|dias|tardes|noches|gracias|señor|senor|"
    r"señora|senora|usted|llamada|cita|doctor|doctora|puede|tiene|"
    r"necesito|necesita|número|numero|teléfono|telefono|favor|por\s+favor|"
    r"paciente|clínica|clinica|dolor|seguro|médico|medico"
    r")\b",
    re.IGNORECASE,
)
_ENGLISH_WORD = re.compile(
    r"\b("
    r"the|and|you|your|have|this|that|with|for|from|please|thank|"
    r"hello|hi|calling|appointment|doctor|patient|office|insurance|"
    r"phone|number|help|about|would|could|will|today|tomorrow"
    r")\b",
    re.IGNORECASE,
)

BedrockTextFn = Callable[..., str]


@dataclass(frozen=True)
class TranscriptLocaleResult:
    language: str
    turns: list[dict[str, Any]]
    original_turns: list[dict[str, Any]] | None
    translated: bool


def sample_transcript_text(turns: list[dict[str, Any]], *, max_chars: int = 2500) -> str:
    parts: list[str] = []
    total = 0
    for turn in turns:
        text = str(turn.get("text") or "").strip()
        if not text:
            continue
        parts.append(text)
        total += len(text) + 1
        if total >= max_chars:
            break
    return " ".join(parts)[:max_chars]


def language_from_stt_code(code: str | None) -> str | None:
    if not code:
        return None
    primary = str(code).strip().lower().split("-")[0]
    return primary or None


def looks_spanish(text: str) -> bool:
    if not text or not text.strip():
        return False
    if _SPANISH_CHARS.search(text):
        return True
    spanish_hits = len(_SPANISH_WORD.findall(text))
    english_hits = len(_ENGLISH_WORD.findall(text))
    if spanish_hits >= 4 and spanish_hits > english_hits:
        return True
    if spanish_hits >= 2 and english_hits == 0 and len(text) > 40:
        return True
    return False


def looks_english(text: str) -> bool:
    if not text or not text.strip():
        return True
    english_hits = len(_ENGLISH_WORD.findall(text))
    spanish_hits = len(_SPANISH_WORD.findall(text))
    if _SPANISH_CHARS.search(text):
        return False
    if english_hits >= 3 and english_hits >= spanish_hits:
        return True
    if english_hits > 0 and spanish_hits == 0:
        return True
    return False


def needs_translation(
    turns: list[dict[str, Any]],
    *,
    hint_language: str | None = None,
) -> bool:
    hint = language_from_stt_code(hint_language)
    if hint and hint != "en":
        return True
    sample = sample_transcript_text(turns)
    if not sample:
        return False
    if looks_spanish(sample):
        return True
    if looks_english(sample):
        return False
    # Ambiguous / other languages: attempt translation so reviewers get English.
    return True


def ensure_english_transcript(
    turns: list[dict[str, Any]],
    *,
    hint_language: str | None = None,
    bedrock_text: BedrockTextFn | None = None,
) -> TranscriptLocaleResult:
    """Return English turns for QA/UI, preserving originals when translation runs."""
    seed = [dict(t) for t in (turns or [])]
    if not seed:
        return TranscriptLocaleResult(
            language=language_from_stt_code(hint_language) or "en",
            turns=[],
            original_turns=None,
            translated=False,
        )

    hint = language_from_stt_code(hint_language)
    if not needs_translation(seed, hint_language=hint_language):
        return TranscriptLocaleResult(
            language=hint or "en",
            turns=seed,
            original_turns=None,
            translated=False,
        )

    if bedrock_text is None:
        from src.bedrock_analyst import bedrock_text as _bedrock_text

        bedrock_text = _bedrock_text

    language, english_texts = _translate_turn_texts(seed, bedrock_text=bedrock_text)
    if not english_texts or len(english_texts) != len(seed):
        # Soft-fail: keep original text so analysis can still run.
        return TranscriptLocaleResult(
            language=hint or language or "und",
            turns=seed,
            original_turns=None,
            translated=False,
        )

    if all(
        str(a.get("text") or "").strip() == str(b or "").strip()
        for a, b in zip(seed, english_texts)
    ):
        return TranscriptLocaleResult(
            language=language or hint or "en",
            turns=seed,
            original_turns=None,
            translated=False,
        )

    english_turns: list[dict[str, Any]] = []
    for turn, text in zip(seed, english_texts):
        english_turns.append(
            {
                **turn,
                "text": str(text or "").strip(),
            }
        )
    return TranscriptLocaleResult(
        language=language or hint or "und",
        turns=english_turns,
        original_turns=seed,
        translated=True,
    )


def _translate_turn_texts(
    turns: list[dict[str, Any]],
    *,
    bedrock_text: BedrockTextFn,
    batch_size: int = 40,
) -> tuple[str, list[str]]:
    language = "und"
    out: list[str] = []
    for start in range(0, len(turns), batch_size):
        batch = turns[start : start + batch_size]
        lang, texts = _translate_batch(batch, bedrock_text=bedrock_text, offset=start)
        if lang and lang != "und":
            language = lang
        if len(texts) != len(batch):
            return language, []
        out.extend(texts)
    return language, out


def _translate_batch(
    turns: list[dict[str, Any]],
    *,
    bedrock_text: BedrockTextFn,
    offset: int,
) -> tuple[str, list[str]]:
    lines = []
    for i, turn in enumerate(turns):
        speaker = turn.get("speaker") or "Unknown"
        ts = turn.get("timestamp") or ""
        text = str(turn.get("text") or "").replace("\n", " ").strip()
        lines.append(f"{offset + i}|{speaker}|{ts}|{text}")

    prompt = (
        "You are translating medical-office phone call transcript turns for English-speaking QA reviewers.\n"
        "Detect the primary spoken/written language of the turns.\n"
        "If they are already English, set needs_translation=false and copy each text unchanged.\n"
        "Otherwise translate each turn to clear natural English.\n"
        "Preserve meaning, names, phone numbers, dates, and clinical terms. Do not add commentary.\n"
        "Return ONLY valid JSON (no markdown) with this schema:\n"
        '{"language":"es","needs_translation":true,"texts":["turn 0 english", "..."]}\n'
        f"texts MUST contain exactly {len(turns)} strings in the same order as the input.\n\n"
        "INPUT TURNS (index|speaker|timestamp|text):\n"
        + "\n".join(lines)
    )
    raw = bedrock_text(
        system=(
            "You translate call-center transcripts to English. "
            "Return only JSON matching the requested schema."
        ),
        user=prompt,
        temperature=0.1,
        max_tokens=min(4096, 256 + 180 * len(turns)),
    )
    data = _extract_json(raw)
    language = str(data.get("language") or "und").strip().lower().split("-")[0] or "und"
    needs = data.get("needs_translation")
    texts_raw = data.get("texts")
    if not isinstance(texts_raw, list):
        return language, []
    texts = [str(t if t is not None else "").strip() for t in texts_raw]
    if needs is False or str(needs).lower() in {"false", "0", "no"}:
        # Model says English — keep source texts.
        return "en", [str(t.get("text") or "").strip() for t in turns]
    return language, texts


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
