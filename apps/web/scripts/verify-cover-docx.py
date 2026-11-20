"""Render E11 browser downloads using the document skill and inspectable fixtures.

Run with bundled workspace Python, a project-local soffice directory on PATH,
and bundled Poppler on PATH. No document is sent to an external renderer.
"""

import argparse
import json
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import ZipFile

import pdfplumber
from docx import Document


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixtures", type=Path, required=True)
    parser.add_argument("--renderer", type=Path, required=True)
    args = parser.parse_args()
    fixtures = args.fixtures.resolve()
    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    files = sorted(fixtures.glob("*-a4.docx")) + sorted(fixtures.glob("*-letter.docx"))
    assert len(files) == 8, "Download all four templates in A4 and Letter first"
    expected = ["Université de Montréal", "Computer Science", "Café Algorithms", "CS 240", "Rosa Pérez", "2026-11-20"]
    summary = []
    for path in files:
        with ZipFile(path) as package:
            assert package.testzip() is None
            tree = ET.fromstring(package.read("word/document.xml"))
            text = " ".join(item.text or "" for item in tree.findall(".//w:t", namespace))
            assert all(value in text for value in expected), text
            page = tree.find(".//w:pgSz", namespace)
            assert page is not None
            assert page.attrib[f"{{{namespace['w']}}}w"] == ("11906" if "-a4" in path.name else "12240")
            assert package.read("word/media/logo.png").startswith(b"\x89PNG")
        rendered = fixtures / "rendered" / path.stem
        subprocess.run([sys.executable, str(args.renderer), str(path), "--output_dir", str(rendered), "--emit_pdf"], check=True)
        pdf = pdfplumber.open(rendered / f"{path.stem}.pdf")
        assert len(pdf.pages) == 1, f"{path.name}: expected one cover page"
        extracted = " ".join(pdf.pages[0].extract_text().split())
        assert all(value in extracted for value in expected), extracted
        for block in pdf.pages[0].extract_words():
            assert block['x0'] >= 20 and block['top'] >= 20 and block['x1'] <= pdf.pages[0].width - 20
            assert block['bottom'] <= pdf.pages[0].height - 20, f"Clipped content: {path.name}"
        summary.append({"file": path.name, "pages": len(pdf.pages), "page_points": [pdf.pages[0].width, pdf.pages[0].height], "crc": "valid", "editable": True})
    edited = Document(files[0])
    title = next(paragraph for paragraph in edited.paragraphs if paragraph.style.name == "Title")
    title.runs[0].text = "Revised campus network report"
    changed = fixtures / "edited-title.docx"
    edited.save(changed)
    subprocess.run([sys.executable, str(args.renderer), str(changed), "--output_dir", str(fixtures / "rendered/edited-title"), "--emit_pdf"], check=True)
    pdf = pdfplumber.open(fixtures / "rendered/edited-title/edited-title.pdf")
    assert len(pdf.pages) == 1 and "Revised campus network report" in " ".join(pdf.pages[0].extract_text().split())
    (fixtures / "render-report.json").write_text(json.dumps({"covers": summary, "edited_title": "rendered and readable"}, indent=2), encoding="utf-8")
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
