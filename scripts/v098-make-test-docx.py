#!/usr/bin/env python3
"""KETER-TYPE v0.9.8 Phases 3+4 — generate synthetic multi-part Hebrew
.docx fixtures for the live Playwright smoke
(scripts/v098-phase34-playwright-smoke.mjs).

Minimal .docx: word/document.xml only (same shape as the JSZip builder
in the tsx smokes and as scripts/v097-make-test-docx.py).

Contents are short classical-Hebrew test phrases assembled for this
test — no copied book text, just enough lines for the importer to
classify roles, tokenize dibbur hamatchil (bold lead), strip nikkud,
tag citations, link 100+ dibburim to the Gemara, and paginate a
multi-page Vilna-style book. 50 Rashi + 50 Tosafot dibburim match
anchor phrases that appear verbatim in the Gemara file; 5 Rashi +
3 Tosafot dibburim deliberately do NOT appear in the Gemara, so the
import review queue (and the Phase 3 LinkingReport line) appears.
Some Gemara anchors and some dibbur leads are pointed (nikkud) so the
nikud-stripping matcher is exercised; some commentary paragraphs carry
a parenthesized citation (ברכות ב.) to exercise citation tagging.

Usage: python3 scripts/v098-make-test-docx.py <outdir>
Writes: gemara-50.docx, rashi-50.docx, tosafot-50.docx
"""
import sys
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

# 60 short anchor phrases (2-4 words each). The Gemara file contains
# all of them verbatim; each Rashi/Tosafot dibbur lead is one of them
# (or, for the 8 deliberate orphans, a phrase that is NOT in the Gemara).
ANCHORS = [
    "מאימתי קורין את שמע", "עד סוף האשמורה", "דברי רבי אליעזר",
    "וחכמים אומרים עד חצות", "רבן גמליאל אומר", "עד שיעלה עמוד השחר",
    "תנא היכא קאי", "דקתני מאימתי", "מאי שנא הכא", "בראש הפרק",
    "אמר רבי יהושע בן לוי", "זמן קריאת שמע", "של ערבית", "כרבי אליעזר",
    "משעה שהכהנים נכנסים", "לאכול בתרומתן", "בשכבך ובקומך",
    "זמן קריאת שמע דשכיבה", "אימת משעה", "שהכהנים נכנסין",
    "תנו רבנן", "קורין את שמע בשחרית", "משנה מאימתי",
    "גמרא אמר רב יהודה", "אמר שמואל הלכה", "אמר רבי אלעזר",
    "אמר רבי חנינא", "תלמידי חכמים", "מרבים שלום בעולם",
    "שנאמר וכל בניך", "למודי ה'", "רב שלום בניך", "אל תקרי בניך",
    "אלא בוניך", "אמר רבי חייא בר אבא", "אמר רבי יוחנן",
    "משום רבי שמעון בן יוחאי", "תלמוד תורה כנגד כולם",
    "אלו דברים שאין להם שיעור", "הפאה והבכורים", "והראיון",
    "וגמילות חסדים", "ותלמוד תורה", "אלו דברים שאדם אוכל",
    "פירותיהן בעולם הזה", "והקרן קיימת לו", "לעולם הבא",
    "כיבוד אב ואם", "גמילות חסדים", "והבאת שלום", "בין אדם לחברו",
    "בשחר מברך שתים לפניה", "ואחת לאחריה", "ובערב שתים לפניה",
    "ושתים לאחריה", "אחת ארוכה ואחת קצרה", "מקום שאמרו להאריך",
    "אינו רשאי לקצר", "לקצר אינו רשאי להאריך", "לחתום אינו רשאי",
    "שלא לחתום", "הקורא את שמע", "צריך להזכיר", "יציאת מצרים בלילה",
]

