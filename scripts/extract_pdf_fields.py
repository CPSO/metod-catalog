#!/usr/bin/env python3
"""
Extracts labeled fields from a metodeblad PDF using pdfplumber's table
detection, instead of linearizing the whole document to text first.

Why: pdftotext -layout (the previous approach) reconstructs two-column PDFs
into a single text stream using a positional heuristic that regularly
misorders content -- confirmed to merge distinct patient groups, drop rows,
and glue unrelated labels/values together across many real samples (see
PLAN.md). pdfplumber's extract_tables() uses each word's actual bounding
box, so it recovers the PDF's real label -> value structure directly
instead of guessing at it from a flattened stream.

Does NOT interpret the data at all -- this is a pure extraction step. Field
selection, validation, and safety rules (what's trustworthy enough to
auto-apply, what needs a human) all stay in scripts/pdf-diff.js, which
consumes this script's JSON output instead of raw pdftotext text.

Known limitation this does NOT fix (see PLAN.md): pdftotext and pdfplumber
both lose superscript/subscript formatting at the font-rendering level, not
the layout level -- a PDF's superscript-3 and a literal "103" produce
identical extracted text either way. pdf-diff.js still needs to guard
against that separately (it already does, via STRIPPED_EXPONENT_RE).

Usage:
    python3 extract_pdf_fields.py <file.pdf> > <file.json>
"""

import json
import re
import sys

import pdfplumber

NPU_RE = re.compile(r"NPU\d{5}")
WHITESPACE_RE = re.compile(r"\s+")


def normalize_label(label):
    if not label:
        return None
    collapsed = WHITESPACE_RE.sub(" ", label).strip()
    return collapsed.rstrip(":").strip()


def normalize_value(value):
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned if cleaned else None


def extract_fields(pdf_path):
    fields = {}  # normalized label -> value (first non-empty wins)
    full_text_parts = []
    date_cluster = {}

    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text() or ""
            full_text_parts.append(page_text)

            for table in page.extract_tables():
                for row in table:
                    if not row:
                        continue

                    # The "Taget i brug / Revision / Erstatter" cluster sits
                    # in its own unlabeled row pair at the top of the doc
                    # (row[0] is the author, not a field label). Each date's
                    # label and its own value are still in the SAME cell
                    # here (confirmed across real samples), unlike in the
                    # linearized full-page text, where a neighboring cell's
                    # date can land in between and get grabbed by mistake
                    # (the original revisionDate/Erstatter bug this
                    # extraction rewrite was partly meant to fix -- don't
                    # reintroduce it by falling back to full-text regex).
                    for cell in row:
                        if not cell:
                            continue
                        m = re.search(r"Taget i brug:\s*\n?\s*([\d.\-]+)", cell)
                        if m and "inUseDate" not in date_cluster:
                            date_cluster["inUseDate"] = m.group(1)
                        m = re.search(r"Revision:\s*\n?\s*([\d.\-]+)", cell)
                        if m and "revisionDate" not in date_cluster:
                            date_cluster["revisionDate"] = m.group(1)
                        m = re.search(r"Erstatter:\s*\n?\s*([\d.\-]+)", cell)
                        if m and "replaces" not in date_cluster:
                            date_cluster["replaces"] = m.group(1)

                    label = normalize_label(row[0])
                    if not label:
                        continue
                    # Row values beyond the first column (some rows, like
                    # "Prøvehåndtering", spread Intern/Ekstern/Praksis across
                    # 3 columns) -- keep them joined with a separator a
                    # downstream parser can split on.
                    value_cells = [normalize_value(c) for c in row[1:]]
                    value_cells = [c for c in value_cells if c]
                    if not value_cells:
                        continue
                    value = " | ".join(value_cells)
                    if label not in fields or not fields[label]:
                        fields[label] = value

    full_text = "\n".join(full_text_parts)
    npu_match = NPU_RE.search(full_text)

    doc_id_match = re.search(r"Metodeblad nr\.\s*([A-Z]-\d+/\d+)", full_text, re.IGNORECASE)

    return {
        "npu": npu_match.group(0) if npu_match else None,
        "docId": doc_id_match.group(1) if doc_id_match else None,
        "fields": fields,
        "dates": date_cluster
    }


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python3 extract_pdf_fields.py <file.pdf>", file=sys.stderr)
        sys.exit(1)
    result = extract_fields(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False, indent=2))
