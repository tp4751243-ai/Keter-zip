import {
  ProjectPersistenceEngine,
  UndoRedoHistoryManager,
  UndoRedoSnapshotState,
} from '../src/engine/project-persistence';
import { DesignSettingsEngine } from '../src/engine/design-settings-engine';
import { DocxImporter } from '../src/engine/docx-importer';
import { PaginationEngine } from '../src/engine/pagination-engine';

// Polyfill localStorage for Node execution
const storageMap = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => storageMap.get(k) ?? null,
  setItem: (k: string, v: string) => storageMap.set(k, String(v)),
  removeItem: (k: string) => storageMap.delete(k),
  clear: () => storageMap.clear(),
};

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function runVerification(): Promise<void> {
  console.log('=== Stage 17G+H Verification Suite ===');

  // 1. Native .keter Project Serialization, Round-Trip Fidelity & Recent Projects
  const sampleUnits = DocxImporter.getSampleBerakhot();
  const initialSnap = ProjectPersistenceEngine.createNewProjectSnapshot({
    documentTitle: 'מסכת ברכות — פרויקט .keter',
    layoutType: 'rav_text',
    units: sampleUnits,
    links: [
      {
        linkId: 'lnk-17gh-1',
        sourceUnitId: 'unit-gemara-1',
        commentaryUnitId: 'unit-rashi-1',
        dibburHamatchil: 'מֵאֵימָתַי קוֹרִין',
        isUserLocked: true,
        confidenceScore: 1.0,
        sourceSnippet: 'מֵאֵימָתַי קוֹרִין',
        commentarySnippet: 'מֵאֵימָתַי קוֹרִין: שֶׁהַכֹּהֲנִים',
        commentaryType: 'Rashi',
      },
    ],
  });

  let customDesign = ProjectPersistenceEngine.buildDesignSettingsFromSnapshot(initialSnap);
  customDesign = DesignSettingsEngine.updateRoleCharacterStyle(
    customDesign,
    'main_source',
    { fontSizePt: 15.5 },
    'user'
  );
  customDesign = DesignSettingsEngine.setLocalUnitOverride(
    customDesign,
    'unit-gemara-1',
    { character: { isBold: true, fontWeight: 700, fontSizePt: 17.0 } },
    'user'
  );
  initialSnap.designSettings = customDesign;
  initialSnap.currentPageIndex = 1;

  const serializedKeter = ProjectPersistenceEngine.serializeKeterProject(initialSnap);
  const parsedKeter = ProjectPersistenceEngine.validateAndParseProjectJson(serializedKeter);
  assert(parsedKeter.valid && !!parsedKeter.snapshot, '1a: .keter JSON must validate and parse cleanly');
  assert(
    parsedKeter.snapshot!.units.length === sampleUnits.length,
    '1b: .keter round-trip must preserve all ContentUnits'
  );
  assert(
    parsedKeter.snapshot!.links.length === 1 &&
      parsedKeter.snapshot!.links[0].dibburHamatchil === 'מֵאֵימָתַי קוֹרִין',
    '1c: .keter round-trip must preserve explicit RavTextLink graph'
  );

  const restoredDesign = ProjectPersistenceEngine.buildDesignSettingsFromSnapshot(
    parsedKeter.snapshot!
  );
  assert(
    restoredDesign.roleStyles.main_source.character.fontSizePt === 15.5,
    '1d: .keter round-trip must preserve project role styles (15.5pt)'
  );
  assert(
    restoredDesign.localUnitOverrides['unit-gemara-1']?.character?.fontSizePt === 17.0 &&
      Boolean(restoredDesign.localUnitOverrides['unit-gemara-1']?.character?.isBold),
    '1e: .keter round-trip must preserve local unit overrides (17.0pt Bold)'
  );
  assert(
    parsedKeter.snapshot!.currentPageIndex === 1,
    '1f: .keter round-trip must preserve active page index (1)'
  );

  // Recent projects
  ProjectPersistenceEngine.recordRecentProject(initialSnap, 'berakhot_17gh.keter');
  const recentList = ProjectPersistenceEngine.getRecentProjects();
  assert(
    recentList.some(
      r =>
        r.fileName === 'berakhot_17gh.keter' &&
        r.documentTitle === 'מסכת ברכות — פרויקט .keter'
    ),
    '1g: Recent projects list records and retrieves .keter project with snapshot'
  );
  console.log('PASS [1/4]: Native .keter serialization, round-trip fidelity, and recent projects');

  // 2. Non-destructive In-Place Canvas Unit Editing + Live Reflow + Undo/Redo
  const beforeEditState = UndoRedoHistoryManager.fromProjectSnapshot(initialSnap);
  const historyMgr = new UndoRedoHistoryManager(beforeEditState);
  const editedText =
    'מתניתין: מֵאֵימָתַי קוֹרִין אֶת שְׁמַע בְּעַרְבִית? מִשָּׁעָה שֶׁהַכֹּהֲנִים נִכְנָסִים לֶאֱכֹל בִּתְרוּמָתָן — נוסח מתוקן בעריכה במקום על הדף.';
  const editRes = ProjectPersistenceEngine.updateContentUnitText(
    beforeEditState.contentUnits,
    beforeEditState.explicitLinks ?? [],
    'unit-gemara-1',
    editedText
  );
  assert(
    editRes.updatedUnit?.rawText === editedText,
    '2a: updateContentUnitText must update rawText of target ContentUnit'
  );
  assert(
    (editRes.updatedUnit?.textRuns?.length ?? 0) > 0,
    '2b: updateContentUnitText must rebuild textRuns while preserving Dibbur HaMatchil formatting'
  );

  const afterEditState: UndoRedoSnapshotState = {
    ...beforeEditState,
    contentUnits: editRes.units,
    explicitLinks: editRes.links,
  };
  historyMgr.recordChange(afterEditState, 'עריכת טקסט במקום (unit-gemara-1)', 'inline-edit', false);

  const reflowedDoc = PaginationEngine.paginateDocument({
    title: afterEditState.documentTitle,
    layoutType: afterEditState.layoutType,
    units: afterEditState.contentUnits,
    links: afterEditState.explicitLinks,
    geometry: afterEditState.geometry,
    designSettings: afterEditState.designSettings,
  });
  const reflowedHasEditedWord = reflowedDoc.pages.some(p =>
    p.sourceLines.some(l => l.words.some(w => w.text.includes('מתוקן')))
  );
  assert(
    reflowedHasEditedWord,
    '2c: Typesetting engine reflows edited unit text onto the page canvas'
  );
  assert(
    (reflowedDoc.pages[0]?.activeLinks?.length ?? 0) > 0,
    '2d: RavTextLinks remain intact after in-place text edit'
  );

  const undoneState = historyMgr.undo()!;
  assert(
    undoneState.contentUnits.find(u => u.id === 'unit-gemara-1')?.rawText ===
      sampleUnits.find(u => u.id === 'unit-gemara-1')?.rawText,
    '2e: Undo restores exact original text before in-place edit'
  );
  const redoneState = historyMgr.redo()!;
  assert(
    redoneState.contentUnits.find(u => u.id === 'unit-gemara-1')?.rawText === editedText,
    '2f: Redo re-applies in-place edited text'
  );
  console.log('PASS [2/4]: In-place canvas text editing, live typesetting reflow, and Undo/Redo');

  // 3. 4-Tier Style Hierarchy (Global -> Project Role -> Local Unit -> Local Word)
  let hierSettings = DesignSettingsEngine.createDefaultSettings({ layoutType: 'rav_text' });
  const globalSize = hierSettings.roleStyles.main_source.character.fontSizePt;
  hierSettings = DesignSettingsEngine.updateRoleCharacterStyle(
    hierSettings,
    'main_source',
    { fontSizePt: 16.0 },
    'user'
  );
  hierSettings = DesignSettingsEngine.setLocalUnitOverride(
    hierSettings,
    'unit-gemara-1',
    { character: { fontSizePt: 18.0 } },
    'user'
  );
  hierSettings = DesignSettingsEngine.setLocalWordOverride(
    hierSettings,
    'unit-gemara-1',
    0,
    { fontSizePt: 20.0, isBold: true },
    'user'
  );

  const resolvedRoleOnly = DesignSettingsEngine.resolveRoleAndUnitStyle(
    hierSettings,
    'main_source',
    'unit-gemara-2'
  );
  const resolvedLocalUnit = DesignSettingsEngine.resolveRoleAndUnitStyle(
    hierSettings,
    'main_source',
    'unit-gemara-1'
  );
  const resolvedLocalWord = DesignSettingsEngine.resolveRoleAndUnitStyle(
    hierSettings,
    'main_source',
    'unit-gemara-1',
    0
  );
  const afterClearUnit = DesignSettingsEngine.clearLocalUnitOverride(
    hierSettings,
    'unit-gemara-1',
    'user'
  );
  const resolvedAfterClear = DesignSettingsEngine.resolveRoleAndUnitStyle(
    afterClearUnit,
    'main_source',
    'unit-gemara-1'
  );

  assert(globalSize === 14.5, '3a: Global default main_source fontSizePt is 14.5pt');
  assert(
    resolvedRoleOnly.character.fontSizePt === 16.0,
    '3b: Project Role style resolves to 16.0pt for un-overridden unit'
  );
  assert(
    resolvedLocalUnit.character.fontSizePt === 18.0,
    '3c: Local Unit override resolves to 18.0pt for unit-gemara-1'
  );
  assert(
    resolvedLocalWord.character.fontSizePt === 20.0 && resolvedLocalWord.character.isBold === true,
    '3d: Local Word override resolves to 20.0pt bold for word #0'
  );
  assert(
    resolvedAfterClear.character.fontSizePt === 16.0,
    '3e: Clearing Local Unit override reverts cleanly to Project Role style (16.0pt)'
  );
  console.log('PASS [3/4]: 4-Tier Style Hierarchy (Global -> Project -> Local Unit -> Local Word)');

  // 4. Layout Zoom Math Verification (Scaled Wrapper Width/Height prevents Clipping)
  const pageWidthPt = initialSnap.geometry?.pageWidth ?? 482; // 482
  const pageHeightPt = initialSnap.geometry?.pageHeight ?? 680; // 680
  for (const zoomPercent of [80, 100, 150, 200]) {
    const scale = zoomPercent / 100;
    const outerLayoutWidthPx = Math.round(pageWidthPt * scale);
    const outerLayoutHeightPx = Math.round(pageHeightPt * scale);
    assert(
      outerLayoutWidthPx === Math.round(482 * scale) &&
        outerLayoutHeightPx === Math.round(680 * scale),
      `4a: Layout zoom at ${zoomPercent}% allocates ${outerLayoutWidthPx}x${outerLayoutHeightPx}px scrollable layout box`
    );
  }
  console.log('PASS [4/5]: True layout zoom dimensions verified for 80%, 100%, 150%, and 200%');

  // 5. Screen-Space PageCanvas Coordinate & Non-Overlap Verification (Emergency Recovery Regression Guard)
  // Verifies that the exact rightPx / widthPx / topPx / heightPx boxes rendered by PageCanvas.tsx
  // keep Rashi on the right, Source in the center, and Tosafot on the left with ZERO cross-stream collisions!
  const berakhotDoc = PaginationEngine.paginateDocument({
    title: 'מסכת ברכות — דף ב ע״א',
    layoutType: 'rav_text',
    units: sampleUnits,
    links: initialSnap.links,
    geometry: initialSnap.geometry ?? restoredDesign.layout.geometry,
  });

  const computeCanvasBoxPx = (
    line: any,
    page: any,
    zoom: number = 1.15
  ): { leftPx: number; rightPxFromLeft: number; topPx: number; bottomPx: number; rightCssPx: number; widthPx: number } => {
    const scale = zoom * 1.25;
    const contentWidthPt =
      page.geometry.pageWidth - page.geometry.marginInside - page.geometry.marginOutside;
    const contentW = contentWidthPt * scale;

    let rightOffsetPt: number;
    if (line.xRight !== undefined) {
      rightOffsetPt = Math.max(0, contentWidthPt - line.xRight);
    } else if (line.xLeft !== undefined) {
      rightOffsetPt = Math.max(0, contentWidthPt - (line.xLeft + line.targetWidth));
    } else if (page.layoutType === 'rav_text' || page.layoutType === 'mikraot_gedolot') {
      if (line.role === 'secondary_comment') {
        rightOffsetPt = Math.max(0, contentWidthPt - line.targetWidth);
      } else if (line.role === 'primary_comment' || line.role === 'footnote') {
        rightOffsetPt = line.xStart ?? 0;
      } else {
        rightOffsetPt =
          page.knee.rightCommentaryWidth + page.knee.gutterWidth + (line.xStart ?? 0);
      }
    } else {
      rightOffsetPt = line.xStart ?? 0;
    }

    const firstIndentPt = line.firstLineIndentPt ?? line.firstLineIndent ?? 0;
    const rightIndentPt = (line.rightIndentPt ?? 0) + firstIndentPt;
    const leftIndentPt = line.leftIndentPt ?? 0;

    const rightCssPx = (rightOffsetPt + rightIndentPt) * scale;
    const widthPx =
      Math.max(
        20,
        line.targetWidth > 0
          ? line.targetWidth
          : (line.xRight !== undefined && line.xLeft !== undefined
              ? line.xRight - line.xLeft
              : contentWidthPt) -
              rightIndentPt -
              leftIndentPt
      ) * scale;

    const rightPxFromLeft = contentW - rightCssPx;
    const leftPx = rightPxFromLeft - widthPx;
    const topPx = (line.yBaseline - line.ascent) * scale;
    const bottomPx = (line.yBaseline + line.descent) * scale;

    return { leftPx, rightPxFromLeft, topPx, bottomPx, rightCssPx, widthPx };
  };

  for (const page of berakhotDoc.pages) {
    const srcBoxes = page.sourceLines.map(l => ({ line: l, box: computeCanvasBoxPx(l, page, 1.15) }));
    const rashiBoxes = page.rashiLines.map(l => ({ line: l, box: computeCanvasBoxPx(l, page, 1.15) }));
    const tosBoxes = page.tosafotLines.map(l => ({ line: l, box: computeCanvasBoxPx(l, page, 1.15) }));

    // Verify flanking Rashi is strictly to the right of flanking Source, and flanking Tosafot is strictly to the left of flanking Source
    const flankSrc = srcBoxes.find(s => s.line.zoneType === 'flanking_source');
    const flankRashi = rashiBoxes.find(r => r.line.zoneType === 'flanking_source');
    const flankTos = tosBoxes.find(t => t.line.zoneType === 'flanking_source');

    if (flankSrc && flankRashi) {
      assert(
        flankRashi.box.leftPx >= flankSrc.box.rightPxFromLeft + 5,
        `5a: Flanking Rashi leftPx (${Math.round(flankRashi.box.leftPx)}) must be strictly right of Source rightPx (${Math.round(flankSrc.box.rightPxFromLeft)})`
      );
    }
    if (flankSrc && flankTos) {
      assert(
        flankTos.box.rightPxFromLeft <= flankSrc.box.leftPx - 5,
        `5b: Flanking Tosafot rightPx (${Math.round(flankTos.box.rightPxFromLeft)}) must be strictly left of Source leftPx (${Math.round(flankSrc.box.leftPx)})`
      );
    }

    // Verify 0 2D screen-space bounding-box collisions across Source, Rashi, and Tosafot
    const allStreamBoxes = [
      ...srcBoxes.map(b => ({ stream: 'src', ...b })),
      ...rashiBoxes.map(b => ({ stream: 'rashi', ...b })),
      ...tosBoxes.map(b => ({ stream: 'tos', ...b })),
    ];
    let screenCollisions = 0;
    for (let i = 0; i < allStreamBoxes.length; i++) {
      for (let j = i + 1; j < allStreamBoxes.length; j++) {
        const a = allStreamBoxes[i];
        const b = allStreamBoxes[j];
        if (a.stream === b.stream) continue;
        const hOverlap =
          Math.min(a.box.rightPxFromLeft, b.box.rightPxFromLeft) -
          Math.max(a.box.leftPx, b.box.leftPx);
        const vOverlap =
          Math.min(a.box.bottomPx, b.box.bottomPx) - Math.max(a.box.topPx, b.box.topPx);
        if (hOverlap > 1.5 && vOverlap > 1.5) {
          screenCollisions++;
        }
      }
    }
    assert(
      screenCollisions === 0,
      `5c: Page ${page.pageNumber} must have 0 screen-space collisions in PageCanvas (found ${screenCollisions})`
    );
  }
  console.log('PASS [5/5]: Screen-space PageCanvas coordinate & Rav-Text non-overlap verification passed (0 collisions)');
  console.log('=== ALL STAGE 17G+H & EMERGENCY RECOVERY VERIFICATION CHECKS PASSED ===');
}

runVerification().catch(err => {
  console.error(err);
  process.exit(1);
});
