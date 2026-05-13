#!/usr/bin/env python3
"""
Extract plain text from a document file.

Usage:
    extract_doc.py <path> [--password PW]

Writes text to stdout. Status + warnings go to stderr. Exit codes
distinguish cases the caller needs to act on:

    0   ok (text written to stdout)
    2   usage / missing file
    3   unsupported extension
    4   generic extraction failure
    65  PDF is encrypted and no password was supplied
    66  PDF password is wrong

Supported formats: .docx, .xlsx, .pptx, .pdf, and the text-ish
formats (.md .txt .csv) — though those are better handled in Node.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


def _docx(path: Path) -> str:
    from docx import Document  # python-docx

    doc = Document(str(path))
    parts: list[str] = []
    for para in doc.paragraphs:
        if para.text.strip():
            parts.append(para.text)
    for table in doc.tables:
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells]
            if any(cells):
                parts.append(" | ".join(cells))
    return "\n".join(parts)


def _xlsx(path: Path) -> str:
    from openpyxl import load_workbook

    wb = load_workbook(str(path), data_only=True, read_only=True)
    parts: list[str] = []
    for sheet in wb.worksheets:
        parts.append(f"# {sheet.title}")
        for row in sheet.iter_rows(values_only=True):
            cells = ["" if v is None else str(v) for v in row]
            if any(c.strip() for c in cells):
                parts.append(" | ".join(cells))
        parts.append("")
    return "\n".join(parts).rstrip()


def _pptx(path: Path) -> str:
    from pptx import Presentation  # python-pptx

    pres = Presentation(str(path))
    parts: list[str] = []
    for i, slide in enumerate(pres.slides, start=1):
        parts.append(f"# Slide {i}")
        for shape in slide.shapes:
            if shape.has_text_frame:
                for para in shape.text_frame.paragraphs:
                    t = "".join(run.text for run in para.runs).strip()
                    if t:
                        parts.append(t)
            # Tables inside slides.
            if getattr(shape, "has_table", False) and shape.has_table:
                for row in shape.table.rows:
                    cells = [cell.text.strip() for cell in row.cells]
                    if any(cells):
                        parts.append(" | ".join(cells))
        parts.append("")
    return "\n".join(parts).rstrip()


def _ocr_pages(pdf_path: Path, page_indices: list[int],
               ollama_url: str, model: str) -> list[tuple[int, str]]:
    """Render specified pages as images and OCR via Ollama vision model."""
    import base64
    import io
    import requests

    try:
        from pdf2image import convert_from_path
    except ImportError:
        print("pdf2image not installed, skipping OCR", file=sys.stderr)
        return []

    results: list[tuple[int, str]] = []
    # Convert only the pages we need — pdf2image is 1-indexed
    for page_idx in page_indices:
        try:
            images = convert_from_path(
                str(pdf_path),
                first_page=page_idx + 1,
                last_page=page_idx + 1,
                dpi=200,
            )
            if not images:
                continue
            img = images[0]
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            b64 = base64.b64encode(buf.getvalue()).decode()

            resp = requests.post(
                f"{ollama_url}/api/chat",
                json={
                    "model": model,
                    "messages": [{
                        "role": "user",
                        "content": "Extract all text from this image. Preserve structure (headings, lists, tables). Return only the extracted text, no commentary.",
                        "images": [b64],
                    }],
                    "stream": False,
                },
                timeout=120,
            )
            if resp.ok:
                data = resp.json()
                ocr_text = data.get("message", {}).get("content", "")
                if ocr_text.strip():
                    results.append((page_idx, ocr_text))
        except Exception as e:
            print(f"OCR failed for page {page_idx + 1}: {e}", file=sys.stderr)
            continue

    return results


def _pdf(path: Path, password: str | None, ocr: bool = False,
         ollama_url: str = "http://localhost:11434", vision_model: str = "") -> str:
    """Extract PDF text with pypdf. Handles encryption: if the PDF is
    encrypted and no password was supplied, exit 65 so the Node side can
    prompt; if the supplied password is wrong, exit 66.

    When ocr=True and vision_model is set, pages with very little extracted
    text (< 50 chars) are rendered as images and sent to the Ollama vision
    model for OCR."""
    from pypdf import PdfReader
    from pypdf.errors import DependencyError, FileNotDecryptedError

    reader = PdfReader(str(path))
    if reader.is_encrypted:
        if not password:
            print("PDF_ENCRYPTED", file=sys.stderr)
            sys.exit(65)
        try:
            result = reader.decrypt(password)
        except DependencyError as e:
            print(f"PDF decryption needs an extra dep: {e}", file=sys.stderr)
            sys.exit(4)
        # pypdf.decrypt returns 0 (failure), 1 (user pw), 2 (owner pw)
        if result == 0:
            print("PDF_BAD_PASSWORD", file=sys.stderr)
            sys.exit(66)

    pages: list[tuple[int, str]] = []
    image_pages: list[int] = []
    try:
        for i, page in enumerate(reader.pages):
            text = page.extract_text() or ""
            if len(text.strip()) >= 50:
                pages.append((i, text))
            else:
                pages.append((i, text))  # keep whatever little text there is
                image_pages.append(i)
    except FileNotDecryptedError:
        print("PDF_BAD_PASSWORD", file=sys.stderr)
        sys.exit(66)

    # Vision OCR for image-heavy pages
    if ocr and image_pages and vision_model:
        ocr_results = _ocr_pages(path, image_pages, ollama_url, vision_model)
        if ocr_results:
            for page_idx, ocr_text in ocr_results:
                for j, (pi, _) in enumerate(pages):
                    if pi == page_idx:
                        pages[j] = (pi, ocr_text)
                        break
        else:
            # OCR was attempted but yielded nothing — model may not support vision
            note = (
                f"[This PDF contains {len(image_pages)} scanned/image-based page(s). "
                f"Vision OCR was attempted with model '{vision_model}' but could not "
                f"extract text. The model may not support image inputs.]"
            )
            pages.append((len(reader.pages), note))
    elif image_pages and not ocr:
        note = (
            f"[This PDF contains {len(image_pages)} scanned/image-based page(s) "
            f"with no extractable text. Vision OCR was not enabled.]"
        )
        pages.append((len(reader.pages), note))

    return "\n\n".join(text for _, text in pages if text.strip())


def _textish(path: Path) -> str:
    """Treat .md / .txt / .csv as UTF-8 with a permissive fallback."""
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return path.read_text(encoding="utf-8", errors="replace")


_HANDLERS = {
    ".docx": _docx,
    ".xlsx": _xlsx,
    ".pptx": _pptx,
    ".md": _textish,
    ".txt": _textish,
    ".csv": _textish,
}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("path", type=Path)
    ap.add_argument("--password", default=None)
    ap.add_argument("--ocr", action="store_true", help="Enable vision OCR for image-heavy pages")
    ap.add_argument("--ollama-url", default=os.environ.get("OLLAMA_URL", "http://localhost:11434"))
    ap.add_argument("--vision-model", default=os.environ.get("VISION_MODEL", ""))
    args = ap.parse_args()

    if not args.path.exists():
        print(f"not found: {args.path}", file=sys.stderr)
        return 2
    ext = args.path.suffix.lower()

    try:
        if ext == ".pdf":
            text = _pdf(args.path, args.password, ocr=args.ocr,
                        ollama_url=args.ollama_url, vision_model=args.vision_model)
        elif ext in _HANDLERS:
            text = _HANDLERS[ext](args.path)
        else:
            print(f"unsupported extension: {ext}", file=sys.stderr)
            return 3
    except SystemExit:
        raise
    except Exception as e:
        print(f"extract failed: {e}", file=sys.stderr)
        return 4

    sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
