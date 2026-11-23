#!/usr/bin/env python3
"""
Layout training — measure a vector reference page (e.g. a Vilna daf PDF
from hebrewbooks.org) and write the numbers the engine is tuned to.

    python3 -I scripts/training/measure_reference_pdf.py OUT.json PAGE.pdf [PAGE2.pdf …] [--overlay DIR]

Needs: pip install pdfplumber

Only numbers leave the PDF (sizes, ratios, positions relative to the
text block) — never the page text or images — so the output can be
committed while the reference pages stay with the user.

Stream classification (works on pages whose font names are obfuscated,
e.g. TT1569Bo00, because it uses SIZE + COLUMN, not font names):
  gemara      — the largest size class with ≥ 300 glyphs, set in the
                centre column
  commentary  — the size class with the most glyphs (Rashi + Tosafot,
                both in Rashi script); split into inner/outer by side
  marginal    — size classes < 0.75 × commentary in the outer 18% of
                the text block on either side (Ein Mishpat, Masoret …)
  header      — glyphs on the topmost line cluster above the body
"""
import json
import statistics as st
import sys
from collections import Counter, defaultdict

import pdfplumber


def segments(chars):
    """Group glyphs into horizontal runs: same size, same baseline, small gaps."""
    lines = defaultdict(list)
    for ch in chars:
        lines[(round(ch["size"], 1), round(ch["bottom"]))].append(ch)
    out = []
    for (size, y), chs in lines.items():
        chs.sort(key=lambda c: c["x0"])
        cur = [chs[0]]
        for c in chs[1:]:
            if c["x0"] - cur[-1]["x1"] > size * 2.2:
                out.append(dict(size=size, y=y, x0=cur[0]["x0"], x1=cur[-1]["x1"], n=len(cur),
                                font=Counter(x["fontname"].split("+")[-1] for x in cur).most_common(1)[0][0]))
                cur = [c]
            else:
                cur.append(c)
        out.append(dict(size=size, y=y, x0=cur[0]["x0"], x1=cur[-1]["x1"], n=len(cur),
                        font=Counter(x["fontname"].split("+")[-1] for x in cur).most_common(1)[0][0]))
    return out


def leading(segs):
    """Median baseline pitch of consecutive runs in one column."""
    ys = sorted({s["y"] for s in segs})
    diffs = [b - a for a, b in zip(ys, ys[1:]) if 0 < b - a < 40]
    return st.median(diffs) if diffs else None


