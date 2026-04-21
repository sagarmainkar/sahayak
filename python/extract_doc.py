#!/usr/bin/env python3
"""
Extract plain text from a document file.
Usage: extract_doc.py <path>
Writes the extracted text to stdout. Status/warnings to stderr.
Supported extensions: .docx .xlsx .pptx
(.pdf is handled by pdftotext directly from the Node side;
 .md .txt .csv are read as-is in Node.)
"""
import sys
from pathlib import Path


def _docx(path: Path) -> str:
    from docx import Document  # python-docx

    doc = Document(str(path))
    parts: list[str] = []
    for para in doc.paragraphs:
        if para.text.strip():
            parts.append(para.text)
    # Walk tables too
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
    for ws in wb.worksheets:
        parts.append(f"## Sheet: {ws.title}")
        for row in ws.iter_rows(values_only=True):
            vals = ["" if v is None else str(v) for v in row]
            if any(v.strip() for v in vals):
                parts.append(" | ".join(vals))
        parts.append("")
    return "\n".join(parts).strip()


def _pptx(path: Path) -> str:
    from pptx import Presentation

    prs = Presentation(str(path))
    parts: list[str] = []
    for i, slide in enumerate(prs.slides, start=1):
        parts.append(f"## Slide {i}")
        for shape in slide.shapes:
            if shape.has_text_frame:
                for para in shape.text_frame.paragraphs:
                    txt = "".join(run.text for run in para.runs).strip()
                    if txt:
                        parts.append(txt)
            elif getattr(shape, "has_table", False):
                for row in shape.table.rows:
                    cells = [c.text.strip() for c in row.cells]
                    if any(cells):
                        parts.append(" | ".join(cells))
        if slide.has_notes_slide and slide.notes_slide.notes_text_frame.text.strip():
            parts.append(f"> notes: {slide.notes_slide.notes_text_frame.text.strip()}")
        parts.append("")
    return "\n".join(parts).strip()


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: extract_doc.py <path>", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    if not path.exists():
        print(f"file not found: {path}", file=sys.stderr)
        return 3

    ext = path.suffix.lower()
    try:
        if ext == ".docx":
            text = _docx(path)
        elif ext == ".xlsx":
            text = _xlsx(path)
        elif ext == ".pptx":
            text = _pptx(path)
        else:
            print(f"unsupported extension: {ext}", file=sys.stderr)
            return 4
    except Exception as e:  # noqa: BLE001
        print(f"extract failed: {e}", file=sys.stderr)
        return 5

    sys.stdout.write(text or "")
    return 0


if __name__ == "__main__":
    sys.exit(main())
