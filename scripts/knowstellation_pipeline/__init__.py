"""Knowstellation offline source pipeline.

The package builds the static JSON contracts consumed by the Knowstellation
frontend from PaddleOCR-VL JSONL/Markdown output.
"""

from .pipeline import build_from_ocr_jsonl

__all__ = ["build_from_ocr_jsonl"]
