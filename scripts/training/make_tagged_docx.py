"""Layout training T8 — build the brace-tagged DOCX fixture the user's way.

  python3 scripts/training/make_tagged_docx.py

Reads training/prose/mesillat-yesharim/corpus.json and writes
training/prose/mesillat-yesharim/tagged.docx: one paragraph per tag or
text paragraph, right-to-left, unpointed (like the user's sample).
"""
import json, re, sys
from pathlib import Path
from docx import Document
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

root = Path('training/prose/mesillat-yesharim')
corpus = json.loads((root / 'corpus.json').read_text(encoding='utf-8'))
HE = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט', 'י']

def unpoint(s: str) -> str:
    s = s.replace('־', ' ')
    return re.sub(r'[֑-ֽֿ-ׇ]', '', s)

doc = Document()
def para(text: str):
    p = doc.add_paragraph()
    ppr = p._p.get_or_add_pPr()
    bidi = OxmlElement('w:bidi'); ppr.append(bidi)
    r = p.add_run(text)
    rpr = r._r.get_or_add_rPr()
    rtl = OxmlElement('w:rtl'); rpr.append(rtl)

para('{שם הספר: %s}' % corpus['bookHe'])
para('{9%s9}' % corpus['bookHe'])
for ch in corpus['chapters']:
    para('{2פרק %s2}' % HE[ch['chapter']])
    if ch['subtitle']:
        para('{3%s3}' % unpoint(ch['subtitle']))
    for t in ch['paragraphs']:
        for line in t.split('\n'):
            if line.strip():
                para(unpoint(line.strip()))
doc.save(root / 'tagged.docx')
print('wrote', root / 'tagged.docx')
