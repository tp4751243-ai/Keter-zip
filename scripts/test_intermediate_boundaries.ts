import { DocxImporter } from '../src/engine/docx-importer';
import { PaginationEngine } from '../src/engine/pagination-engine';
import { DesignSettingsEngine } from '../src/engine/design-settings-engine';
import { PageGeometry } from '../src/types/typesetter';

const geom: PageGeometry = {
  pageWidth: 482.0,
  pageHeight: 680.0,
  marginTop: 48.0,
  marginBottom: 48.0,
  marginInside: 46.0,
  marginOutside: 42.0,
  isVerso: false,
};

const units = DocxImporter.getSampleBerakhot();
const design = DesignSettingsEngine.createDefaultSettings({ layoutType: 'rav_text' });

const { groups, sourceShapedAll, rashiShapedAll, tosafotShapedAll, allLinks } = (PaginationEngine as any).buildLinkedRavGroups(
  units,
  undefined,
  14.5,
  10.5,
  design,
  undefined
);

console.log('--- EXAMINING INTERMEDIATE BOUNDARIES ---');
groups.forEach((g: any, gIdx: number) => {
  console.log(`\nGroup ${gIdx + 1} (${g.groupId}):`);
  console.log(`  Source units:`, g.sourceUnits.map((u: any) => u.id));
  console.log(`  Rashi units:`, g.rashiUnits.map((u: any) => u.id));
  console.log(`  Tosafot units:`, g.tosafotUnits.map((u: any) => u.id));
});

