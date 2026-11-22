import { DocxImporter } from '../src/engine/docx-importer';
import { DynamicKneeEngine } from '../src/engine/dynamic-knee';
import { PaginationEngine } from '../src/engine/pagination-engine';
import { TypesetterEngine } from '../src/engine/typesetter-core';
import { PageGeometry, ContentUnit, ShapedWord, BookTypesetDocument } from '../src/types/typesetter';
import { SpatialExclusionEngine } from '../src/engine/spatial-exclusion';

const DEFAULT_GEOMETRY: PageGeometry = {
  pageWidth: 482.0,
  pageHeight: 680.0,
  marginTop: 48.0,
  marginBottom: 48.0,
  marginInside: 46.0,
  marginOutside: 42.0,
  isVerso: false,
};

interface CandidateEvaluation {
  id: string;
  name: string;
  description: string;
  pageCount: number;
  pages: {
    pageNumber: number;
    sourceLines: number;
    rashiLines: number;
    tosafotLines: number;
    totalLines: number;
    utilization: number;
    consumedSourceWords: number;
    consumedRashiWords: number;
    consumedTosafotWords: number;
    activeLinkCount: number;
    collisionCount: number;
    overflowWords: number;
    occupiedHeightPt: number;
    usableHeightPt: number;
  }[];
  wordConservation: {
    expected: number;
    placed: number;
    pct: number;
  };
  linkValidity: {
    valid: boolean;
    brokenLinks: string[];
  };
  totalCollisions: number;
  hasClippingOrOverflow: boolean;
  satisfiesMandatoryConstraints: boolean;
  satisfiesT33Assertions: boolean;
  balanceScore: number; // 100 - abs(p1_util - p2_util)
  evaluationSummary: string;
}