# Pointed (nikkud) variants of a few anchors — the same words with
# vowel points, so the matcher must strip nikkud to match them.
POINTED = {
    "מאימתי קורין את שמע": "מֵאֵימָתַי קוֹרִין אֶת שְׁמַע",
    "עד סוף האשמורה": "עַד סוֹף הָאַשְׁמוּרָה",
    "רבן גמליאל אומר": "רַבָּן גַּמְלִיאֵל אוֹמֵר",
    "בשכבך ובקומך": "בְּשָׁכְבְּךָ וּבְקוּמֶךָ",
    "תלמוד תורה כנגד כולם": "תַּלְמוּד תּוֹרָה כְּנֶגֶד כֻּלָּם",
    "וחכמים אומרים עד חצות": "וַחֲכָמִים אוֹמְרִים עַד חֲצוֹת",
    "דקתני מאימתי": "דְּקָתָנֵי מֵאֵימָתַי",
    "אמר רבי יהושע בן לוי": "אָמַר רַבִּי יְהוֹשֻׁעַ בֶּן לֵוִי",
    "משעה שהכהנים נכנסים": "מִשָּׁעָה שֶׁהַכֹּהֲנִים נִכְנָסִים",
    "אימת משעה": "אֵימַת מִשָּׁעָה",
    "תנו רבנן": "תָּנוּ רַבָּנַן",
    "אמר רבי אלעזר": "אָמַר רַבִּי אֶלְעָזָר",
    "מרבים שלום בעולם": "מַרְבִּים שָׁלוֹם בָּעוֹלָם",
    "אמר רבי חייא בר אבא": "אָמַר רַבִּי חִיָּיא בַּר אַבָּא",
    "אלו דברים שאין להם שיעור": "אֵלּוּ דְּבָרִים שֶׁאֵין לָהֶם שִׁעוּר",
    "אלו דברים שאדם אוכל": "אֵלּוּ דְּבָרִים שֶׁאָדָם אוֹכֵל",
    "כיבוד אב ואם": "כִּבּוּד אָב וָאֵם",
    "בשחר מברך שתים לפניה": "בַּשַּׁחַר מְבָרֵךְ שְׁתַּיִם לְפָנֶיהָ",
}

# Dibbur leads that do NOT appear in the Gemara file (deliberate
# orphans → review queue + LinkingReport "awaiting review" count).
ORPHANS = [
    "דבר שאינו כתוב כלל בגמרא", "פירוש שאין לו מקור בסוגיא",
    "קושיא שאין לה תירוץ כאן", "הערה על סוגיא אחרת לגמרי",
    "דיבור שאינו נמצא בדף זה", "גלוסה על מסכת אחרת",
    "הערת שוליים בלא דיבור", "מראה מקום שאינו כאן",
]

FILLER = (
    " פירוש וביאור ארוך על הסוגיא חילוקים וראיות מן הראשונים "
    "והאחרונים ותירוצים וקושיות ודרכים ביישוב הסוגיא."
)


def para(text, style=None, bold_prefix=None):
    """One paragraph. bold_prefix (the dibbur lead) is a bold run;
    the rest is a normal run — the shape Phase 2 tokenization reads
    (Bold = dibbur)."""
    ppr = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
    if bold_prefix:
        runs = (
            f'<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">'
            f"{escape(bold_prefix)}</w:t></w:r>"
            f'<w:r><w:t xml:space="preserve">{escape(text)}</w:t></w:r>'
        )
    else:
        runs = f'<w:r><w:t xml:space="preserve">{escape(text)}</w:t></w:r>'
    return f"<w:p>{ppr}{runs}</w:p>"


def gemara_paras():
    out = [para("מסכת ברכות — פרק ראשון", "Heading 1")]
    # Mishna paragraph: anchors 0-5.
    out.append(para(
        "משנה: " + " ".join(ANCHORS[0:6]) + "." + FILLER, "Mishna"))
    # 30 Gemara paragraphs, 2 anchors each (anchors cycle 0..59).
    for i in range(30):
        a1 = ANCHORS[(i * 2) % len(ANCHORS)]
        a2 = ANCHORS[(i * 2 + 1) % len(ANCHORS)]
        # Every 5th paragraph points its first anchor (nikkud test).
        if i % 5 == 0 and a1 in POINTED:
            a1 = POINTED[a1]
        out.append(para(
            f"גמרא: {a1} {a2}." + FILLER, "Normal"))
    return out


def commentary_paras(style, matched_count, orphans):
    """matched_count paragraphs whose bold lead is an anchor from the
    Gemara file, then `orphans` paragraphs whose bold lead is not in
    the Gemara. Every 7th paragraph carries a parenthesized citation;
    every 6th matched lead is pointed."""
    out = []
    for i in range(matched_count):
        anchor = ANCHORS[i % len(ANCHORS)]
        lead = POINTED.get(anchor, anchor) if i % 6 == 0 else anchor
        body = f": פירוש על {anchor}." + FILLER
        if i % 7 == 3:
            body += " (ברכות ב.)"
        out.append(para(body, style, bold_prefix=lead))
    for j, orphan in enumerate(orphans):
        out.append(para(
            f": הערה זו אינה קשורה לדף הנוכחי." + FILLER,
            style, bold_prefix=orphan))
    return out


FILES = {
    "gemara-50.docx": gemara_paras(),
    "rashi-50.docx": commentary_paras("Rashi", 50, ORPHANS[:5]),
    "tosafot-50.docx": commentary_paras("Tosafot", 50, ORPHANS[5:]),
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
        print(f"wrote {target} ({target.stat().st_size} bytes, {len(paras)} paras)")


if __name__ == "__main__":
    main()
