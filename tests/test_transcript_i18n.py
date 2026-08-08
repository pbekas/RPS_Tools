"""Unit tests for Spanish/non-English transcript detection and translation."""

from __future__ import annotations

import json

from src.transcript_i18n import (
    ensure_english_transcript,
    looks_english,
    looks_spanish,
    needs_translation,
)


def test_looks_spanish_with_accents():
    assert looks_spanish("Hola, ¿cómo está usted? Necesito una cita.")
    assert not looks_english("Hola, ¿cómo está usted? Necesito una cita.")


def test_looks_english_office_call():
    text = "Hello, thank you for calling. How can I help you with your appointment today?"
    assert looks_english(text)
    assert not looks_spanish(text)


def test_needs_translation_from_stt_hint():
    turns = [{"speaker": "Patient", "text": "hello", "timestamp": "00:01"}]
    assert needs_translation(turns, hint_language="es-US") is True
    assert needs_translation(turns, hint_language="en-US") is False


def test_needs_translation_spanish_body():
    turns = [
        {
            "speaker": "Patient",
            "text": "Hola buenos días, necesito una cita con el doctor por favor.",
            "timestamp": "00:01",
        },
        {
            "speaker": "Agent",
            "text": "Claro, ¿para cuándo la necesita?",
            "timestamp": "00:08",
        },
    ]
    assert needs_translation(turns) is True


def test_ensure_english_skips_bedrock_for_english():
    turns = [
        {
            "speaker": "Agent",
            "text": "Thank you for calling Relevium. How can I help you today?",
            "timestamp": "00:01",
        }
    ]

    def boom(**_kwargs):
        raise AssertionError("bedrock should not be called for English")

    result = ensure_english_transcript(turns, bedrock_text=boom)
    assert result.translated is False
    assert result.language == "en"
    assert result.original_turns is None
    assert result.turns[0]["text"].startswith("Thank you")


def test_ensure_english_translates_spanish(monkeypatch):
    turns = [
        {
            "speaker": "Patient",
            "text": "Hola, necesito una cita con el doctor por favor.",
            "timestamp": "00:01",
        },
        {
            "speaker": "Agent",
            "text": "Claro, con mucho gusto.",
            "timestamp": "00:06",
        },
    ]

    def fake_bedrock(**_kwargs):
        return json.dumps(
            {
                "language": "es",
                "needs_translation": True,
                "texts": [
                    "Hello, I need an appointment with the doctor please.",
                    "Of course, gladly.",
                ],
            }
        )

    result = ensure_english_transcript(turns, bedrock_text=fake_bedrock)
    assert result.translated is True
    assert result.language == "es"
    assert result.original_turns is not None
    assert result.original_turns[0]["text"].startswith("Hola")
    assert result.turns[0]["text"].startswith("Hello")
    assert result.turns[1]["speaker"] == "Agent"


def test_ensure_english_respects_model_says_english():
    turns = [
        {
            "speaker": "Patient",
            "text": "Ambiguous short line",
            "timestamp": "00:01",
        }
    ]

    def fake_bedrock(**_kwargs):
        return json.dumps(
            {
                "language": "en",
                "needs_translation": False,
                "texts": ["Ambiguous short line"],
            }
        )

    # Ambiguous text triggers translation attempt; model says leave as English.
    result = ensure_english_transcript(turns, bedrock_text=fake_bedrock)
    assert result.translated is False
    assert result.original_turns is None
