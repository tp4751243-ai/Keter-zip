#!/usr/bin/env python3
"""KETER-TYPE v0.9.7 — generate small test .docx files for the live
Playwright smoke (scripts/v097-playwright-smoke.mjs).

Minimal .docx: word/document.xml only (same shape as the JSZip builder
in the tsx smokes). Contents are short classical-Hebrew passages written
for this test — no copied book text, just enough lines for the importer
to classify, link dibbur hamatchil, and paginate.

Usage: python3 scripts/v097-make-test-docx.py <outdir>
Writes: gemara.docx, rashi.docx, tosafot.docx, ein-mishpat.docx,
        chumash.docx, targum.docx, rashi-mikraot.docx
"""
import sys
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

GEMARA = (
    "גמרא: תנא היכא קאי דקתני מאימתי ותו מאי שנא דתני דערבית ברישא לתני דשחרית "
    "ברישא תנא אקרא קאי דכתיב בשכבך ובקומך והכי קתני זמן קריאת שמע דשכיבה "
    "אימת משעה שהכהנים נכנסין לאכול בתרומתן. "
)
MISHNA = (
    "משנה: מאימתי קורין את שמע בערבית משעה שהכהנים נכנסים לאכול בתרומתן עד "
    "סוף האשמורה הראשונה דברי רבי אליעזר וחכמים אומרים עד חצות רבן גמליאל "
    "אומר עד שיעלה עמוד השחר. "
)
RASHI = (
    "מאימתי קורין את שמע בערבית פירוש מאיזה זמן קורין ולא קתני משעה שהכוכבים "
    "יוצאים לאשמעינן מילתא אגב אורחיה דהכהנים שנטמאו וטבלו ביום והעריב שמשן "
    "טהורים לאכול בתרומה לעת ערב. "
)
TOSAFOT = (
    "תנא היכא קאי דקתני מאימתי קושיא ותירוץ ארוך בין הראשונים חילוקים וראיות "
    "והתוספות מקשים על פירוש רשי ומתרצים בדוחק גדול. "
)
EIN_MISHPAT = (
    "מאימתי: עין משפט סימן א סעיף ב מראה מקום להלכה ברמב״ם הלכות קריאת שמע פרק א. "
)
VERSE = "בְּרֵאשִׁ֖ית בָּרָ֣א אֱלֹהִ֑ים אֵ֣ת הַשָּׁמַ֗יִם וְאֵ֥ת הָאָֽרֶץ׃ "
ONKELOS = "אונקלוס: בראשית ברא אלהים ית שמיא וית ארעא. "
RASHI_MIKRAOT = "בראשית בשביל התורה שנקראת ראשית פירוש קצר על הפסוק. "
IBN_EZRA = "אבן עזרא: בראשית יש מפרשים שהוא סמוך. "


def para(text, style=None):
    ppr = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
    return (
        f"<w:p>{ppr}<w:r><w:t xml:space=\"preserve\">"
        f"{escape(text)}</w:t></w:r></w:p>"
    )


FILES = {
    "gemara.docx": [
        para("מסכת ברכות — פרק ראשון", "Heading 1"),
        para(MISHNA, "Mishna"),
        *[para(GEMARA, "Normal") for _ in range(6)],
    ],
    "rashi.docx": [para(RASHI, "Rashi") for _ in range(6)],
    "tosafot.docx": [para(TOSAFOT, "Tosafot") for _ in range(6)],
    "ein-mishpat.docx": [para(EIN_MISHPAT, "Ein Mishpat") for _ in range(4)],
    "chumash.docx": [
        para("בראשית פרק א", "Heading 1"),
        *[para(VERSE, "Normal") for _ in range(8)],
    ],
    "targum.docx": [para(ONKELOS, "Onkelos") for _ in range(5)],
    "rashi-mikraot.docx": [para(RASHI_MIKRAOT, "Rashi") for _ in range(5)],
}


def main():
    outdir = Path(sys.argv[1])
    outdir.mkdir(parents=True, exist_ok=True)
    for name, paras in FILES.items():
        document = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<w:document xmlns:w="http://schemas.openxmlformats.org/'
            'wordprocessingml/2006/main"><w:body>'
            + "".join(paras)
            + "</w:body></w:document>"
        )
        target = outdir / name
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("word/document.xml", document)
        print(f"wrote {target} ({target.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
