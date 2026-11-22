
import { PaginationEngine } from './src/engine/pagination-engine';
import { DocxImporter } from './src/engine/docx-importer';

const DEFAULT_GEOMETRY = {
  pageWidth: 482.0,
  pageHeight: 680.0,
  marginTop: 48.0,
  marginBottom: 48.0,
  marginInside: 48.0,
  marginOutside: 48.0,
  isVerso: false,
};

async function diagnose() {
  const units = DocxImporter.getSampleBerakhot();
  console.log(`Units count: ${units.length}`);
  
  const ravTextDoc = PaginationEngine.paginateDocument({
    title: 'Berakhot Diagnostic',
    layoutType: 'rav_text',
    units: units,
    geometry: DEFAULT_GEOMETRY,
  });

  console.log('--- Page 1 Layout Diagnostic ---');
  const p1 = ravTextDoc.pages[0];
  console.log(`Source Lines Count: ${p1.sourceLines.length}`);
  console.log(`Rashi Lines Count: ${p1.rashiLines.length}`);
  console.log(`Tosafot Lines Count: ${p1.tosafotLines.length}`);
  
  if (ravTextDoc.pages.length > 1) {
    console.log('--- Page 2 Layout Diagnostic ---');
    const p2 = ravTextDoc.pages[1];
    console.log(`Source Lines Count: ${p2.sourceLines.length}`);
    console.log(`Rashi Lines Count: ${p2.rashiLines.length}`);
    console.log(`Tosafot Lines Count: ${p2.tosafotLines.length}`);
  }
}
diagnose();
