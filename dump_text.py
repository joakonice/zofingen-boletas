import sys
from pathlib import Path
import pdfplumber


def main():
    if len(sys.argv) < 2:
        print("Usage: python dump_text.py <pdf_path>")
        sys.exit(1)
    pdf_path = Path(sys.argv[1])
    out_path = pdf_path.with_suffix(".txt")
    chunks = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            chunks.append(page.extract_text() or "")
    text = "\n".join(chunks)
    out_path.write_text(text, encoding="utf-8")
    print(f"Wrote: {out_path}")


if __name__ == "__main__":
    main()


