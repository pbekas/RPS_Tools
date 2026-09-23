from __future__ import annotations

import unittest

from src.bedrock_analyst import (
    _format_turns_for_prompt,
    _turns_from_transcribe_json,
    transcribe_language_parameters,
)
from src.transcript_i18n import (
    attach_english_readings,
    looks_spanish,
    turn_needs_english,
)


class LanguageParametersTests(unittest.TestCase):
    def test_two_languages_identify_each_segment(self) -> None:
        params = transcribe_language_parameters(["en-US", "es-US"], "en-US")
        self.assertEqual(
            params,
            {
                "IdentifyMultipleLanguages": True,
                "LanguageOptions": ["en-US", "es-US"],
            },
        )
        self.assertNotIn("LanguageCode", params)

    def test_single_language_is_forced(self) -> None:
        params = transcribe_language_parameters(["en-US"], "es-US")
        self.assertEqual(params, {"LanguageCode": "en-US"})


class TurnParserTests(unittest.TestCase):
    def test_mixed_call_keeps_spanish_and_punctuation(self) -> None:
        payload = {
            "results": {
                "items": [
                    _word("Hello", 0.1, 0.4, "en-US"),
                    _punct("."),
                    _word("Hola", 1.0, 1.3, "es-US"),
                    _punct(","),
                    _punct("¿"),
                    _word("cómo", 1.4, 1.6, "es-US"),
                    _word("está", 1.7, 2.0, "es-US"),
                    _punct("?"),
                ],
                "speaker_labels": {
                    "segments": [
                        {"speaker_label": "spk_0", "start_time": "0.0", "end_time": "0.5"},
                        {"speaker_label": "spk_1", "start_time": "0.9", "end_time": "2.1"},
                    ]
                },
            }
        }
        turns = _turns_from_transcribe_json(payload)
        self.assertEqual(len(turns), 2)
        self.assertEqual(turns[0]["text"], "Hello.")
        self.assertEqual(turns[0]["language"], "en-US")
        self.assertEqual(turns[1]["text"], "Hola, ¿cómo está?")
        self.assertEqual(turns[1]["language"], "es-US")
        self.assertEqual(turns[1]["speaker"], "spk_1")


class ScoringInputTests(unittest.TestCase):
    def test_prompt_uses_spoken_spanish_not_english_reading(self) -> None:
        prompt = _format_turns_for_prompt(
            [
                {
                    "speaker": "Agent",
                    "timestamp": "00:03",
                    "language": "es-US",
                    "text": "Buenos días, ¿en qué le puedo ayudar?",
                    "text_en": "Good morning, how can I help you?",
                }
            ]
        )
        self.assertIn("Buenos días, ¿en qué le puedo ayudar?", prompt)
        self.assertIn("[es-US]", prompt)
        self.assertNotIn("Good morning", prompt)
        self.assertNotIn("text_en", prompt)


class EnglishReadingTests(unittest.TestCase):
    def test_english_clinic_words_are_not_treated_as_spanish(self) -> None:
        text = "Please call the LA office and ask for the doctor on Elm."
        self.assertFalse(looks_spanish(text))
        self.assertFalse(turn_needs_english({"text": text}))

    def test_clear_spanish_needs_a_reading(self) -> None:
        self.assertTrue(
            looks_spanish("Hola, necesito una cita por favor con el doctor.")
        )

    def test_reading_does_not_replace_spoken_text(self) -> None:
        spoken = "Hola, necesito una cita por favor."

        def fake_bedrock(**kwargs: object) -> str:
            self.assertIn(spoken, str(kwargs.get("user")))
            return '{"texts":["Hello, I need an appointment please."]}'

        turns = attach_english_readings(
            [{"speaker": "Patient", "text": spoken, "language": "es-US"}],
            bedrock_text=fake_bedrock,
        )
        self.assertEqual(turns[0]["text"], spoken)
        self.assertEqual(turns[0]["text_en"], "Hello, I need an appointment please.")

    def test_english_turns_are_not_sent_for_translation(self) -> None:
        def fake_bedrock(**kwargs: object) -> str:
            raise AssertionError("English turns must not be translated")

        turns = attach_english_readings(
            [{"text": "Thanks for calling, how can I help?", "language": "en-US"}],
            bedrock_text=fake_bedrock,
        )
        self.assertNotIn("text_en", turns[0])

    def test_bad_model_payload_keeps_spoken_text(self) -> None:
        def fake_bedrock(**kwargs: object) -> str:
            return '{"texts":["only one"]}'

        spoken = "Buenos días, necesito una cita."
        turns = attach_english_readings(
            [
                {"text": spoken, "language": "es-US"},
                {"text": "Gracias, hasta luego.", "language": "es-US"},
            ],
            bedrock_text=fake_bedrock,
        )
        self.assertEqual(turns[0]["text"], spoken)
        self.assertNotIn("text_en", turns[0])
        self.assertNotIn("text_en", turns[1])

    def test_commentary_is_rejected(self) -> None:
        spoken = "Sí, la cita es el lunes a las tres de la tarde."

        def fake_bedrock(**kwargs: object) -> str:
            return (
                '{"texts":["Yes the appointment is Monday at three in the afternoon '
                "and the agent was very polite and should pass empathy because they "
                'used a warm tone throughout the entire conversation."]}'
            )

        turns = attach_english_readings(
            [{"text": spoken, "language": "es-US"}],
            bedrock_text=fake_bedrock,
        )
        self.assertEqual(turns[0]["text"], spoken)
        self.assertNotIn("text_en", turns[0])


def _word(content: str, start: float, end: float, language: str) -> dict:
    return {
        "type": "pronunciation",
        "start_time": str(start),
        "end_time": str(end),
        "alternatives": [{"content": content}],
        "language_code": language,
    }


def _punct(content: str) -> dict:
    return {"type": "punctuation", "alternatives": [{"content": content}]}


if __name__ == "__main__":
    unittest.main()
