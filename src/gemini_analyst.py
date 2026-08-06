"""Compatibility shim — AI analysis now uses Amazon Bedrock + Transcribe."""

from src.bedrock_analyst import (  # noqa: F401
    SYSTEM_INSTRUCTION,
    analyze_call_audio,
    generate_coaching_report,
)