def measure(path, overlay_dir=None):
    pdf = pdfplumber.open(path)
    p = pdf.pages[0]
    segs = segments(p.chars)
    if not segs:
        return {"file": path, "error": "no text layer (scanned image) — cannot measure"}

    size_n = Counter()
    for s in segs:
        size_n[s["size"]] += s["n"]
    commentary_size = size_n.most_common(1)[0][0]
    big = [sz for sz, n in size_n.items() if n >= 300 and sz > commentary_size * 1.05]
    gemara_size = max(big) if big else None

    # header = topmost line cluster that sits above every gemara/commentary run
    body = [s for s in segs if s["size"] in (gemara_size, commentary_size)]
    body_top = min(s["y"] - s["size"] for s in body)
    header = [s for s in segs if s["y"] < body_top + 2]
    rest = [s for s in segs if s not in header]

    x0 = min(s["x0"] for s in rest)
    x1 = max(s["x1"] for s in rest)
    y0 = min(s["y"] - s["size"] for s in rest)
    y1 = max(s["y"] for s in rest)
    W = x1 - x0

    def rel(x):
        return round((x - x0) / W, 4)

    gem = [s for s in rest if s["size"] == gemara_size]
    com = [s for s in rest if s["size"] == commentary_size]
    marg = [s for s in rest if s["size"] < commentary_size * 0.75 and ((s["x1"] - x0) / W < 0.2 or (s["x0"] - x0) / W > 0.8)]

    gem_x0 = st.median([s["x0"] for s in gem]) if gem else None
    gem_x1 = st.median([s["x1"] for s in gem]) if gem else None
    mid = (gem_x0 + gem_x1) / 2 if gem else (x0 + x1) / 2
    com_right = [s for s in com if s["x0"] > mid]
    com_left = [s for s in com if s["x1"] < mid]
    com_full = [s for s in com if s["x0"] < mid < s["x1"]]

    def col(ss):
        if not ss:
            return None
        return dict(x0=rel(st.median([s["x0"] for s in ss])), x1=rel(st.median([s["x1"] for s in ss])),
                    lines=len({s["y"] for s in ss}), leadingRatio=round((leading(ss) or 0) / (gemara_size or 1), 3))

    marg_left = [s for s in marg if (s["x1"] - x0) / W < 0.2]
    marg_right = [s for s in marg if (s["x0"] - x0) / W > 0.8]

    head_sizes = Counter()
    for s in header:
        head_sizes[s["size"]] += s["n"]
    header_size = head_sizes.most_common(1)[0][0] if head_sizes else None
    header_baseline = st.median([s["y"] for s in header if s["size"] == header_size]) if header else None

    result = {
        "file": path.split("/")[-1],
        "pageAspect": round(p.height / p.width, 4),
        "textBlock": dict(widthToHeight=round(W / (y1 - y0), 4)),
        "sizes": {
            "gemaraPt": gemara_size,
            "commentaryPt": commentary_size,
            "commentaryToGemara": round(commentary_size / gemara_size, 3) if gemara_size else None,
            "marginalToGemara": round(st.median([s["size"] for s in marg]) / gemara_size, 3) if marg and gemara_size else None,
            "headerToGemara": round(header_size / gemara_size, 3) if header_size and gemara_size else None,
        },
        "textBlockWidthInGemaraEm": round(W / gemara_size, 2) if gemara_size else None,
        "columns": {
            "gemara": col(gem),
            "commentaryRight": col(com_right),
            "commentaryLeft": col(com_left),
            "commentaryFullWidthLines": len({s["y"] for s in com_full}),
            "marginLeft": col(marg_left),
            "marginRight": col(marg_right),
        },
        "header": {
            "baselineAboveBodyInGemaraEm": round((body_top - header_baseline) / gemara_size, 3)
            if header_baseline and gemara_size else None,
            "runs": len(header),
        },
        "fill": {
            "gemaraLinesShare": round(sum(s["n"] for s in gem) / max(1, sum(s["n"] for s in rest)), 3),
        },
    }

    if overlay_dir:
        import os
        os.makedirs(overlay_dir, exist_ok=True)
        im = p.to_image(resolution=60)
        colors = {"gem": (220, 40, 40), "cr": (40, 90, 220), "cl": (30, 160, 60), "cf": (160, 60, 200),
                  "mg": (240, 150, 0), "hd": (0, 170, 170)}
        groups = [("gem", gem), ("cr", com_right), ("cl", com_left), ("cf", com_full), ("mg", marg), ("hd", header)]
        for key, ss in groups:
            im.draw_rects([(s["x0"], s["y"] - s["size"], s["x1"], s["y"]) for s in ss],
                          stroke=colors[key], fill=colors[key] + (50,), stroke_width=1)
        im.save(os.path.join(overlay_dir, result["file"].replace(".pdf", "-overlay.png")))
    return result


def main():
    args = sys.argv[1:]
    overlay = None
    if "--overlay" in args:
        i = args.index("--overlay")
        overlay = args[i + 1]
        del args[i:i + 2]
    out, files = args[0], args[1:]
    results = [measure(f, overlay) for f in files]
    ok = [r for r in results if "error" not in r]

    def agg(getter):
        vals = [getter(r) for r in ok]
        vals = [v for v in vals if isinstance(v, (int, float))]
        return round(st.median(vals), 3) if vals else None

    summary = {
        "pages": len(ok),
        "commentaryToGemara": agg(lambda r: r["sizes"]["commentaryToGemara"]),
        "marginalToGemara": agg(lambda r: r["sizes"]["marginalToGemara"]),
        "headerToGemara": agg(lambda r: r["sizes"]["headerToGemara"]),
        "textBlockWidthInGemaraEm": agg(lambda r: r["textBlockWidthInGemaraEm"]),
        "gemaraLeadingRatio": agg(lambda r: (r["columns"]["gemara"] or {}).get("leadingRatio")),
        "commentaryLeadingRatio": agg(lambda r: (r["columns"]["commentaryRight"] or {}).get("leadingRatio")),
        "gemaraColumnWidth": agg(lambda r: (r["columns"]["gemara"]["x1"] - r["columns"]["gemara"]["x0"]) if r["columns"]["gemara"] else None),
        "marginColumnWidth": agg(lambda r: (r["columns"]["marginLeft"]["x1"] - r["columns"]["marginLeft"]["x0"]) if r["columns"]["marginLeft"] else None),
        "headerBaselineAboveBodyInGemaraEm": agg(lambda r: r["header"]["baselineAboveBodyInGemaraEm"]),
        "pageAspect": agg(lambda r: r["pageAspect"]),
    }
    with open(out, "w", encoding="utf-8") as fh:
        json.dump({"summary": summary, "pages": results}, fh, ensure_ascii=False, indent=1)
    print(json.dumps(summary, indent=1))
    for r in results:
        if "error" in r:
            print("skip:", r["file"], r["error"])


if __name__ == "__main__":
    main()
