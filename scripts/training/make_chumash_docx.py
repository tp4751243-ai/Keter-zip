"""Build three Word files the way a user uploads a full Chumash book:
pesukim, Onkelos and Rashi — one paragraph per pasuk / comment, a
"פרק X" heading per chapter.

  python3 -I scripts/training/make_chumash_docx.py genesis OUTDIR
"""
import json, sys
from pathlib import Path
from docx import Document
from docx.oxml import OxmlElement

book, out = sys.argv[1], Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
c = json.loads((Path('training/chumash') / book / 'corpus.json').read_text(encoding='utf-8'))
ONES = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט']
TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ']
def heb(n):
    if n == 15: return 'טו'
    if n == 16: return 'טז'
    return TENS[n // 10] + ONES[n % 10]

def para(doc, text, style=None):
    p = doc.add_paragraph(style=style)
    p._p.get_or_add_pPr().append(OxmlElement('w:bidi'))
    r = p.add_run(text)
    r._r.get_or_add_rPr().append(OxmlElement('w:rtl'))

for kind, name in [('pesukim', f"{c['bookHe']}.docx"), ('onkelos', f"תרגום אונקלוס על {c['bookHe']}.docx"), ('rashi', f"רש_י על {c['bookHe']}.docx")]:
    doc = Document()
    for ch in c['chapters']:
        para(doc, f"פרק {heb(ch['chapter'])}", 'Heading 1')
        items = ch[kind]
        for i, it in enumerate(items):
            for t in (it if isinstance(it, list) else [it]):
                if t.strip(): para(doc, t)
    doc.save(out / name)
    print('wrote', out / name)
