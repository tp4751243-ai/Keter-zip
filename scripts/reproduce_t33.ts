import { PaginationEngine } from '../src/engine/pagination-engine';
import { DocxImporter } from '../src/engine/docx-importer';
import { PageGeometry } from '../src/types/typesetter';
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

const units = DocxImporter.getSampleBerakhot();
console.log("Units length:", units.length);

const ravTextDoc = PaginationEngine.paginateDocument({
    title: 'מסכת ברכות — ש״ס וילנא',
    layoutType: 'rav_text',
    units: units,
    geometry: DEFAULT_GEOMETRY,
});

console.log("Total Pages:", ravTextDoc.pages.length);
let totalCollisions = 0;
ravTextDoc.pages.forEach((p, index) => {
    const collisions = p.layoutScore?.collisionCount ?? 0;
    totalCollisions += collisions;
    console.log(`Page ${index + 1}: Collisions: ${collisions}, Score: ${JSON.stringify(p.layoutScore)}`);
});
console.log("Total Collisions:", totalCollisions);
