"""Call QA analyst powered by Amazon Transcribe + Amazon Bedrock.

Pipeline:
  1. Upload audio to S3 (required by Transcribe)
  2. Amazon Transcribe with speaker diarization
  3. Amazon Bedrock (Claude) for structured QA JSON + coaching
"""

from __future__ import annotations

import json
import re
import time
import uuid
from pathlib import Path
from typing import Any

import boto3
import httpx

from src.config import get_settings

SYSTEM_INSTRUCTION = """You are a Call Quality Analyst for Relevium Pain Specialists, a medical office.
You review phone call transcripts between front-desk/phone agents and patients or callers.

Return ONLY valid JSON (no markdown fences) matching this schema:
{
  "agent_name": "string — best guess of the staff member's name if stated or identifiable; else Unknown",
  "topic": "string — short topic label (scheduling, billing, clinical question, insurance, referral, other)",
  "ai_summary": "string — 3-6 sentence neutral summary of the call",
  "ai_empathy_score": 1-10 integer — empathy, warmth, and patient-centered tone,
  "ai_name_stated": true/false — whether the agent clearly stated their name,
  "quality_score": 1-10 integer — overall QA quality (greeting, name, empathy, clarity, ownership, FCR),
  "duration_seconds": integer — total call length in seconds (use provided duration if given),
  "time_to_answer_seconds": integer or null — time before a live agent greets, if detectable from transcript timing,
  "transfer_count": integer — number of times the caller was transferred,
  "fcr": true/false — First Call Resolution: was the caller's need resolved without needing another call/transfer chain,
  "transcript": [
    {"speaker": "Patient" | "Agent" | "System", "text": "exact words", "timestamp": "mm:ss"}
  ]
}

Scoring guidance:
- Deduct for missing name introduction, cold tone, excessive transfers, talking over the caller, unclear next steps.
- Reward clear name intro, empathy, accurate information, calm ownership, and FCR.
- Map Transcribe speaker labels (spk_0, spk_1, …) to Patient / Agent / System using conversational role cues.
  Typically the staff member greets with the practice name; the caller is the Patient.
- Preserve wording from the transcript as faithfully as possible; you may lightly clean filler words.
- Medical context: be factual; do not invent clinical details not present in the transcript.
"""


def analyze_call_audio(
    file_path: str | Path,
    original_filename: str | None = None,
    *,
    s3_uri: str | None = None,
) -> dict[str, Any]:
    """Transcribe a recording, then score/summarize with Bedrock."""
    settings = get_settings()
    if not settings.bedrock_configured:
        raise RuntimeError(
            "Bedrock is not configured. Set BEDROCK_MODEL_ID and ensure AWS credentials "
            "can call bedrock-runtime (and enable model access in the Bedrock console)."
        )
    if not settings.s3_configured and not s3_uri:
        raise RuntimeError(
            "S3_BUCKET is required for Amazon Transcribe. Set S3_BUCKET in .env "
            "(or pass an existing s3_uri)."
        )

    path = Path(file_path)
    media_uri = s3_uri or _ensure_audio_on_s3(path)

    transcript_turns, duration_seconds = transcribe_audio(media_uri)
    transcript_text = _format_turns_for_prompt(transcript_turns)

    user_prompt = (
        "Analyze this medical office phone call transcript produced by Amazon Transcribe.\n"
        f"Original filename (may contain hints): {original_filename or path.name}\n"
        f"Known/estimated duration_seconds: {duration_seconds}\n"
        f"S3 media: {media_uri}\n\n"
        "TRANSCRIPT:\n"
        f"{transcript_text}\n\n"
        "Return the JSON object described in your system instructions. "
        "Include a cleaned speaker-separated transcript in the JSON."
    )

    raw = bedrock_text(
        system=SYSTEM_INSTRUCTION,
        user=user_prompt,
        temperature=0.2,
        max_tokens=8192,
    )
    data = _extract_json(raw)

    transcript = data.get("transcript") or transcript_turns
    normalized_transcript = _normalize_transcript(transcript)

    return {
        "agent_name": str(data.get("agent_name") or "Unknown").strip(),
        "topic": str(data.get("topic") or "Other").strip(),
        "ai_summary": str(data.get("ai_summary") or "").strip(),
        "ai_empathy_score": _clamp_score(data.get("ai_empathy_score")),
        "ai_name_stated": bool(data.get("ai_name_stated", False)),
        "quality_score": _clamp_score(data.get("quality_score")),
        "duration_seconds": int(data.get("duration_seconds") or duration_seconds or 0),
        "time_to_answer_seconds": (
            int(data["time_to_answer_seconds"])
            if data.get("time_to_answer_seconds") is not None
            else None
        ),
        "transfer_count": int(data.get("transfer_count") or 0),
        "fcr": bool(data.get("fcr", False)),
        "transcript": normalized_transcript,
        "recording_storage_uri": media_uri,
    }


