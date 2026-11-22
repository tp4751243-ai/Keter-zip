from pathlib import Path
import subprocess
import unicodedata
from docx import Document
from docx.shared import Mm, Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.section import WD_SECTION
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

OUT = Path("artifacts")
OUT.mkdir(exist_ok=True)
DOCX = OUT / "libreoffice-hebrew-comparison.docx"
PDF = OUT / "libreoffice-hebrew-comparison.pdf"

samples = [
    ("A — עברית ללא ניקוד (ביקורת)", "בראשית ברא אלהים"),
    ("B — ניקוד וטעמים מקוריים", "בְּרֵאשִׁ֖ית בָּרָ֣א אֱלֹהִ֑ים"),
    ("C — אותו טקסט לאחר Unicode NFC", unicodedata.normalize("NFC", "בְּרֵאשִׁ֖ית בָּרָ֣א אֱלֹהִ֑ים")),
    ("D — מילים נפרדות בפסקאות", "בְּרֵאשִׁ֖ית\nבָּרָ֣א\nאֱלֹהִ֑ים"),
    ("E — טקסט ארוך בסגנון ספר קודש", "וַיְדַבֵּ֥ר יְהוָ֖ה אֶל־מֹשֶׁ֥ה לֵּאמֹֽר׃"),
    ("F — מספרים (ביקורת)", "2026"),
]

doc = Document()
section = doc.sections[0]
section.page_width = Mm(210)
section.page_height = Mm(297)
section.top_margin = Mm(18)
section.bottom_margin = Mm(18)
section.left_margin = Mm(18)
section.right_margin = Mm(18)

def set_run_font(run, name="Frank Ruhl Libre", size=16, bold=False):
    run.font.name = name
    run.font.size = Pt(size)
    run.bold = bold
    rPr = run._element.get_or_add_rPr()
    rFonts = rPr.rFonts
    if rFonts is None:
        rFonts = OxmlElement("w:rFonts")
        rPr.insert(0, rFonts)
    for attr in ("ascii", "hAnsi", "cs", "eastAsia"):
        rFonts.set(qn("w:" + attr), name)
    run._element.get_or_add_rPr().append(OxmlElement("w:rtl"))

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
r = p.add_run("בדיקת PDF עברי — LibreOffice")
set_run_font(r, size=20, bold=True)

for label, value in samples:
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.paragraph_format.space_before = Pt(12)
    r = p.add_run(label)
    set_run_font(r, size=10, bold=True)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.paragraph_format.space_after = Pt(10)
    p.paragraph_format.keep_together = True
    for line_index, line in enumerate(value.split("\n")):
        if line_index:
            p.add_run().add_break()
        r = p.add_run(line)
        set_run_font(r, size=16)

doc.save(DOCX)
subprocess.run([
    "libreoffice", "--headless", "--convert-to", "pdf", "--outdir", str(OUT), str(DOCX)
], check=True, capture_output=True, text=True)

if not PDF.exists() or PDF.stat().st_size < 1000:
    raise SystemExit("LibreOffice did not produce a valid comparison PDF")

text_file = OUT / "libreoffice-extracted.txt"
with text_file.open("w", encoding="utf-8") as f:
    subprocess.run(["pdftotext", str(PDF), "-"], check=True, stdout=f, text=True)

with (OUT / "libreoffice-pdffonts.txt").open("w", encoding="utf-8") as f:
    subprocess.run(["pdffonts", str(PDF)], check=True, stdout=f, text=True)

with (OUT / "libreoffice-bbox.html").open("w", encoding="utf-8") as f:
    subprocess.run(["pdftotext", "-bbox-layout", str(PDF), "-"], check=True, stdout=f, text=True)

extracted = text_file.read_text(encoding="utf-8")
cleaned = "".join(ch for ch in unicodedata.normalize("NFD", extracted)
                  if not unicodedata.combining(ch) and unicodedata.category(ch) != "Cf")
(OUT / "libreoffice-extracted-normalized.txt").write_text(cleaned, encoding="utf-8")
if "בראשית" not in cleaned or "2026" not in cleaned:
    raise SystemExit("Text extraction sanity check failed: expected Hebrew control word or digits missing")

print(f"PDF: {PDF} ({PDF.stat().st_size} bytes)")
print("Fonts:")
print((OUT / "libreoffice-pdffonts.txt").read_text(encoding="utf-8"))
print("Extracted text:")
print(extracted)
