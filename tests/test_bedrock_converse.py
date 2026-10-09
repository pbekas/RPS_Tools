from __future__ import annotations

import unittest

from src.bedrock_analyst import converse_inference_fields


class ConverseInferenceFieldsTests(unittest.TestCase):
    def test_sonnet_55_omits_temperature_and_disables_upfront_thinking(self) -> None:
        fields = converse_inference_fields(
            "us.anthropic.claude-sonnet-5-5",
            temperature=0.2,
            max_tokens=4096,
        )
        self.assertEqual(fields["inferenceConfig"], {"maxTokens": 4096})
        self.assertEqual(
            fields["additionalModelRequestFields"],
            {
                "thinking": {"type": "between_tools"},
                "output_config": {"effort": "medium"},
            },
        )

    def test_haiku_keeps_temperature(self) -> None:
        fields = converse_inference_fields(
            "us.anthropic.claude-haiku-4-5-20251001-v1:0",
            temperature=0.2,
            max_tokens=1024,
        )
        self.assertEqual(
            fields,
            {"inferenceConfig": {"maxTokens": 1024, "temperature": 0.2}},
        )


if __name__ == "__main__":
    unittest.main()
