import { DocxImporter } from '../src/engine/docx-importer';
import { PaginationEngine } from '../src/engine/pagination-engine';
import { PageGeometry } from '../src/types/typesetter';

const DEFAULT_GEOMETRY: PageGeometry = {
  pageWidth: 482.0,
  pageHeight: 680.0,
  marginTop: 48.0,
  marginBottom: 48.0,
  marginInside: 46.0,
  marginOutside: 42.0,
  isVerso: false,
};

async function debugT47() {
  const crossPageUnits = [
    {
      id: 's4-cp-src',
      role: 'main_source' as const,
      styleName: 'Gemara-Source',
      order: 1,
      hierarchyLevel: 2,
      rawText: Array(14)
        .fill(
          'מֵאֵימָתַי קוֹרִין אֶת שְׁמַע בְּעַרְבִית? מִשָּׁעָה שֶׁהַכֹּהֲנִים נִכְנָסִים לֶאֱכֹל בִּתְרוּמָתָן עַד סוֹף הָאַשְׁמוּרָה הָרִאשׁוֹנָה דִּבְרֵי רַבִּי אֱלִיעֶזֶר וַחֲכָמִים אוֹמְרִים עַד חֲצוֹת וְרַבָּן גַּמְלִיאֵל אוֹמֵר עַד שֶׁיַּעֲלֶה עַמּוּד הַשַּׁחַר.'
        )
        .join(' '),
    },
    ...Array.from({ length: 12 }, (_, idx) => ({
      id: `s4-cp-rashi-${idx + 1}`,
      role: 'primary_comment' as const,
      styleName: 'Rashi-Script',
      order: 2 + idx,
      hierarchyLevel: 3,
      linkedSourceId: 's4-cp-src',
      dibburHamatchil: `דִּבּוּר הַמַּתְחִיל הַמְּרֻבֶּה בְּפֵרוּשׁ רַשִׁ״י אוֹת ${idx + 1}`,
      rawText: `דִּבּוּר הַמַּתְחִיל הַמְּרֻבֶּה בְּפֵרוּשׁ רַשִׁ״י אוֹת ${idx + 1}: פֵּרוּשׁ אָרֹךְ וּמְفֹרָט עַל דִּבְרֵי הַמִּשְׁנָה וְהַגְּמָרָא בְּמַסֶּכֶת בְּרָכוֹת בְּעִנְיַן זְמַן קְרִיאַת שְׁמַע שֶׁל עַרְבִית בְּצֵאת הַכּוֹכָבִים וְשִׁעוּר אֲכִילַת תְּרוּמָה לַכֹּהֲנִים הַטְּהוֹרִים.`,
    })),
    {
      id: 's4-cp-tos-1',
      role: 'secondary_comment' as const,
      styleName: 'Tosafot-Square',
      order: 20,
      hierarchyLevel: 3,
      linkedSourceId: 's4-cp-src',
      dibburHamatchil: 'מֵאֵימָתַי קוֹרִין אֶת שְׁמַע',
      rawText: Array(8)
        .fill(
          'מֵאֵימָתַי קוֹרִין אֶת שְׁמַע: פֵּרֵשׁ רַבֵּנוּ תָּם דְּהַאי צֵאת הַכּוֹכָבִים דְּמַתְנִיתִין הַיְנוּ שְׁלֹשָׁה כּוֹכָבִים בֵּינוֹנִיִּים שֶׁנִּרְאִים בָּרָקִיעַ לְאַחַר הִילּוּךְ אַרְבָּעָה מִילִין.'
        )
        .join(' '),
    },
  ];

  const crossPageDoc = PaginationEngine.paginateDocument({
    title: 'Stage 4 — Cross-Page Continuation & Dibbur Keep-Together',
    layoutType: 'rav_text',
    units: crossPageUnits,
    geometry: DEFAULT_GEOMETRY,
  });

  const p1 = crossPageDoc.pages[0];
  const p1UnitIds = new Set<string>();
  [...p1.sourceLines, ...p1.rashiLines, ...p1.tosafotLines].forEach(l => {
    if (l.unitId) p1UnitIds.add(l.unitId);
    l.words?.forEach(w => { if (w.unitId) p1UnitIds.add(w.unitId); });
  });

  console.log('Page 1 active links:');
  p1.activeLinks?.forEach(lnk => {
    const hasSrc = p1UnitIds.has(lnk.sourceUnitId);
    const hasComm = p1UnitIds.has(lnk.commentaryUnitId);
    console.log(`  Link ${lnk.linkId}: src=${lnk.sourceUnitId} (in p1: ${hasSrc}), comm=${lnk.commentaryUnitId} (in p1: ${hasComm})`);
  });
}

debugT47().catch(console.error);
