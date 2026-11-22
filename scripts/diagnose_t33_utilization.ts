import { PaginationEngine } from '../src/engine/pagination-engine';
import { DocxImporter } from '../src/engine/docx-importer';
import { SpatialExclusionEngine } from '../src/engine/spatial-exclusion';
import { ContentUnit } from '../src/types/typesetter';

const units = DocxImporter.getSampleBerakhot();
const geometry = {
  pageWidth: 482.0,
  pageHeight: 680.0,
  marginTop: 48.0,
  marginBottom: 48.0,
  marginInside: 46.0,
  marginOutside: 42.0,
  isVerso: false,
};

const ravTextDoc = PaginationEngine.paginateDocument({
    title: 'Test',
    layoutType: 'rav_text',
    units: units,
    geometry: geometry,
});


console.log(`Total Pages: ${ravTextDoc.totalPages}`);

ravTextDoc.pages.forEach((p, index) => {
    const utilization = p.layoutScore?.pageUtilization ?? 0;
    const sourceArea = p.sourceLines.reduce((acc, l) => acc + l.targetWidth * l.height, 0);
    const rashiArea = p.rashiLines.reduce((acc, l) => acc + l.targetWidth * l.height, 0);
    const tosafotArea = p.tosafotLines.reduce((acc, l) => acc + l.targetWidth * l.height, 0);
    const totalOccupied = sourceArea + rashiArea + tosafotArea;

    console.log(`Page ${index + 1}:`);
    console.log(`  Utilization: ${utilization}%`);
    console.log(`  Occupied Area: ${Math.round(totalOccupied)}`);
    console.log(`  Source Lines: ${p.sourceLines.length}`);
    console.log(`  Rashi Lines: ${p.rashiLines.length}`);
    console.log(`  Tosafot Lines: ${p.tosafotLines.length}`);
    
    // Check if the page has hard rule violations
    if (p.layoutScore?.disqualifiedByEngineHardRule) {
        console.log(`  !!! Hard Rule Violation !!!`);
    }
});