def generate_coaching_report(
    *,
    agent_name: str,
    avg_empathy: float,
    total_talk_seconds: int,
    call_count: int,
    manager_feedback_notes: list[str],
    ai_summaries: list[str],
) -> str:
    """Generate a coaching narrative for one agent via Bedrock."""
    feedback_block = "\n".join(f"- {n}" for n in manager_feedback_notes if n.strip()) or "(none)"
    summary_block = "\n".join(f"- {s}" for s in ai_summaries if s.strip()) or "(none)"
    prompt = f"""You are a phone-skills coach for Relevium Pain Specialists (medical office).

Agent: {agent_name}
Calls in period: {call_count}
Average empathy score (1-10): {avg_empathy:.1f}
Total talk time: {total_talk_seconds // 60} minutes

Manager feedback notes:
{feedback_block}

AI call summaries:
{summary_block}

Write a concise "Coaching Report" with:
1) Two specific strengths
2) Two specific areas for improvement
3) One short practice tip for the next week

Tone: direct, kind, actionable. No fluff. Do not invent facts not supported by the notes/summaries.
"""
    return bedrock_text(
        system="You write concise coaching reports for medical office phone agents.",
        user=prompt,
        temperature=0.4,
        max_tokens=2048,
    ).strip()


def bedrock_text(
    *,
    system: str,
    user: str,
    temperature: float = 0.2,
    max_tokens: int = 4096,
) -> str:
    settings = get_settings()
    client = boto3.client("bedrock-runtime", region_name=settings.aws_region)
    response = client.converse(
        modelId=settings.bedrock_model_id,
        system=[{"text": system}],
        messages=[{"role": "user", "content": [{"text": user}]}],
        inferenceConfig={
            "temperature": temperature,
            "maxTokens": max_tokens,
        },
    )
    parts = response.get("output", {}).get("message", {}).get("content", [])
    texts = [p.get("text", "") for p in parts if isinstance(p, dict) and p.get("text")]
    return "\n".join(texts).strip()


def transcribe_audio(s3_uri: str) -> tuple[list[dict[str, str]], int]:
    """
    Run Amazon Transcribe with speaker labels.
    Returns (turns[{speaker,text,timestamp}], duration_seconds).
    """
    settings = get_settings()
    client = boto3.client("transcribe", region_name=settings.aws_region)
    job_name = f"rps-qa-{uuid.uuid4().hex[:16]}"
    media_format = _media_format_from_uri(s3_uri)

    kwargs: dict[str, Any] = {
        "TranscriptionJobName": job_name,
        "Media": {"MediaFileUri": s3_uri},
        "MediaFormat": media_format,
        "LanguageCode": settings.transcribe_language_code,
        "Settings": {
            "ShowSpeakerLabels": True,
            "MaxSpeakerLabels": 4,
        },
    }
    client.start_transcription_job(**kwargs)

    while True:
        job = client.get_transcription_job(TranscriptionJobName=job_name)[
            "TranscriptionJob"
        ]
        status = job["TranscriptionJobStatus"]
        if status == "COMPLETED":
            break
        if status == "FAILED":
            raise RuntimeError(
                f"Transcribe failed: {job.get('FailureReason') or 'unknown error'}"
            )
        time.sleep(3)

    transcript_uri = job["Transcript"]["TranscriptFileUri"]
    with httpx.Client(timeout=120.0) as http:
        payload = http.get(transcript_uri).json()

    duration = int(round(float(payload.get("results", {}).get("audio_segments", [{}])[0].get("end_time", 0) or 0)))
    # Prefer items-based rebuild with speaker labels
    turns = _turns_from_transcribe_json(payload)
    if not duration and turns:
        # last timestamp heuristic
        last = turns[-1].get("timestamp") or "0:00"
        duration = _mmss_to_seconds(last)
    # Fallback duration from results.audio_segments or items
    if not duration:
        items = payload.get("results", {}).get("items") or []
        end_times = [float(i.get("end_time")) for i in items if i.get("end_time")]
        if end_times:
            duration = int(round(max(end_times)))

    return turns, duration


