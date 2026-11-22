
import { PaginationEngine } from '../src/engine/pagination-engine';
import { DocxImporter } from '../src/engine/docx-importer';
import { PageGeometry } from '../src/types/typesetter';

const geometry: PageGeometry = {
  pageWidth: 482.0,
  pageHeight: 680.0,
  marginTop: 48.0,
  marginBottom: 48.0,
  marginInside: 46.0,
  marginOutside: 42.0,
  isVerso: false,
};

const units = DocxImporter.getSampleBerakhot();

console.log('--- Diagnostic: t-33 Pagination Look-Ahead ---');
// I cannot directly access the private totalPages calculation inside paginateRavText
// but I can call paginateDocument and inspect the result pages.

const doc = PaginationEngine.paginateDocument({
    title: 'Test t-33',
    layoutType: 'rav_text',
    units: units,
    geometry: geometry,
});

console.log(`Total Pages: ${doc.totalPages}`);
doc.pages.forEach((p, i) => {
    const utilization = p.layoutScore?.pageUtilization ?? 0;
    console.log(`Page ${i + 1} Utilization: ${utilization}%`);
    console.log(`  Source Lines: ${p.sourceLines.length}`);
    console.log(`  Rashi Lines: ${p.rashiLines.length}`);
    console.log(`  Tosafot Lines: ${p.tosafotLines.length}`);
});
console.log('--- Pagination Stats ---');
// I need to be able to access the pagination variables to log them, 
// but they are local to paginateRavText. I'll have to infer them.