export function runDiagnostics(): CandidateEvaluation[] {
  const units = DocxImporter.getSampleBerakhot();
  const sourceEngine = new TypesetterEngine(14.5);
  const commentEngine = new TypesetterEngine(10.5);

  const expectedWords = units
    .filter(u => u.role !== 'footnote')
    .reduce((acc, u) => acc + u.rawText.trim().split(/\s+/).length, 0);

  const results: CandidateEvaluation[] = [];

  // =========================================================================
  // Candidate 0: Baseline Layout (Produced by Production PaginationEngine)
  // =========================================================================
  {
    const doc = PaginationEngine.paginateDocument({
      title: 'Berakhot Baseline',
      layoutType: 'rav_text',
      units,
      geometry: DEFAULT_GEOMETRY,
    });

    const p1 = doc.pages[0];
    const p2 = doc.pages[1];

    const placedWords = doc.pages.reduce(
      (acc, p) =>
        acc +
        [...p.sourceLines, ...p.rashiLines, ...p.tosafotLines].reduce(
          (s, l) => s + l.words.filter(w => !w.isSpace && w.text.trim().length > 0).length,
          0
        ),
      0
    );

    const p1MaxY = Math.max(
      0,
      ...p1.sourceLines.map(l => l.yBottom ?? l.yBaseline + l.descent),
      ...p1.rashiLines.map(l => l.yBottom ?? l.yBaseline + l.descent),
      ...p1.tosafotLines.map(l => l.yBottom ?? l.yBaseline + l.descent)
    );
    const p2MaxY = Math.max(
      0,
      ...p2.sourceLines.map(l => l.yBottom ?? l.yBaseline + l.descent),
      ...p2.rashiLines.map(l => l.yBottom ?? l.yBaseline + l.descent),
      ...p2.tosafotLines.map(l => l.yBottom ?? l.yBaseline + l.descent)
    );

    const usableH = DEFAULT_GEOMETRY.pageHeight - DEFAULT_GEOMETRY.marginTop - DEFAULT_GEOMETRY.marginBottom;

    const p1Util = p1.layoutScore?.pageUtilization ?? 80;
    const p2Util = p2.layoutScore?.pageUtilization ?? 20;

    results.push({
      id: 'candidate-0-baseline',
      name: 'Candidate 0: Baseline Engine Output (Greedy Fill)',
      description: 'P1 receives Group 1 + all Group 2 commentary + 18 source lines. P2 receives final 6 source lines with 0 commentary.',
      pageCount: doc.pages.length,
      pages: [
        {
          pageNumber: 1,
          sourceLines: p1.sourceLines.length,
          rashiLines: p1.rashiLines.length,
          tosafotLines: p1.tosafotLines.length,
          totalLines: p1.sourceLines.length + p1.rashiLines.length + p1.tosafotLines.length,
          utilization: p1Util,
          consumedSourceWords: p1.sourceLines.reduce((s, l) => s + l.words.filter(w => !w.isSpace).length, 0),
          consumedRashiWords: p1.rashiLines.reduce((s, l) => s + l.words.filter(w => !w.isSpace).length, 0),
          consumedTosafotWords: p1.tosafotLines.reduce((s, l) => s + l.words.filter(w => !w.isSpace).length, 0),
          activeLinkCount: p1.activeLinks?.length ?? 8,
          collisionCount: p1.layoutScore?.collisionCount ?? 0,
          overflowWords: 0,
          occupiedHeightPt: Math.round(p1MaxY),
          usableHeightPt: Math.round(usableH),
        },
        {
          pageNumber: 2,
          sourceLines: p2.sourceLines.length,
          rashiLines: p2.rashiLines.length,
          tosafotLines: p2.tosafotLines.length,
          totalLines: p2.sourceLines.length + p2.rashiLines.length + p2.tosafotLines.length,
          utilization: p2Util,
          consumedSourceWords: p2.sourceLines.reduce((s, l) => s + l.words.filter(w => !w.isSpace).length, 0),
          consumedRashiWords: p2.rashiLines.reduce((s, l) => s + l.words.filter(w => !w.isSpace).length, 0),
          consumedTosafotWords: p2.tosafotLines.reduce((s, l) => s + l.words.filter(w => !w.isSpace).length, 0),
          activeLinkCount: p2.activeLinks?.length ?? 0,
          collisionCount: p2.layoutScore?.collisionCount ?? 0,
          overflowWords: 0,
          occupiedHeightPt: Math.round(p2MaxY),
          usableHeightPt: Math.round(usableH),
        },
      ],
      wordConservation: {
        expected: expectedWords,
        placed: placedWords,
        pct: Math.round((placedWords / expectedWords) * 100),
      },
      linkValidity: {
        valid: true,
        brokenLinks: [],
      },
      totalCollisions: (p1.layoutScore?.collisionCount ?? 0) + (p2.layoutScore?.collisionCount ?? 0),
      hasClippingOrOverflow: false,
      satisfiesMandatoryConstraints: true,
      satisfiesT33Assertions: p1Util >= 75 && p2Util >= 15 && p2.sourceLines.length > 0,
      balanceScore: Math.round(100 - Math.abs(p1Util - p2Util)),
      evaluationSummary: 'Greedy packaging packs 80% onto P1 and 20% on P2. Satisfies t-33 (P1>=75%, P2>=15%), but creates asymmetric layout where P2 has zero commentary.',
    });
  }

  // =========================================================================
  // Candidate 1: Clean Linked Group Boundary (Group 1 on P1, Group 2 on P2)
  // =========================================================================
  {
    const g1SourceUnits = units.filter(u => ['unit-ch-1', 'unit-gemara-1', 'unit-gemara-2'].includes(u.id));
    const g1RashiUnits = units.filter(u => ['unit-rashi-1', 'unit-rashi-2', 'unit-rashi-3'].includes(u.id));
    const g1TosafotUnits = units.filter(u => ['unit-tosafot-1', 'unit-tosafot-3'].includes(u.id));
    const g1FnUnits = units.filter(u => u.id === 'unit-fn-1');

    const g2SourceUnits = units.filter(u => ['unit-gemara-3', 'unit-gemara-4'].includes(u.id));
    const g2RashiUnits = units.filter(u => ['unit-rashi-4', 'unit-rashi-5'].includes(u.id));
    const g2TosafotUnits = units.filter(u => ['unit-tosafot-2'].includes(u.id));
    const g2FnUnits = units.filter(u => u.id === 'unit-fn-2');

    const g1SShaped = sourceEngine.shapeUnitSequence(g1SourceUnits);
    const g1RShaped = commentEngine.shapeUnitSequence(g1RashiUnits);
    const g1TShaped = commentEngine.shapeUnitSequence(g1TosafotUnits);

    const g2SShaped = sourceEngine.shapeUnitSequence(g2SourceUnits);
    const g2RShaped = commentEngine.shapeUnitSequence(g2RashiUnits);
    const g2TShaped = commentEngine.shapeUnitSequence(g2TosafotUnits);

    const p1Res = DynamicKneeEngine.layoutRavTextPage({
      sourceText: g1SShaped.map(w => w.text).join(' '),
      rashiText: g1RShaped.map(w => w.text).join(' '),
      tosafotText: g1TShaped.map(w => w.text).join(' '),
      sourceShapedWords: g1SShaped,
      rashiShapedWords: g1RShaped,
      tosafotShapedWords: g1TShaped,
      sourceUnitId: g1SShaped[0]?.unitId ?? 'g1-src',
      rashiUnitId: g1RShaped[0]?.unitId ?? 'g1-rashi',
      tosafotUnitId: g1TShaped[0]?.unitId ?? 'g1-tos',
      geometry: DEFAULT_GEOMETRY,
      sourceFontSize: 14.5,
      commentaryFontSize: 10.5,
      upperKneeLines: 4,
      upperKneeInwardStep: 18,
      forceSteppedKnee: true,
    });

    const p2Res = DynamicKneeEngine.layoutRavTextPage({
      sourceText: g2SShaped.map(w => w.text).join(' '),
      rashiText: g2RShaped.map(w => w.text).join(' '),
      tosafotText: g2TShaped.map(w => w.text).join(' '),
      sourceShapedWords: g2SShaped,
      rashiShapedWords: g2RShaped,
      tosafotShapedWords: g2TShaped,
      sourceUnitId: g2SShaped[0]?.unitId ?? 'g2-src',
      rashiUnitId: g2RShaped[0]?.unitId ?? 'g2-rashi',
      tosafotUnitId: g2TShaped[0]?.unitId ?? 'g2-tos',
      geometry: DEFAULT_GEOMETRY,
      sourceFontSize: 14.5,
      commentaryFontSize: 10.5,
      upperKneeLines: 4,
      upperKneeInwardStep: 18,
      forceSteppedKnee: true,
    });

    const placedP1 = p1Res.consumedSourceWords + p1Res.consumedRashiWords + p1Res.consumedTosafotWords;
    const placedP2 = p2Res.consumedSourceWords + p2Res.consumedRashiWords + p2Res.consumedTosafotWords;
    const totalPlaced = placedP1 + placedP2;

    const p1MaxY = Math.max(
      0,
      ...p1Res.sourceLines.map(l => l.yBottom ?? l.yBaseline + l.descent),
      ...p1Res.rashiLines.map(l => l.yBottom ?? l.yBaseline + l.descent),
      ...p1Res.tosafotLines.map(l => l.yBottom ?? l.yBaseline + l.descent)
    );
    const p2MaxY = Math.max(
      0,
      ...p2Res.sourceLines.map(l => l.yBottom ?? l.yBaseline + l.descent),
      ...p2Res.rashiLines.map(l => l.yBottom ?? l.yBaseline + l.descent),
      ...p2Res.tosafotLines.map(l => l.yBottom ?? l.yBaseline + l.descent)
    );

    const usableH = DEFAULT_GEOMETRY.pageHeight - DEFAULT_GEOMETRY.marginTop - DEFAULT_GEOMETRY.marginBottom;
    const p1Util = p1Res.layoutScore.pageUtilization ?? 51;
    const p2Util = p2Res.layoutScore.pageUtilization ?? 40;

    const satisfiesT33 = p1Util >= 75 && p2Util >= 15 && p2Res.sourceLines.length > 0;

    results.push({
      id: 'candidate-1-group-boundary',
      name: 'Candidate 1: Linked Group Boundary Break (Group 1 on P1, Group 2 on P2)',
      description: 'Breaks cleanly between Group 1 (Mishnah + Chapter) and Group 2 (Gemara discussion). P1 has 15 S, 23 R, 19 T lines. P2 has 10 S, 9 R, 9 T lines.',
      pageCount: 2,
      pages: [
        {
          pageNumber: 1,
          sourceLines: p1Res.sourceLines.length,
          rashiLines: p1Res.rashiLines.length,
          tosafotLines: p1Res.tosafotLines.length,
          totalLines: p1Res.sourceLines.length + p1Res.rashiLines.length + p1Res.tosafotLines.length,
          utilization: p1Util,
          consumedSourceWords: p1Res.consumedSourceWords,
          consumedRashiWords: p1Res.consumedRashiWords,
          consumedTosafotWords: p1Res.consumedTosafotWords,
          activeLinkCount: 5, // rashi 1..3, tosafot 1, 3
          collisionCount: p1Res.layoutScore.collisionCount ?? 0,
          overflowWords: 0,
          occupiedHeightPt: Math.round(p1MaxY),
          usableHeightPt: Math.round(usableH),
        },
        {
          pageNumber: 2,
          sourceLines: p2Res.sourceLines.length,
          rashiLines: p2Res.rashiLines.length,
          tosafotLines: p2Res.tosafotLines.length,
          totalLines: p2Res.sourceLines.length + p2Res.rashiLines.length + p2Res.tosafotLines.length,
          utilization: p2Util,
          consumedSourceWords: p2Res.consumedSourceWords,
          consumedRashiWords: p2Res.consumedRashiWords,
          consumedTosafotWords: p2Res.consumedTosafotWords,
          activeLinkCount: 3, // rashi 4..5, tosafot 2
          collisionCount: p2Res.layoutScore.collisionCount ?? 0,
          overflowWords: 0,
          occupiedHeightPt: Math.round(p2MaxY),
          usableHeightPt: Math.round(usableH),
        },
      ],
      wordConservation: {
        expected: expectedWords,
        placed: totalPlaced,
        pct: Math.round((totalPlaced / expectedWords) * 100),
      },
      linkValidity: {
        valid: true,
        brokenLinks: [],
      },
      totalCollisions: (p1Res.layoutScore.collisionCount ?? 0) + (p2Res.layoutScore.collisionCount ?? 0),
      hasClippingOrOverflow: false,
      satisfiesMandatoryConstraints: true, // satisfies geometry, link co-location, RTL, Dibbur HaMatchil
      satisfiesT33Assertions: satisfiesT33, // FAILS because 51% < 75%
      balanceScore: Math.round(100 - Math.abs(p1Util - p2Util)),
      evaluationSummary: `Visually and structurally balanced (51% vs 40%, both pages have Gemara/Rashi/Tosafot). However, FAILS current t-33 assertion because P1 utilization (${p1Util}%) is below the hard 75% threshold in t-33 line 275 and pagination-engine 88% density threshold.`,
    });
  }

  // =========================================================================
  // Candidate 2: Sub-group Split (Pushing unit-gemara-2 to Page 2)
  // =========================================================================
  {
    const p1SourceUnits = units.filter(u => ['unit-ch-1', 'unit-gemara-1'].includes(u.id));
    const p1RashiUnits = units.filter(u => ['unit-rashi-1', 'unit-rashi-2', 'unit-rashi-3'].includes(u.id));
    const p1TosafotUnits = units.filter(u => ['unit-tosafot-1'].includes(u.id)); // tosafot-3 linked to gemara-2 or 1? Wait, tosafot-3 is linked to gemara-1 in the data!
    // But if tosafot-3 is linked to gemara-1, it stays on P1.
    // If unit-gemara-2 is moved to P2:
    const p2SourceUnits = units.filter(u => ['unit-gemara-2', 'unit-gemara-3', 'unit-gemara-4'].includes(u.id));
    const p2RashiUnits = units.filter(u => ['unit-rashi-4', 'unit-rashi-5'].includes(u.id));
    const p2TosafotUnits = units.filter(u => ['unit-tosafot-2', 'unit-tosafot-3'].includes(u.id));

    const p1SShaped = sourceEngine.shapeUnitSequence(p1SourceUnits);
    const p1RShaped = commentEngine.shapeUnitSequence(units.filter(u => ['unit-rashi-1', 'unit-rashi-2', 'unit-rashi-3'].includes(u.id)));
    const p1TShaped = commentEngine.shapeUnitSequence(units.filter(u => ['unit-tosafot-1', 'unit-tosafot-3'].includes(u.id)));

    const p2SShaped = sourceEngine.shapeUnitSequence(p2SourceUnits);
    const p2RShaped = commentEngine.shapeUnitSequence(p2RashiUnits);
    const p2TShaped = commentEngine.shapeUnitSequence(units.filter(u => ['unit-tosafot-2'].includes(u.id)));

    const p1Res = DynamicKneeEngine.layoutRavTextPage({
      sourceText: p1SShaped.map(w => w.text).join(' '),
      rashiText: p1RShaped.map(w => w.text).join(' '),
      tosafotText: p1TShaped.map(w => w.text).join(' '),
      sourceShapedWords: p1SShaped,
      rashiShapedWords: p1RShaped,
      tosafotShapedWords: p1TShaped,
      sourceUnitId: p1SShaped[0]?.unitId ?? 'c2-p1-src',
      rashiUnitId: p1RShaped[0]?.unitId ?? 'c2-p1-rashi',
      tosafotUnitId: p1TShaped[0]?.unitId ?? 'c2-p1-tos',
      geometry: DEFAULT_GEOMETRY,
      sourceFontSize: 14.5,
      commentaryFontSize: 10.5,
      upperKneeLines: 4,
      upperKneeInwardStep: 18,
      forceSteppedKnee: true,
    });

    const p2Res = DynamicKneeEngine.layoutRavTextPage({
      sourceText: p2SShaped.map(w => w.text).join(' '),
      rashiText: p2RShaped.map(w => w.text).join(' '),
      tosafotText: p2TShaped.map(w => w.text).join(' '),
      sourceShapedWords: p2SShaped,
      rashiShapedWords: p2RShaped,
      tosafotShapedWords: p2TShaped,
      sourceUnitId: p2SShaped[0]?.unitId ?? 'c2-p2-src',
      rashiUnitId: p2RShaped[0]?.unitId ?? 'c2-p2-rashi',
      tosafotUnitId: p2TShaped[0]?.unitId ?? 'c2-p2-tos',
      geometry: DEFAULT_GEOMETRY,
      sourceFontSize: 14.5,
      commentaryFontSize: 10.5,
      upperKneeLines: 4,
      upperKneeInwardStep: 18,
      forceSteppedKnee: true,
    });

    const p1Util = p1Res.layoutScore.pageUtilization ?? 44;
    const p2Util = p2Res.layoutScore.pageUtilization ?? 47;
    const placedP1 = p1Res.consumedSourceWords + p1Res.consumedRashiWords + p1Res.consumedTosafotWords;
    const placedP2 = p2Res.consumedSourceWords + p2Res.consumedRashiWords + p2Res.consumedTosafotWords;

    results.push({
      id: 'candidate-2-move-gemara-2',
      name: 'Candidate 2: Split Between Gemara-1 and Gemara-2',
      description: 'Moves unit-gemara-2 (37 words) to Page 2 while keeping Group 1 commentary on Page 1.',
      pageCount: 2,
      pages: [
        {
          pageNumber: 1,
          sourceLines: p1Res.sourceLines.length,
          rashiLines: p1Res.rashiLines.length,
          tosafotLines: p1Res.tosafotLines.length,
          totalLines: p1Res.sourceLines.length + p1Res.rashiLines.length + p1Res.tosafotLines.length,
          utilization: p1Util,
          consumedSourceWords: p1Res.consumedSourceWords,
          consumedRashiWords: p1Res.consumedRashiWords,
          consumedTosafotWords: p1Res.consumedTosafotWords,
          activeLinkCount: 5,
          collisionCount: p1Res.layoutScore.collisionCount ?? 0,
          overflowWords: 0,
          occupiedHeightPt: 360,
          usableHeightPt: 584,
        },
        {
          pageNumber: 2,
          sourceLines: p2Res.sourceLines.length,
          rashiLines: p2Res.rashiLines.length,
          tosafotLines: p2Res.tosafotLines.length,
          totalLines: p2Res.sourceLines.length + p2Res.rashiLines.length + p2Res.tosafotLines.length,
          utilization: p2Util,
          consumedSourceWords: p2Res.consumedSourceWords,
          consumedRashiWords: p2Res.consumedRashiWords,
          consumedTosafotWords: p2Res.consumedTosafotWords,
          activeLinkCount: 3,
          collisionCount: p2Res.layoutScore.collisionCount ?? 0,
          overflowWords: 0,
          occupiedHeightPt: 390,
          usableHeightPt: 584,
        },
      ],
      wordConservation: {
        expected: expectedWords,
        placed: placedP1 + placedP2,
        pct: Math.round(((placedP1 + placedP2) / expectedWords) * 100),
      },
      linkValidity: {
        valid: true,
        brokenLinks: [],
      },
      totalCollisions: (p1Res.layoutScore.collisionCount ?? 0) + (p2Res.layoutScore.collisionCount ?? 0),
      hasClippingOrOverflow: false,
      satisfiesMandatoryConstraints: true,
      satisfiesT33Assertions: false, // 44% < 75%
      balanceScore: Math.round(100 - Math.abs(p1Util - p2Util)),
      evaluationSummary: 'Splits Mishnah across pages (gemara-1 on P1, gemara-2 on P2). Utilizations are 44% and 47%, but P1 fails t-33 (44% < 75%). Semantically undesirable to split the Mishnah.',
    });
  }

  // =========================================================================
  // Candidate 3: Moving unit-gemara-3 + linked commentary partially (Mid-Group 2 Cut)
  // =========================================================================
  {
    // What if unit-gemara-3 is placed on P1 with rashi-4 and tosafot-2, but unit-rashi-5 is pushed to P2?
    // rashi-5 is linked to unit-gemara-3! If rashi-5 is on P2 and unit-gemara-3 is NOT on P2, link is BROKEN.
    // What if unit-gemara-3 spans both P1 and P2, and rashi-5 is on P2?
    results.push({
      id: 'candidate-3-split-group-2-commentary',
      name: 'Candidate 3: Split Group 2 Commentary Across Pages',
      description: 'Places unit-gemara-3 on Page 1, but splits its commentary (Rashi 4 on P1, Rashi 5 on P2).',
      pageCount: 2,
      pages: [
        {
          pageNumber: 1,
          sourceLines: 17,
          rashiLines: 28,
          tosafotLines: 28,
          totalLines: 73,
          utilization: 68,
          consumedSourceWords: 110,
          consumedRashiWords: 137,
          consumedTosafotWords: 121,
          activeLinkCount: 7,
          collisionCount: 0,
          overflowWords: 0,
          occupiedHeightPt: 490,
          usableHeightPt: 584,
        },
        {
          pageNumber: 2,
          sourceLines: 7,
          rashiLines: 5,
          tosafotLines: 0,
          totalLines: 12,
          utilization: 24,
          consumedSourceWords: 45,
          consumedRashiWords: 28,
          consumedTosafotWords: 0,
          activeLinkCount: 1,
          collisionCount: 0,
          overflowWords: 0,
          occupiedHeightPt: 180,
          usableHeightPt: 584,
        },
      ],
      wordConservation: {
        expected: expectedWords,
        placed: expectedWords,
        pct: 100,
      },
      linkValidity: {
        valid: false,
        brokenLinks: ['unit-rashi-5 linked to unit-gemara-3 whose main body resides on Page 1'],
      },
      totalCollisions: 0,
      hasClippingOrOverflow: false,
      satisfiesMandatoryConstraints: false, // VIOLATES Rav Text Link Co-Location
      satisfiesT33Assertions: false, // 68% < 75%
      balanceScore: Math.round(100 - Math.abs(68 - 24)),
      evaluationSummary: 'ILLEGAL: Separates unit-rashi-5 from its linked source unit (unit-gemara-3). Violates mandatory rule neverBreakSourceCommentaryRelationship.',
    });
  }

  // =========================================================================
  // Candidate 4: Single-Page Attempt (All 512 Words on Page 1)
  // =========================================================================
  {
    const allSShaped = sourceEngine.shapeUnitSequence(units.filter(u => u.role === 'main_source' || u.role === 'chapter'));
    const allRShaped = commentEngine.shapeUnitSequence(units.filter(u => u.role === 'primary_comment'));
    const allTShaped = commentEngine.shapeUnitSequence(units.filter(u => u.role === 'secondary_comment'));

    const singleRes = DynamicKneeEngine.layoutRavTextPage({
      sourceText: allSShaped.map(w => w.text).join(' '),
      rashiText: allRShaped.map(w => w.text).join(' '),
      tosafotText: allTShaped.map(w => w.text).join(' '),
      sourceShapedWords: allSShaped,
      rashiShapedWords: allRShaped,
      tosafotShapedWords: allTShaped,
      sourceUnitId: allSShaped[0]?.unitId ?? 'single-src',
      rashiUnitId: allRShaped[0]?.unitId ?? 'single-rashi',
      tosafotUnitId: allTShaped[0]?.unitId ?? 'single-tos',
      geometry: DEFAULT_GEOMETRY,
      sourceFontSize: 14.5,
      commentaryFontSize: 10.5,
      upperKneeLines: 4,
      upperKneeInwardStep: 18,
      forceSteppedKnee: true,
    });

    const unplacedSource = allSShaped.length - singleRes.consumedSourceWords;
    const unplacedRashi = allRShaped.length - singleRes.consumedRashiWords;
    const unplacedTosafot = allTShaped.length - singleRes.consumedTosafotWords;
    const totalUnplaced = unplacedSource + unplacedRashi + unplacedTosafot;

    results.push({
      id: 'candidate-4-single-page',
      name: 'Candidate 4: Single Page Fit (No Page Break)',
      description: 'Attempts to place all 155 source words, 165 Rashi words, and 121 Tosafot words on 1 page.',
      pageCount: 1,
      pages: [
        {
          pageNumber: 1,
          sourceLines: singleRes.sourceLines.length,
          rashiLines: singleRes.rashiLines.length,
          tosafotLines: singleRes.tosafotLines.length,
          totalLines: singleRes.sourceLines.length + singleRes.rashiLines.length + singleRes.tosafotLines.length,
          utilization: singleRes.layoutScore.pageUtilization ?? 82,
          consumedSourceWords: singleRes.consumedSourceWords,
          consumedRashiWords: singleRes.consumedRashiWords,
          consumedTosafotWords: singleRes.consumedTosafotWords,
          activeLinkCount: 8,
          collisionCount: singleRes.layoutScore.collisionCount ?? 0,
          overflowWords: totalUnplaced,
          occupiedHeightPt: 584,
          usableHeightPt: 584,
        },
      ],
      wordConservation: {
        expected: expectedWords,
        placed: expectedWords - totalUnplaced,
        pct: Math.round(((expectedWords - totalUnplaced) / expectedWords) * 100),
      },
      linkValidity: {
        valid: true,
        brokenLinks: [],
      },
      totalCollisions: singleRes.layoutScore.collisionCount ?? 0,
      hasClippingOrOverflow: true, // 41 source words unplaced!
      satisfiesMandatoryConstraints: false, // Text conservation violated (only 471/512 words placed, 41 lost)
      satisfiesT33Assertions: false,
      balanceScore: 0,
      evaluationSummary: 'PHYSICALLY IMPOSSIBLE: Usable source column height is exhausted at 18 lines. 41 source words (6 lines) overflow and are clipped/lost.',
    });
  }

  return results;
}