def _ensure_audio_on_s3(path: Path) -> str:
    settings = get_settings()
    import boto3 as _boto3

    key = f"transcribe-inbox/{uuid.uuid4().hex}_{path.name}"
    client = _boto3.client("s3", region_name=settings.aws_region)
    extra: dict[str, str] = {}
    suffix = path.suffix.lower()
    content_types = {
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".m4a": "audio/mp4",
        ".ogg": "audio/ogg",
        ".flac": "audio/flac",
        ".webm": "audio/webm",
    }
    if suffix in content_types:
        extra["ContentType"] = content_types[suffix]
    client.upload_file(
        str(path),
        settings.s3_bucket,
        key,
        ExtraArgs=extra or None,
    )
    return f"s3://{settings.s3_bucket}/{key}"


def _media_format_from_uri(uri: str) -> str:
    lower = uri.lower()
    for fmt in ("mp3", "mp4", "wav", "flac", "ogg", "amr", "webm", "m4a"):
        if lower.endswith(f".{fmt}"):
            return "mp4" if fmt == "m4a" else fmt
    return "mp3"


def _turns_from_transcribe_json(payload: dict[str, Any]) -> list[dict[str, str]]:
    results = payload.get("results") or {}
    speaker_labels = (results.get("speaker_labels") or {}).get("segments") or []
    items = results.get("items") or []

    # Build word list with times
    words: list[dict[str, Any]] = []
    for item in items:
        if item.get("type") != "pronunciation":
            continue
        words.append(
            {
                "content": item.get("alternatives", [{}])[0].get("content", ""),
                "start": float(item.get("start_time") or 0),
                "end": float(item.get("end_time") or 0),
            }
        )

    turns: list[dict[str, str]] = []
    if speaker_labels:
        for seg in speaker_labels:
            speaker = seg.get("speaker_label") or "spk_0"
            start = float(seg.get("start_time") or 0)
            end = float(seg.get("end_time") or 0)
            text_parts = [
                w["content"]
                for w in words
                if w["start"] >= start - 0.01 and w["end"] <= end + 0.01
            ]
            # Also include punctuation items near the segment via raw items
            text = " ".join(text_parts).strip()
            if not text:
                continue
            turns.append(
                {
                    "speaker": speaker,
                    "text": text,
                    "timestamp": _seconds_to_mmss(start),
                }
            )
        return turns

    # No diarization — single block
    full = (results.get("transcripts") or [{}])[0].get("transcript") or ""
    if full:
        turns.append({"speaker": "spk_0", "text": full, "timestamp": "00:00"})
    return turns


def _format_turns_for_prompt(turns: list[dict[str, str]]) -> str:
    lines = []
    for t in turns:
        lines.append(f"[{t.get('timestamp', '')}] {t.get('speaker')}: {t.get('text')}")
    return "\n".join(lines) if lines else "(empty transcript)"


def _normalize_transcript(transcript: list[dict[str, Any]]) -> list[dict[str, str]]:
    normalized: list[dict[str, str]] = []
    for turn in transcript:
        speaker = str(turn.get("speaker", "Unknown")).strip()
        low = speaker.lower()
        if speaker in {"Patient", "Agent", "System"}:
            mapped = speaker
        elif "patient" in low or "caller" in low or low in {"spk_0", "speaker 0", "speaker0"}:
            # Heuristic: leave mapping to model when possible; fallback Patient for spk_0
            mapped = "Patient" if "agent" not in low else "Agent"
            if low.startswith("spk_"):
                mapped = "Patient" if low.endswith("0") else "Agent"
        elif "agent" in low or "staff" in low or "rep" in low:
            mapped = "Agent"
        elif "system" in low or "ivr" in low:
            mapped = "System"
        elif low.startswith("spk_"):
            mapped = "Patient" if low.endswith("0") else "Agent"
        else:
            mapped = "Agent"
        normalized.append(
            {
                "speaker": mapped,
                "text": str(turn.get("text", "")).strip(),
                "timestamp": str(turn.get("timestamp", "")).strip(),
            }
        )
    return normalized


def _extract_json(text: str) -> dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", text)
        if not match:
            raise
        return json.loads(match.group(0))


def _clamp_score(value: Any) -> int:
    try:
        n = int(round(float(value)))
    except (TypeError, ValueError):
        n = 5
    return max(1, min(10, n))


def _seconds_to_mmss(seconds: float) -> str:
    s = max(0, int(seconds))
    m, sec = divmod(s, 60)
    h, m = divmod(m, 60)
    if h:
        return f"{h:02d}:{m:02d}:{sec:02d}"
    return f"{m:02d}:{sec:02d}"


def _mmss_to_seconds(value: str) -> int:
    parts = [int(p) for p in value.split(":") if p.isdigit() or p.isnumeric()]
    if len(parts) == 3:
        return parts[0] * 3600 + parts[1] * 60 + parts[2]
    if len(parts) == 2:
        return parts[0] * 60 + parts[1]
    if len(parts) == 1:
        return parts[0]
    return 0
