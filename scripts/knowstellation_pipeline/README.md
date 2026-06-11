# Knowstellation Pipeline

Offline builder for turning a formula-heavy book or paper PDF into the static
JSON contracts used by the Knowstellation frontend.

## OCR

The OCR stage uses the AIStudio PaddleOCR jobs API and the model requested for
this project:

```text
PaddleOCR-VL-1.6
```

Put the token in the local root `.env.local` file. Do not commit it.

```powershell
PADDLEOCR_AISTUDIO_TOKEN=...
```

Capture OCR output:

```powershell
python -m scripts.knowstellation_pipeline capture `
  --book-id my-book `
  --input path\to\book.pdf
```

Build from existing JSONL:

```powershell
python -m scripts.knowstellation_pipeline build `
  --book-id my-book `
  --jsonl data\knowstellation_pipeline\my-book\ocr_raw\result.jsonl
```

Add `--publish` to copy generated files into `data/frontend` and `public/data`.
Publishing overwrites generated files but does not delete unrelated local files.