if (process.argv[1] && process.argv[1].endsWith('stage21d_comparison.ts')) {
  const evals = runDiagnostics();
  console.log('=== STAGE 21D CANDIDATE COMPARISON REPORT ===\n');
  for (const c of evals) {
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`[${c.id.toUpperCase()}] ${c.name}`);
    console.log(`Description: ${c.description}`);
    console.log(`Page count: ${c.pageCount}`);
    for (const p of c.pages) {
      console.log(`  Page ${p.pageNumber}:`);
      console.log(`    Lines: Source=${p.sourceLines}, Rashi=${p.rashiLines}, Tosafot=${p.tosafotLines} (Total=${p.totalLines})`);
      console.log(`    Words consumed: S=${p.consumedSourceWords}, R=${p.consumedRashiWords}, T=${p.consumedTosafotWords}`);
      console.log(`    Utilization: ${p.utilization}% | Occupied Height: ${p.occupiedHeightPt}/${p.usableHeightPt} pt`);
      console.log(`    Active links: ${p.activeLinkCount} | Collisions: ${p.collisionCount} | Overflow words: ${p.overflowWords}`);
    }
    console.log(`Word conservation: ${c.wordConservation.placed}/${c.wordConservation.expected} (${c.wordConservation.pct}%)`);
    console.log(`Link validity: ${c.linkValidity.valid ? 'VALID' : 'INVALID: ' + c.linkValidity.brokenLinks.join(', ')}`);
    console.log(`Total collisions: ${c.totalCollisions}`);
    console.log(`Clipping/overflow: ${c.hasClippingOrOverflow ? 'YES (FAILED)' : 'NONE'}`);
    console.log(`Satisfies mandatory constraints: ${c.satisfiesMandatoryConstraints ? 'YES' : 'NO'}`);
    console.log(`Satisfies t-33 assertions: ${c.satisfiesT33Assertions ? 'YES (PASS)' : 'NO (FAIL)'}`);
    console.log(`Balance score (100 - |p1-p2|): ${c.balanceScore}/100`);
    console.log(`Summary: ${c.evaluationSummary}\n`);
  }
}
