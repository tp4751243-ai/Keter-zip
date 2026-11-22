import { DocxImporter } from '../src/engine/docx-importer';
import { DynamicKneeEngine } from '../src/engine/dynamic-knee';
import { PaginationEngine } from '../src/engine/pagination-engine';
import { TypesetterEngine } from '../src/engine/typesetter-core';
import { PageGeometry, ContentUnit, ShapedWord, TypesetLine } from '../src/types/typesetter';
import { DesignSettingsEngine } from '../src/engine/design-settings-engine';

const geom: PageGeometry = {
  pageWidth: 482.0,
  pageHeight: 680.0,
  marginTop: 48.0,
  marginBottom: 48.0,
  marginInside: 46.0,
  marginOutside: 42.0,
  isVerso: false,
};

const contentWidth = geom.pageWidth - geom.marginInside - geom.marginOutside; // 394
const contentHeight = geom.pageHeight - geom.marginTop - geom.marginBottom; // 584

async function main() {
  console.log('=== STAGE 21Q: CANDIDATE SEARCH & VERIFICATION ===\n');
  const units = DocxImporter.getSampleBerakhot();
  const design = DesignSettingsEngine.createDefaultSettings({ layoutType: 'rav_text' });

  // 1. Run Baseline
  const prodDoc = PaginationEngine.paginateDocument({
    title: 'Baseline',
    layoutType: 'rav_text',
    units,
    geometry: geom,
    designSettings: design,
  });

  console.log('--- BASELINE PRODUCTION DOCUMENT ---');
  console.log(`Total Pages: ${prodDoc.totalPages}`);
  prodDoc.pages.forEach((p, idx) => {
    const sWords = p.sourceLines.reduce((acc, l) => acc + l.words.filter(w => !w.isSpace).length, 0);
    const rWords = p.rashiLines.reduce((acc, l) => acc + l.words.filter(w => !w.isSpace).length, 0);
    const tWords = p.tosafotLines.reduce((acc, l) => acc + l.words.filter(w => !w.isSpace).length, 0);
    const fnLines = (p as any).footnoteLines || [];
    const fnWords = fnLines.reduce((acc: number, l: TypesetLine) => acc + l.words.filter(w => !w.isSpace).length, 0);
    
    const maxY = Math.max(
      0,
      ...p.sourceLines.map(l => l.yBottom ?? l.yBaseline + l.descent),
      ...p.rashiLines.map(l => l.yBottom ?? l.yBaseline + l.descent),
      ...p.tosafotLines.map(l => l.yBottom ?? l.yBaseline + l.descent)
    );

    console.log(`Page ${idx + 1}:`);
    console.log(`  Source: ${p.sourceLines.length} lines, ${sWords} words`);
    console.log(`  Rashi:  ${p.rashiLines.length} lines, ${rWords} words`);
    console.log(`  Tosafot:${p.tosafotLines.length} lines, ${tWords} words`);
    console.log(`  Footnote:${fnLines.length} lines, ${fnWords} words`);
    console.log(`  Max Content Y: ${maxY.toFixed(2)} pt / ${contentHeight} pt`);
    console.log(`  Free space below content: ${(contentHeight - maxY).toFixed(2)} pt`);
    console.log(`  Utilization: ${p.layoutScore?.pageUtilization}%`);
    console.log(`  Collisions: ${p.layoutScore?.collisionCount}`);
    console.log(`  Active Links: ${p.activeLinks?.length}`);
  });

  // Calculate exact occupiedArea and utilization formula inputs for Baseline
  console.log('\n--- BASELINE UTILIZATION FORMULA INPUTS ---');
  prodDoc.pages.forEach((p, idx) => {
    const sArea = p.sourceLines.reduce((acc, l) => acc + l.targetWidth * l.height, 0);
    const rArea = p.rashiLines.reduce((acc, l) => acc + l.targetWidth * l.height, 0);
    const tArea = p.tosafotLines.reduce((acc, l) => acc + l.targetWidth * l.height, 0);
    const totArea = sArea + rArea + tArea;
    const pageArea = contentWidth * contentHeight;
    const calcPct = Math.round((totArea / pageArea) * 100);
    console.log(`Page ${idx + 1}: sArea=${sArea.toFixed(1)}, rArea=${rArea.toFixed(1)}, tArea=${tArea.toFixed(1)} -> total=${totArea.toFixed(1)} / ${pageArea} = ${calcPct}% (reported: ${p.layoutScore?.pageUtilization}%)`);
  });
}

main().catch(console.error);
