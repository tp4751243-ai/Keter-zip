/**
 * Keter Adobe InDesign IDML Exporter (Rebuilt on Authentic Adobe InDesign CS6/CC DOMVersion="8.0" Architecture)
 *
 * Strategy:
 * 1. Built from a real Adobe InDesign-exported IDML package (`ADOBE_IDML_REFERENCE_FILES`)
 *    preserving 100% of Adobe's required processing instructions (`<?aid style="50" ...?>`),
 *    namespace (`http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging`), Language tables,
 *    RootObjectStyleGroup (`ObjectStyle/$ID/[Normal Text Frame]`), Swatches/Colors/Inks/StrokeStyles,
 *    Preferences, `XML/Tags.xml`, `XML/BackingStory.xml`, `MasterSpreads/MasterSpread_ucd.xml`,
 *    and `Section` definitions.
 * 2. Custom UCF/ZIP Binary Packager (`packUcfIdmlZip`):
 *    - Places `mimetype` (`application/vnd.adobe.indesign-idml-package`, 43 bytes) as the very first
 *      entry at byte offset 0, uncompressed (`STORE`, method 0), `versionNeeded=20`, `flags=0x0800`,
 *      `extraFieldLength=0`, no trailing newline.
 *    - Writes `designmap.xml` second, followed by `META-INF/container.xml`, `META-INF/metadata.xml`,
 *      `Resources/*`, `XML/Tags.xml`, `MasterSpreads/*`, `Spreads/*`, `XML/BackingStory.xml`, and `Stories/*`.
 *    - Emits zero directory entries (`META-INF/`, `Resources/`, etc. are never added as separate 0-byte entries)
 *      and uses `versionNeeded=20`, `flags=0x0802` (UTF-8 + DEFLATE) for all XML files, matching
 *      Adobe InDesign's native C++ UCF packager byte-for-byte.
 * 3. Supports incremental progression from TEST A (minimal 1-page, 1-frame `מסכת ברכות`) through TEST E
 *    (full multi-page Rav-Text & footnotes) with `<PathGeometry>` + `<ItemTransform>` and `<XMLElement>`
 *    story wrappers.
 */

import JSZip from 'jszip';
import {
  BookTypesetDocument,
  ContentRole,
  PageGeometry,
  PageTypesetResult,
  TypesetLine,
} from '../types/typesetter';
import { ADOBE_IDML_REFERENCE_FILES } from './idml-reference-template';
import { EngineHardRulesEngine } from './engine-hard-rules';
// v0.5.0 (Title Page / Shaar Blat builder): the shared field layout, so
// the IDML title story places the same text at the same heights as the
// preview and the PDF.
import { layoutTitlePageFields, titlePageBorderImageRect } from './title-page-borders';

export type IdmlIncrementalStage =
  | 'test_a_minimal'
  | 'test_b_styled_lines'
  | 'test_c_rav_text'
  | 'test_d_multi_page'
  | 'test_e_full'
  | 'test_f_true_rav_text_flow';

export interface IdmlPolygonBand {
  yTop: number;
  yBottom: number;
  xLeft: number;
  xRight: number;
}

export interface IdmlZipBinaryAudit {
  isFirstEntryMimetype: boolean;
  firstEntryCompressionMethod: number;
  firstEntryVersionNeeded: number;
  firstEntryFlags: number;
  firstEntryExtraFieldLength: number;
  firstEntryCompressedSize: number;
  firstEntryUncompressedSize: number;
  firstEntryDataExact: boolean;
  hasZeroDirectoryEntries: boolean;
  entryNames: string[];
}

export interface IdmlPackageAuditResult {
  passed: boolean;
  hasValidMimetype: boolean;
  hasContainerXml: boolean;
  hasDesignmapXml: boolean;
  hasResources: boolean;
  hasCorrectAdobeNamespace: boolean;
  hasAidProcessingInstruction: boolean;
  hasLayerInDesignmap: boolean;
  hasSectionInDesignmap: boolean;
  hasMasterSpread: boolean;
  hasBackingStory: boolean;
  hasTagsXml: boolean;
  hasPathGeometryInFrames: boolean;
  hasSourceTextWrapExclusion: boolean;
  hasUnifiedStreamFrames: boolean;
  zipBinaryAudit: IdmlZipBinaryAudit;
  totalSpreads: number;
  totalStories: number;
  totalTextFrames: number;
  brokenStoryReferences: string[];
  overlappingTextFrames: string[];
  hasRtlStoryDirection: boolean;
  hasRtlParagraphDirection: boolean;
  hasBoldDibburCharacterStyle: boolean;
  conservedWordCount: number;
  expectedWordCount: number;
  hasRasterizedSubstitutes: boolean;
  errors: string[];
}

export interface IdmlBorderRectSpec {
  id: string;
  xLeft: number;
  yTop: number;
  xRight: number;
  yBottom: number;
  strokeWeightPt: number;
}

export interface IdmlTextFrameSpec {
  id: string;
  storyId: string;
  pageIndex: number;
  yTop: number;
  xLeft: number;
  yBottom: number;
  xRight: number;
  previousFrameId: string;
  nextFrameId: string;
  roleLabel: string;
  polygonBands: IdmlPolygonBand[];
  polygonPoints: Array<{ x: number; y: number }>;
  textWrapMode: 'None' | 'Contour' | 'BoundingBoxTextWrap';
  textWrapOffsets: { top: number; left: number; bottom: number; right: number };
  ignoreWrap: boolean;
}

export class IdmlExporter {
  /**
   * Standard IEEE 802.3 CRC-32 calculation for UCF/ZIP headers
   */
  private static crc32(data: Uint8Array): number {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  /**
   * Packs an ordered list of file entries into an authentic Adobe UCF/IDML ZIP binary buffer.
   * - Never emits directory entries (`Resources/`, `Spreads/`, etc.).
   * - `mimetype` is written at offset 0 with method=0 (STORE), versionNeeded=20 (0x14), flags=0x0800 (UTF-8), extraLen=0.
   * - All XML files are compressed via raw DEFLATE (obtained from JSZip's internal `_data` or raw deflate)
   *   with method=8 (DEFLATE), versionNeeded=20 (0x14), flags=0x0802, extraLen=0.
   */
  public static async packUcfIdmlZip(
    orderedEntries: Array<{ name: string; content: string; storeUncompressed?: boolean }>
  ): Promise<Blob> {
    const encoder = new TextEncoder();

    // Use JSZip on a single-file scratch archive per compressed entry to obtain raw DEFLATE bytes
    // in both browser and Node environments without extra dependencies, then assemble exact binary headers!
    const prepared: Array<{
      nameBytes: Uint8Array;
      rawBytes: Uint8Array;
      compressedBytes: Uint8Array;
      crc: number;
      compMethod: number;
      flags: number;
    }> = [];

    for (const entry of orderedEntries) {
      const nameBytes = encoder.encode(entry.name);
      const rawBytes = encoder.encode(entry.content);
      const crc = this.crc32(rawBytes);

      if (entry.storeUncompressed) {
        prepared.push({
          nameBytes,
          rawBytes,
          compressedBytes: rawBytes,
          crc,
          compMethod: 0, // STORE
          flags: 0x0800, // UTF-8 filename flag (matches Adobe InDesign CS6/CC)
        });
      } else {
        // Compress single file with JSZip and slice out its raw DEFLATE payload from the generated ZIP
        const tmpZip = new JSZip();
        tmpZip.file('f', rawBytes, {
          compression: 'DEFLATE',
          compressionOptions: { level: 6 },
        });
        const tmpZipBytes = await tmpZip.generateAsync({
          type: 'uint8array',
          compression: 'DEFLATE',
          compressionOptions: { level: 6 },
        });
        // In tmpZipBytes, Local File Header is at offset 0:
        // compSize at offset 18 (uint32LE), nameLen at 26 (uint16LE), extraLen at 28 (uint16LE)
        const view = new DataView(
          tmpZipBytes.buffer,
          tmpZipBytes.byteOffset,
          tmpZipBytes.byteLength
        );
        const compSize = view.getUint32(18, true);
        const fNameLen = view.getUint16(26, true);
        const fExtraLen = view.getUint16(28, true);
        const dataStart = 30 + fNameLen + fExtraLen;
        const compressedBytes = tmpZipBytes.subarray(dataStart, dataStart + compSize);

        prepared.push({
          nameBytes,
          rawBytes,
          compressedBytes,
          crc,
          compMethod: 8, // DEFLATE
          flags: 0x0802, // UTF-8 + normal/max deflate flag (matches Adobe InDesign CS6/CC)
        });
      }
    }

    // Calculate total byte size
    let localSectionSize = 0;
    let centralDirSize = 0;
    for (const item of prepared) {
      localSectionSize += 30 + item.nameBytes.length + item.compressedBytes.length;
      centralDirSize += 46 + item.nameBytes.length;
    }
    const totalSize = localSectionSize + centralDirSize + 22;
    const out = new Uint8Array(totalSize);
    const dv = new DataView(out.buffer);

    // MS-DOS timestamp matching Adobe InDesign (e.g. 2026-10-06 12:00:00)
    const dosTime = 0x6000;
    const dosDate = 0x5d46;

    const localOffsets: number[] = [];
    let offset = 0;

    // 1. Write Local File Headers + File Data
    for (const item of prepared) {
      localOffsets.push(offset);
      dv.setUint32(offset + 0, 0x04034b50, true); // Local file header signature
      dv.setUint16(offset + 4, 20, true); // Version needed to extract (2.0 = 20)
      dv.setUint16(offset + 6, item.flags, true); // General purpose bit flag
      dv.setUint16(offset + 8, item.compMethod, true); // Compression method (0=STORE, 8=DEFLATE)
      dv.setUint16(offset + 10, dosTime, true); // Last mod file time
      dv.setUint16(offset + 12, dosDate, true); // Last mod file date
      dv.setUint32(offset + 14, item.crc, true); // CRC-32
      dv.setUint32(offset + 18, item.compressedBytes.length, true); // Compressed size
      dv.setUint32(offset + 22, item.rawBytes.length, true); // Uncompressed size
      dv.setUint16(offset + 26, item.nameBytes.length, true); // File name length
      dv.setUint16(offset + 28, 0, true); // Extra field length = 0
      out.set(item.nameBytes, offset + 30);
      out.set(item.compressedBytes, offset + 30 + item.nameBytes.length);
      offset += 30 + item.nameBytes.length + item.compressedBytes.length;
    }

    const centralDirOffset = offset;

    // 2. Write Central Directory File Headers
    for (let i = 0; i < prepared.length; i++) {
      const item = prepared[i];
      dv.setUint32(offset + 0, 0x02014b50, true); // Central directory file header signature
      dv.setUint16(offset + 4, 20, true); // Version made by (20)
      dv.setUint16(offset + 6, 20, true); // Version needed to extract (20)
      dv.setUint16(offset + 8, item.flags, true); // General purpose bit flag
      dv.setUint16(offset + 10, item.compMethod, true); // Compression method
      dv.setUint16(offset + 12, dosTime, true); // Last mod file time
      dv.setUint16(offset + 14, dosDate, true); // Last mod file date
      dv.setUint32(offset + 16, item.crc, true); // CRC-32
      dv.setUint32(offset + 20, item.compressedBytes.length, true); // Compressed size
      dv.setUint32(offset + 24, item.rawBytes.length, true); // Uncompressed size
      dv.setUint16(offset + 28, item.nameBytes.length, true); // File name length
      dv.setUint16(offset + 30, 0, true); // Extra field length = 0
      dv.setUint16(offset + 32, 0, true); // File comment length = 0
      dv.setUint16(offset + 34, 0, true); // Disk number start = 0
      dv.setUint16(offset + 36, 0, true); // Internal file attributes = 0
      dv.setUint32(offset + 38, 0, true); // External file attributes = 0
      dv.setUint32(offset + 42, localOffsets[i], true); // Relative offset of local header
      out.set(item.nameBytes, offset + 46);
      offset += 46 + item.nameBytes.length;
    }

    // 3. Write End of Central Directory Record (EOCD)
    dv.setUint32(offset + 0, 0x06054b50, true); // EOCD signature
    dv.setUint16(offset + 4, 0, true); // Number of this disk
    dv.setUint16(offset + 6, 0, true); // Disk where central directory starts
    dv.setUint16(offset + 8, prepared.length, true); // Number of CD records on this disk
    dv.setUint16(offset + 10, prepared.length, true); // Total number of CD records
    dv.setUint32(offset + 12, centralDirSize, true); // Size of central directory
    dv.setUint32(offset + 16, centralDirOffset, true); // Offset of start of central directory
    dv.setUint16(offset + 20, 0, true); // Comment length = 0

    return new Blob([out], { type: 'application/vnd.adobe.indesign-idml-package' });
  }

  /**
   * Inspects the raw binary bytes of a ZIP/IDML package and verifies strict Adobe UCF compliance.
   */
  public static inspectZipBinary(buffer: ArrayBuffer): IdmlZipBinaryAudit {
    const bytes = new Uint8Array(buffer);
    const dv = new DataView(buffer);
    const decoder = new TextDecoder('utf-8');

    const entryNames: string[] = [];
    let hasZeroDirectoryEntries = true;
    let offset = 0;

    let isFirstEntryMimetype = false;
    let firstEntryCompressionMethod = -1;
    let firstEntryVersionNeeded = -1;
    let firstEntryFlags = -1;
    let firstEntryExtraFieldLength = -1;
    let firstEntryCompressedSize = -1;
    let firstEntryUncompressedSize = -1;
    let firstEntryDataExact = false;

    let idx = 0;
    while (offset + 30 <= bytes.length && dv.getUint32(offset, true) === 0x04034b50) {
      const verNeeded = dv.getUint16(offset + 4, true);
      const flags = dv.getUint16(offset + 6, true);
      const compMethod = dv.getUint16(offset + 8, true);
      const compSize = dv.getUint32(offset + 18, true);
      const uncompSize = dv.getUint32(offset + 22, true);
      const nameLen = dv.getUint16(offset + 26, true);
      const extraLen = dv.getUint16(offset + 28, true);
      const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLen));
      entryNames.push(name);

      if (name.endsWith('/')) {
        hasZeroDirectoryEntries = false;
      }

      if (idx === 0) {
        isFirstEntryMimetype = name === 'mimetype';
        firstEntryCompressionMethod = compMethod;
        firstEntryVersionNeeded = verNeeded;
        firstEntryFlags = flags;
        firstEntryExtraFieldLength = extraLen;
        firstEntryCompressedSize = compSize;
        firstEntryUncompressedSize = uncompSize;
        const dataStr = decoder.decode(
          bytes.subarray(
            offset + 30 + nameLen + extraLen,
            offset + 30 + nameLen + extraLen + compSize
          )
        );
        firstEntryDataExact =
          dataStr === 'application/vnd.adobe.indesign-idml-package' && compSize === 43;
      }

      offset += 30 + nameLen + extraLen + compSize;
      idx++;
    }

    return {
      isFirstEntryMimetype,
      firstEntryCompressionMethod,
      firstEntryVersionNeeded,
      firstEntryFlags,
      firstEntryExtraFieldLength,
      firstEntryCompressedSize,
      firstEntryUncompressedSize,
      firstEntryDataExact,
      hasZeroDirectoryEntries,
      entryNames,
    };
  }

  /**
   * Helper to escape XML special characters
   */
  public static escapeXml(str: string): string {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * STEP 1 / TEST A — Minimal Known-Good IDML Generator
   * Generates a minimal, 100% authentic Adobe InDesign IDML package containing ONLY:
   * - 1 document
   * - 1 page
   * - 1 layer (`uc3`)
   * - 1 text frame (`uee`)
   * - 1 paragraph
   * - Simple Hebrew text (`מסכת ברכות`)
   * Directly derived from Adobe InDesign's known-good `ADOBE_IDML_REFERENCE_FILES` with
   * zero custom geometry, zero threading, zero Rav-Text, and zero footnotes.
   */
  public static async generateMinimalKnownGoodIdml(
    hebrewText: string = 'מסכת ברכות'
  ): Promise<Blob> {
    const escapedText = this.escapeXml(hebrewText);

    // Replace only the text content inside the known-good Adobe Story_udc.xml and set RTL paragraph/story direction
    const minimalStoryXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:Story xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="8.0">
\t<Story Self="udc" AppliedTOCStyle="n" TrackChanges="false" StoryTitle="$ID/" AppliedNamedGrid="n">
\t\t<StoryPreference OpticalMarginAlignment="false" OpticalMarginSize="12" FrameType="TextFrameType" StoryOrientation="Horizontal" StoryDirection="RightToLeftDirection" />
\t\t<InCopyExportOption IncludeGraphicProxies="true" IncludeAllResources="false" />
\t\t<XMLElement Self="di2i3" MarkupTag="XMLTag/dynamic_content" XMLContent="udc">
\t\t\t<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle" Justification="RightAlign" ParagraphDirection="RightToLeftDirection">
\t\t\t\t<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]" PointSize="16">
\t\t\t\t\t<Properties>
\t\t\t\t\t\t<AppliedFont type="string">Arial</AppliedFont>
\t\t\t\t\t</Properties>
\t\t\t\t\t<Content>${escapedText}</Content>
\t\t\t\t</CharacterStyleRange>
\t\t\t</ParagraphStyleRange>
\t\t</XMLElement>
\t</Story>
</idPkg:Story>`;

    const orderedEntries: Array<{
      name: string;
      content: string;
      storeUncompressed?: boolean;
    }> = [
      {
        name: 'mimetype',
        content: 'application/vnd.adobe.indesign-idml-package',
        storeUncompressed: true,
      },
      { name: 'designmap.xml', content: ADOBE_IDML_REFERENCE_FILES['designmap.xml'] },
      {
        name: 'META-INF/container.xml',
        content: ADOBE_IDML_REFERENCE_FILES['META-INF/container.xml'],
      },
      {
        name: 'META-INF/metadata.xml',
        content: ADOBE_IDML_REFERENCE_FILES['META-INF/metadata.xml'],
      },
      {
        name: 'Resources/Graphic.xml',
        content: ADOBE_IDML_REFERENCE_FILES['Resources/Graphic.xml'],
      },
      {
        name: 'Resources/Fonts.xml',
        content: ADOBE_IDML_REFERENCE_FILES['Resources/Fonts.xml'],
      },
      {
        name: 'Resources/Styles.xml',
        content: ADOBE_IDML_REFERENCE_FILES['Resources/Styles.xml'],
      },
      {
        name: 'Resources/Preferences.xml',
        content: ADOBE_IDML_REFERENCE_FILES['Resources/Preferences.xml'],
      },
      { name: 'XML/Tags.xml', content: ADOBE_IDML_REFERENCE_FILES['XML/Tags.xml'] },
      {
        name: 'MasterSpreads/MasterSpread_ucd.xml',
        content: ADOBE_IDML_REFERENCE_FILES['MasterSpreads/MasterSpread_ucd.xml'],
      },
      {
        name: 'Spreads/Spread_uc6.xml',
        content: ADOBE_IDML_REFERENCE_FILES['Spreads/Spread_uc6.xml'],
      },
      {
        name: 'XML/BackingStory.xml',
        content: ADOBE_IDML_REFERENCE_FILES['XML/BackingStory.xml'],
      },
      { name: 'Stories/Story_udc.xml', content: minimalStoryXml },
    ];

    return this.packUcfIdmlZip(orderedEntries);
  }

  /**
   * Builds valid Adobe InDesign `<TextFrame>` XML using `<PathGeometry>` + `<ItemTransform>`
   * relative to the Page's top-left corner `(0, -pageHeight / 2)` on a single-page Spread.
   * - Supports arbitrary axis-aligned stepped polygons (`spec.polygonPoints`) so a single unified
   *   commentary or source frame traces the exact upper collar, flanking column, stepped knee, and lower
   *   continuation contour without splitting a stream into separate rectangular boxes!
   * - Applies real InDesign `<TextWrapPreference TextWrapMode="Contour">` + `<ContourOption ContourType="SameAsClipping">`
   *   on the central Source exclusion object so surrounding commentary flows around it when moved or resized.
   */
  private static buildAdobeTextFrameXml(
    spec: IdmlTextFrameSpec,
    pageHeight: number
  ): string {
    const w = Math.max(20, Number((spec.xRight - spec.xLeft).toFixed(3)));
    const h = Math.max(12, Number((spec.yBottom - spec.yTop).toFixed(3)));
    const halfW = Number((w / 2).toFixed(4));
    const halfH = Number((h / 2).toFixed(4));

    const centerX = spec.xLeft + w / 2;
    const centerY = spec.yTop + h / 2;

    // In Adobe InDesign's Spread coordinate system (where Page has GeometricBounds="0 0 pageHeight pageWidth"
    // and ItemTransform="1 0 0 1 0 -pageHeight/2"), page top-left is at (0, -pageHeight/2).
    const tx = Number(centerX.toFixed(4));
    const ty = Number((-pageHeight / 2 + centerY).toFixed(4));

    // Convert page-space polygon vertices into local frame-centered PathPointType anchors
    const polyPts =
      spec.polygonPoints && spec.polygonPoints.length >= 4
        ? spec.polygonPoints
        : [
            { x: spec.xLeft, y: spec.yTop },
            { x: spec.xLeft, y: spec.yBottom },
            { x: spec.xRight, y: spec.yBottom },
            { x: spec.xRight, y: spec.yTop },
          ];

    const pathPointsXml = polyPts
      .map(pt => {
        const lx = Number((pt.x - centerX).toFixed(4));
        const ly = Number((pt.y - centerY).toFixed(4));
        const coord = `${lx} ${ly}`;
        return `\t\t\t\t\t\t\t<PathPointType Anchor="${coord}" LeftDirection="${coord}" RightDirection="${coord}" />`;
      })
      .join('\n');

    const ignoreWrapAttr = spec.ignoreWrap ? ' IgnoreWrap="true"' : ' IgnoreWrap="false"';
    const { top, left, bottom, right } = spec.textWrapOffsets;
    const contourOptionXml =
      spec.textWrapMode === 'Contour'
        ? `\n\t\t\t\t<ContourOption ContourType="SameAsClipping" IncludeInsideEdges="false" ContourPathName="$ID/" />`
        : '';

    return `\t\t<TextFrame Self="${spec.id}" ParentStory="${spec.storyId}" PreviousTextFrame="${spec.previousFrameId}" NextTextFrame="${spec.nextFrameId}" ContentType="TextType" ParentInterfaceChangeCount="" TargetInterfaceChangeCount="" LastUpdatedInterfaceChangeCount="" OverriddenPageItemProps="" HorizontalLayoutConstraints="FlexibleDimension FixedDimension FlexibleDimension" VerticalLayoutConstraints="FlexibleDimension FixedDimension FlexibleDimension" GradientFillStart="0 0" GradientFillLength="0" GradientFillAngle="0" GradientStrokeStart="0 0" GradientStrokeLength="0" GradientStrokeAngle="0" ItemLayer="uc3" Locked="false" LocalDisplaySetting="Default" GradientFillHiliteLength="0" GradientFillHiliteAngle="0" GradientStrokeHiliteLength="0" GradientStrokeHiliteAngle="0" AppliedObjectStyle="ObjectStyle/$ID/[Normal Text Frame]" Visible="true" Name="$ID/" ItemTransform="1 0 0 1 ${tx} ${ty}">
\t\t\t<Properties>
\t\t\t\t<PathGeometry>
\t\t\t\t\t<GeometryPathType PathOpen="false">
\t\t\t\t\t\t<PathPointArray>
${pathPointsXml}
\t\t\t\t\t\t</PathPointArray>
\t\t\t\t\t</GeometryPathType>
\t\t\t\t</PathGeometry>
\t\t\t</Properties>
\t\t\t<TextFramePreference TextColumnCount="1" TextColumnFixedWidth="${w}" TextColumnMaxWidth="0" VerticalJustification="TopAlign"${ignoreWrapAttr} />
\t\t\t<TextWrapPreference Inverse="false" ApplyToMasterPageOnly="false" TextWrapSide="BothSides" TextWrapMode="${spec.textWrapMode}">
\t\t\t\t<Properties>
\t\t\t\t\t<TextWrapOffset Top="${top}" Left="${left}" Bottom="${bottom}" Right="${right}" />
\t\t\t\t</Properties>${contourOptionXml}
\t\t\t</TextWrapPreference>
\t\t\t<ObjectExportOption AltTextSourceType="SourceXMLStructure" ActualTextSourceType="SourceXMLStructure" CustomAltText="$ID/" CustomActualText="$ID/" ApplyTagType="TagFromStructure" CustomImageConversion="false" ImageConversionType="JPEG" CustomImageSizeOption="SizeRelativeToPageWidth" ImageExportResolution="Ppi300" GIFOptionsPalette="AdaptivePalette" GIFOptionsInterlaced="true" JPEGOptionsQuality="High" JPEGOptionsFormat="BaselineEncoding" ImageAlignment="AlignLeft" ImageSpaceBefore="0" ImageSpaceAfter="0" UseImagePageBreak="false" ImagePageBreak="PageBreakBefore" CustomImageAlignment="false" SpaceUnit="CssPixel" CustomLayout="false" CustomLayoutType="AlignmentAndSpacing">
\t\t\t\t<Properties>
\t\t\t\t\t<AltMetadataProperty NamespacePrefix="$ID/" PropertyPath="$ID/" />
\t\t\t\t\t<ActualMetadataProperty NamespacePrefix="$ID/" PropertyPath="$ID/" />
\t\t\t\t</Properties>
\t\t\t</ObjectExportOption>
\t\t</TextFrame>`;
  }

  /**
   * One rectangle of a title-page border, in page points, for the IDML
   * graphic frame emitted by `buildAdobeRectangleXml`.
   */
  private static buildAdobeRectangleXml(
    spec: IdmlBorderRectSpec,
    pageHeight: number
  ): string {
    const w = Math.max(20, Number((spec.xRight - spec.xLeft).toFixed(3)));
    const h = Math.max(12, Number((spec.yBottom - spec.yTop).toFixed(3)));
    const centerX = spec.xLeft + w / 2;
    const centerY = spec.yTop + h / 2;
    // Same spread coordinate system as the text frames: page top-left is
    // at (0, -pageHeight/2).
    const tx = Number(centerX.toFixed(4));
    const ty = Number((-pageHeight / 2 + centerY).toFixed(4));
    const corners = [
      { x: spec.xLeft, y: spec.yTop },
      { x: spec.xLeft, y: spec.yBottom },
      { x: spec.xRight, y: spec.yBottom },
      { x: spec.xRight, y: spec.yTop },
    ];
    const pathPointsXml = corners
      .map(pt => {
        const lx = Number((pt.x - centerX).toFixed(4));
        const ly = Number((pt.y - centerY).toFixed(4));
        const coord = `${lx} ${ly}`;
        return `\t\t\t\t\t\t\t<PathPointType Anchor="${coord}" LeftDirection="${coord}" RightDirection="${coord}" />`;
      })
      .join('\n');
    // `Color/KeterBorder` is registered in Resources/Graphic.xml when
    // any border rect exists (see the export flow); `Swatch/None` for the
    // fill comes from Adobe's canonical Graphic.xml.
    return `\t\t<Rectangle Self="${spec.id}" ContentType="GraphicType" ParentInterfaceChangeCount="" TargetInterfaceChangeCount="" LastUpdatedInterfaceChangeCount="" OverriddenPageItemProps="" HorizontalLayoutConstraints="FlexibleDimension FixedDimension FlexibleDimension" VerticalLayoutConstraints="FlexibleDimension FixedDimension FlexibleDimension" GradientFillStart="0 0" GradientFillLength="0" GradientFillAngle="0" GradientStrokeStart="0 0" GradientStrokeLength="0" GradientStrokeAngle="0" ItemLayer="uc3" Locked="false" LocalDisplaySetting="Default" GradientFillHiliteLength="0" GradientFillHiliteAngle="0" GradientStrokeHiliteLength="0" GradientStrokeHiliteAngle="0" AppliedObjectStyle="ObjectStyle/$ID/[Normal Graphics Frame]" Visible="true" Name="$ID/" ItemTransform="1 0 0 1 ${tx} ${ty}" StrokeWeight="${spec.strokeWeightPt}" StrokeColor="Color/KeterBorder" FillColor="Swatch/None">
\t\t\t<Properties>
\t\t\t\t<PathGeometry>
\t\t\t\t\t<GeometryPathType PathOpen="false">
\t\t\t\t\t\t<PathPointArray>
${pathPointsXml}
\t\t\t\t\t\t</PathPointArray>
\t\t\t\t\t</GeometryPathType>
\t\t\t\t</PathGeometry>
\t\t\t</Properties>
\t\t</Rectangle>`;
  }

  /**
   * v0.6.0 Part C (§8): the title-page border as IDML graphic frames.
   * The outer rect is the fitted frame (inset + padding, scaled around
   * the page centre, shifted — the same rect the PDF and the preview
   * use); double-style borders (double/corner/stepped/patterned/
   * ornate) also get an inner rect 14 normalized units inside, matching
   * the vector geometry. The corner scrolls and the pattern band are
   * NOT emitted — they are decorative path art with no clean rectangle
   * equivalent, so InDesign gets the frame rects and the ornamentation
   * stays preview + PDF only (see the manifest). A custom imported
   * border image is also not emitted as geometry: the exporter has no
   * image-link machinery (no Links/ folder, no <Image> items), and
   * fabricating one would produce a broken link. It is instead named in
   * a note line inside the title frame (computeTitlePageFrames, #51),
   * so the loss is visible, not silent.
   */
  private static computeTitlePageBorderRects(
    page: PageTypesetResult,
    pageIndex: number,
    geometry: PageGeometry
  ): IdmlBorderRectSpec[] {
    if (!page.isTitlePage) return [];
    const tp = page.designSettings?.titlePage;
    if (!tp?.enabled || !tp.border.enabled || tp.border.styleId === 'none') return [];
    if (tp.customBorderImage) return [];
    const outer = titlePageBorderImageRect(
      tp.border,
      geometry.pageWidth,
      geometry.pageHeight
    );
    const weight = Math.max(0.4, tp.border.thicknessPt);
    const rects: IdmlBorderRectSpec[] = [
      {
        id: `tf_border_${pageIndex}`,
        xLeft: outer.x,
        yTop: outer.y,
        xRight: outer.x + outer.w,
        yBottom: outer.y + outer.h,
        strokeWeightPt: weight,
      },
    ];
    if (tp.border.styleId !== 'single') {
      const scale = (tp.border.scalePct ?? 100) / 100;
      const gapX = (14 / 1000) * geometry.pageWidth * scale;
      const gapY = (14 / 1000) * geometry.pageHeight * scale;
      rects.push({
        id: `tf_border_inner_${pageIndex}`,
        xLeft: outer.x + gapX,
        yTop: outer.y + gapY,
        xRight: outer.x + outer.w - gapX,
        yBottom: outer.y + outer.h - gapY,
        strokeWeightPt: weight,
      });
    }
    return rects;
  }

  /**
   * Maps a numeric fontWeight + boolean isItalic/isBold into an Adobe InDesign FontStyle string.
   */
  public static resolveIdmlFontStyle(
    fontWeight?: number,
    isBold?: boolean,
    isItalic?: boolean
  ): string {
    const bold = Boolean(isBold || (fontWeight ?? 400) >= 600);
    if (bold && isItalic) return 'Bold Italic';
    if (bold) return 'Bold';
    if (isItalic) return 'Italic';
    if (fontWeight === 600) return 'SemiBold';
    if (fontWeight === 500) return 'Medium';
    return 'Regular';
  }

  /**
   * Converts a CSS hex color (`#RRGGBB`) into an IDML Color Self ID (`Color/KeterHex_RRGGBB`)
   * and returns its RGB values `[R, G, B]` (0-255) for `Resources/Graphic.xml`.
   */
  public static normalizeHexColorToIdmlSwatch(
    hexColor?: string
  ): { swatchId: string; rgb: [number, number, number] } | null {
    if (!hexColor) return null;
    const cleaned = hexColor.trim().replace(/^#/, '').toUpperCase();
    if (!/^[0-9A-F]{6}$/.test(cleaned)) return null;
    // Ignore default near-black ink so standard black text uses default swatch unless explicitly colored
    if (cleaned === '121214' || cleaned === '000000' || cleaned === '222120') return null;
    const r = parseInt(cleaned.slice(0, 2), 16);
    const g = parseInt(cleaned.slice(2, 4), 16);
    const b = parseInt(cleaned.slice(4, 6), 16);
    return {
      swatchId: `Color/KeterHex_${cleaned}`,
      rgb: [r, g, b],
    };
  }

  /**
   * Builds rich `<ParagraphStyleRange>` XML from solved `TypesetLine[]`,
   * preserving exact word order, spaces between words, bold `isDibbur` runs,
   * inline `footnoteMarker` superscript references, and all Stage 13 character & paragraph
   * formatting properties (`AppliedFont`, `PointSize`, `FontStyle`, `Underline`, `FillColor`,
   * `Tracking`, `HorizontalScale`, `BaselineShift`, `Justification`, `SingleWordJustification`,
   * `DesiredWordSpacing`, `FirstLineIndent`, `RightIndent`, `LeftIndent`, `SpaceBefore`, `SpaceAfter`, `Leading`).
   */
  private static buildStoryParagraphRangesXml(
    lines: TypesetLine[],
    defaultParagraphStyle: string,
    customColorSwatches?: Map<string, [number, number, number]>,
    usedFontFamilies?: Set<string>
  ): string {
    if (!lines || lines.length === 0) return '';

    const paragraphBlocks: string[] = [];

    for (let lIdx = 0; lIdx < lines.length; lIdx++) {
      const line = lines[lIdx];
      const realWords = line.words.filter(w => !w.isSpace && w.text.trim().length > 0);
      if (realWords.length === 0) continue;

      if (line.fontFamily && usedFontFamilies) {
        usedFontFamilies.add(line.fontFamily);
      }

      const isHeading =
        line.role === 'chapter' ||
        line.role === 'heading' ||
        line.role === 'main_title' ||
        line.role === 'siman';
      const paraStyle = isHeading ? 'ParagraphStyle/KeterHeading' : defaultParagraphStyle;

      const paraExtraAttrs: string[] = [];
      const effAlign = line.paragraphAlignment ?? line.alignment;
      const lastAlign = line.lastLineAlignment ?? 'right';
      if (effAlign) {
        let idmlJust = 'RightJustified';
        if (effAlign === 'center') {
          idmlJust = 'CenterAlign';
        } else if (effAlign === 'right') {
          idmlJust = 'RightAlign';
        } else if (effAlign === 'left') {
          idmlJust = 'LeftAlign';
        } else {
          // effAlign === 'justify': map lastLineAlignment to InDesign Justification enum
          idmlJust =
            lastAlign === 'center'
              ? 'CenterJustified'
              : lastAlign === 'left'
              ? 'LeftJustified'
              : lastAlign === 'justify'
              ? 'FullyJustified'
              : 'RightJustified';
        }
        paraExtraAttrs.push(`Justification="${idmlJust}"`);
      }
      if (line.lastLineAlignment) {
        const singleWordJust =
          line.lastLineAlignment === 'center'
            ? 'CenterAlign'
            : line.lastLineAlignment === 'left'
            ? 'LeftAlign'
            : line.lastLineAlignment === 'justify'
            ? 'FullyJustified'
            : 'RightAlign';
        paraExtraAttrs.push(`SingleWordJustification="${singleWordJust}"`);
      }

      // Indents: In IDML, Hanging Indent is represented via RightIndent = baseRightIndent + hangingIndent,
      // and FirstLineIndent = firstLineIndent - hangingIndent.
      // Note that TypesetterEngine stores `line.rightIndentPt = baseRightIndent + (isNotFirstLine ? hangingIndent : 0)`.
      const lineHangPt = line.hangingIndentPt ?? 0;
      const lineFirstPt = line.firstLineIndentPt ?? line.firstLineIndent ?? 0;
      const lineRightPt = line.rightIndentPt ?? 0;
      const effectiveRightIndentPt = lineRightPt;
      const effectiveFirstLineIndentPt =
        lineHangPt > 0 && lineFirstPt === 0 ? -lineHangPt : lineFirstPt;

      if (effectiveFirstLineIndentPt !== 0) {
        paraExtraAttrs.push(`FirstLineIndent="${Number(effectiveFirstLineIndentPt.toFixed(2))}"`);
      }
      if (effectiveRightIndentPt !== 0) {
        paraExtraAttrs.push(`RightIndent="${Number(effectiveRightIndentPt.toFixed(2))}"`);
      }
      if (line.leftIndentPt) {
        paraExtraAttrs.push(`LeftIndent="${Number(line.leftIndentPt.toFixed(2))}"`);
      }
      if (line.spaceBeforePt) {
        paraExtraAttrs.push(`SpaceBefore="${Number(line.spaceBeforePt.toFixed(2))}"`);
      }
      if (line.spaceAfterPt) {
        paraExtraAttrs.push(`SpaceAfter="${Number(line.spaceAfterPt.toFixed(2))}"`);
      }
      if (line.fontSizePt) {
        paraExtraAttrs.push(`PointSize="${Number(line.fontSizePt.toFixed(2))}"`);
      }
      if (line.trackingEm !== undefined && line.trackingEm !== 0) {
        paraExtraAttrs.push(`Tracking="${Math.round(line.trackingEm * 1000)}"`);
      }
      if (line.wordSpacingRatio !== undefined && Math.abs(line.wordSpacingRatio - 1.0) > 0.005) {
        const desiredWsPct = Math.round(line.wordSpacingRatio * 100);
        paraExtraAttrs.push(`DesiredWordSpacing="${desiredWsPct}"`);
      }
      if (line.horizontalScalePercent && line.horizontalScalePercent !== 100) {
        paraExtraAttrs.push(`HorizontalScale="${line.horizontalScalePercent}"`);
      }
      if (line.baselineShiftPt) {
        paraExtraAttrs.push(`BaselineShift="${line.baselineShiftPt}"`);
      }

      const paraPropLines: string[] = [];
      const effectiveLeading = line.leadingPt ?? line.height;
      if (effectiveLeading && effectiveLeading > 0 && Number.isFinite(effectiveLeading)) {
        paraPropLines.push(`\t\t\t\t\t<Leading type="unit">${Number(effectiveLeading.toFixed(2))}</Leading>`);
      }
      if (line.fontFamily) {
        paraPropLines.push(
          `\t\t\t\t\t<AppliedFont type="string">${this.escapeXml(line.fontFamily)}</AppliedFont>`
        );
      }
      const paraPropertiesXml =
        paraPropLines.length > 0
          ? `\t\t\t\t<Properties>\n${paraPropLines.join('\n')}\n\t\t\t\t</Properties>\n`
          : '';

      const paraAttrStr = paraExtraAttrs.length > 0 ? ' ' + paraExtraAttrs.join(' ') : '';

      interface CharRunSignature {
        isBold: boolean;
        isItalic: boolean;
        isUnderline: boolean;
        fontFamily?: string;
        fontSizePt?: number;
        fontWeight?: number;
        textColor?: string;
        trackingEm?: number;
        horizontalScalePercent?: number;
        baselineShiftPt?: number;
      }

      const getWordSig = (w: TypesetLine['words'][number]): CharRunSignature => {
        const isBold = Boolean(w.isDibbur || w.isBold || (w.fontWeight ?? line.fontWeight ?? 400) >= 600);
        const isItalic = Boolean(w.isItalic ?? line.isItalic);
        const isUnderline = Boolean(w.isUnderline ?? line.isUnderline);
        const fontFamily = w.fontFamily || line.fontFamily;
        if (fontFamily && usedFontFamilies) {
          usedFontFamilies.add(fontFamily);
        }
        return {
          isBold,
          isItalic,
          isUnderline,
          fontFamily,
          fontSizePt: w.fontSizePt ?? line.fontSizePt,
          fontWeight: w.fontWeight ?? line.fontWeight,
          textColor: w.textColor ?? line.textColor,
          trackingEm: w.trackingEm ?? line.trackingEm,
          horizontalScalePercent: w.horizontalScalePercent ?? line.horizontalScalePercent,
          baselineShiftPt: w.baselineShiftPt ?? line.baselineShiftPt,
        };
      };

      const sigEquals = (a: CharRunSignature, b: CharRunSignature): boolean =>
        a.isBold === b.isBold &&
        a.isItalic === b.isItalic &&
        a.isUnderline === b.isUnderline &&
        a.fontFamily === b.fontFamily &&
        a.fontSizePt === b.fontSizePt &&
        a.fontWeight === b.fontWeight &&
        a.textColor === b.textColor &&
        a.trackingEm === b.trackingEm &&
        a.horizontalScalePercent === b.horizontalScalePercent &&
        a.baselineShiftPt === b.baselineShiftPt;

      const charRanges: string[] = [];
      let currentSig = getWordSig(realWords[0]);
      let buffer: string[] = [];

      const flushBuffer = (sig: CharRunSignature, addTrailingSpace: boolean) => {
        if (buffer.length === 0) return;
        const cStyle = sig.isBold
          ? 'CharacterStyle/KeterDibburBold'
          : 'CharacterStyle/$ID/[No character style]';
        const fontStyleStr = this.resolveIdmlFontStyle(
          sig.fontWeight,
          sig.isBold,
          sig.isItalic
        );
        const charAttrs: string[] = [`AppliedCharacterStyle="${cStyle}"`];
        if (fontStyleStr !== 'Regular' || sig.isBold || sig.isItalic) {
          charAttrs.push(`FontStyle="${fontStyleStr}"`);
        }
        if (sig.fontSizePt) {
          charAttrs.push(`PointSize="${Number(sig.fontSizePt.toFixed(2))}"`);
        }
        if (sig.isUnderline) {
          charAttrs.push(`Underline="true"`);
        }
        if (sig.trackingEm !== undefined && sig.trackingEm !== 0) {
          charAttrs.push(`Tracking="${Math.round(sig.trackingEm * 1000)}"`);
        }
        if (sig.horizontalScalePercent && sig.horizontalScalePercent !== 100) {
          charAttrs.push(`HorizontalScale="${sig.horizontalScalePercent}"`);
        }
        if (sig.baselineShiftPt) {
          charAttrs.push(`BaselineShift="${sig.baselineShiftPt}"`);
        }
        const swatch = this.normalizeHexColorToIdmlSwatch(sig.textColor);
        if (swatch) {
          charAttrs.push(`FillColor="${swatch.swatchId}"`);
          if (customColorSwatches) {
            customColorSwatches.set(swatch.swatchId, swatch.rgb);
          }
        }

        const charPropsXml = sig.fontFamily
          ? `\t\t\t\t\t<Properties>\n\t\t\t\t\t\t<AppliedFont type="string">${this.escapeXml(sig.fontFamily)}</AppliedFont>\n\t\t\t\t\t</Properties>\n`
          : '';
        const textContent = buffer.join(' ') + (addTrailingSpace ? ' ' : '');
        charRanges.push(
          `\t\t\t\t<CharacterStyleRange ${charAttrs.join(' ')}>\n${charPropsXml}\t\t\t\t\t<Content>${this.escapeXml(textContent)}</Content>\n\t\t\t\t</CharacterStyleRange>`
        );
        buffer = [];
      };

      for (let wIdx = 0; wIdx < realWords.length; wIdx++) {
        const w = realWords[wIdx];
        const wSig = getWordSig(w);
        const hasMoreWords = wIdx < realWords.length - 1;

        if (!sigEquals(wSig, currentSig) && buffer.length > 0) {
          flushBuffer(currentSig, true);
          currentSig = wSig;
        }
        buffer.push(w.text);

        if (w.footnoteMarker !== undefined) {
          flushBuffer(currentSig, false);
          charRanges.push(
            `\t\t\t\t<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/KeterFootnoteRef" Position="Superscript">
\t\t\t\t\t<Content>${this.escapeXml(`[${w.footnoteMarker}]`)}${hasMoreWords ? ' ' : ''}</Content>
\t\t\t\t</CharacterStyleRange>`
          );
          if (hasMoreWords) {
            currentSig = getWordSig(realWords[wIdx + 1]);
          }
        }
      }

      if (buffer.length > 0) {
        flushBuffer(currentSig, false);
      }

      const brTag = lIdx < lines.length - 1 ? '\n\t\t\t\t<Br />' : '';

      paragraphBlocks.push(
        `\t\t\t<ParagraphStyleRange AppliedParagraphStyle="${paraStyle}" ParagraphDirection="RightToLeftDirection"${paraAttrStr}>
${paraPropertiesXml}${charRanges.join('\n')}${brTag}
\t\t\t</ParagraphStyleRange>`
      );
    }

    return paragraphBlocks.join('\n');
  }

  /**
   * Converts a list of horizontal bands (`IdmlPolygonBand[]`) into a single closed counter-clockwise
   * axis-aligned polygon (`Array<{ x: number; y: number }>`) tracing the left contour top-to-bottom
   * and the right contour bottom-to-top.
   */
  public static bandsToPolygonPoints(
    bands: IdmlPolygonBand[]
  ): Array<{ x: number; y: number }> {
    if (bands.length === 0) return [];
    const poly: Array<{ x: number; y: number }> = [];

    // Left contour: top-to-bottom
    for (let i = 0; i < bands.length; i++) {
      const b = bands[i];
      if (i === 0) {
        poly.push({ x: b.xLeft, y: b.yTop });
      } else {
        const prev = bands[i - 1];
        if (Math.abs(b.xLeft - prev.xLeft) > 0.5) {
          poly.push({ x: prev.xLeft, y: b.yTop });
          poly.push({ x: b.xLeft, y: b.yTop });
        }
      }
      if (i === bands.length - 1) {
        poly.push({ x: b.xLeft, y: b.yBottom });
      }
    }

    // Right contour: bottom-to-top
    for (let i = bands.length - 1; i >= 0; i--) {
      const b = bands[i];
      if (i === bands.length - 1) {
        poly.push({ x: b.xRight, y: b.yBottom });
      } else {
        const next = bands[i + 1];
        if (Math.abs(b.xRight - next.xRight) > 0.5) {
          poly.push({ x: next.xRight, y: next.yTop });
          poly.push({ x: b.xRight, y: next.yTop });
        }
      }
      if (i === 0) {
        poly.push({ x: b.xRight, y: b.yTop });
      }
    }

    return poly;
  }

  /**
   * Computes non-overlapping, geometry-faithful `IdmlTextFrameSpec[]` for a solved page.
   *
   * TRUE RAV-TEXT FLOW ARCHITECTURE:
   * - Instead of slicing Rashi, Tosafot, or Source into multiple disconnected rectangular boxes per page,
   *   each stream on a page is represented as a **single unified `<TextFrame>`** whose `<PathGeometry>`
   *   polygon traces the exact solved contour (upper collar -> flanking column -> stepped knee -> lower continuation).
   * - The central Source `<TextFrame>` carries an active Adobe InDesign exclusion wrap:
   *   `<TextWrapPreference TextWrapMode="Contour" TextWrapSide="BothSides">` with
   *   `<ContourOption ContourType="SameAsClipping" />` and `<TextWrapOffset>` matching the solved gutter,
   *   while surrounding commentary frames have `IgnoreWrap="false"` so they genuinely flow around the
   *   central Source exclusion object in Adobe InDesign!
   */
  /**
   * v0.5.0 (Title Page / Shaar Blat builder): frames + lines for the
   * synthetic title page. It has no typeset lines, so the rows are
   * fabricated from the shared field layout (`layoutTitlePageFields` —
   * the same heights as the preview and the PDF) as one unified frame
   * carrying one story (`u_story_title`). v0.6.0 Part C (§8): the
   * border is now emitted too, as graphic frames (see
   * `computeTitlePageBorderRects`); y-offsets and line heights flow
   * through the shared layout, while per-line x-offsets stay preview +
   * PDF only — the unified frame keeps every line at the content
   * margins and a per-line horizontal shift has no clean single-frame
   * representation.
   */
  public static computeTitlePageFrames(
    page: PageTypesetResult,
    pageIndex: number
  ): {
    frames: Omit<IdmlTextFrameSpec, 'previousFrameId' | 'nextFrameId'>[];
    linesByFrameId: Map<string, TypesetLine[]>;
  } {
    const frames: Omit<IdmlTextFrameSpec, 'previousFrameId' | 'nextFrameId'>[] = [];
    const linesByFrameId = new Map<string, TypesetLine[]>();
    const { geometry } = page;
    const mTop = geometry.marginTop;
    const mLeft = geometry.marginInside;
    const mRight = geometry.pageWidth - geometry.marginOutside;
    const contentW = mRight - mLeft;
    const tp = page.designSettings?.titlePage;
    if (!tp?.enabled) return { frames, linesByFrameId };
    const rows = layoutTitlePageFields(tp, page.headerTitle || 'ספר קודש', geometry.pageHeight);
    if (rows.length === 0) return { frames, linesByFrameId };
    const lines: TypesetLine[] = rows.map((row, idx) => {
      const fontSizePt = row.fontSizePt;
      const ascent = fontSizePt;
      const descent = fontSizePt * 0.25;
      const yBaseline = row.yBaselinePt - mTop;
      const role: ContentRole =
        row.fieldId === 'title' ? 'main_title' : row.fieldId === 'subtitle' ? 'subtitle' : 'regular_paragraph';
      return {
        lineIndex: idx,
        words: [
          {
            text: row.text,
            glyphs: [],
            width: row.text.length * fontSizePt * 0.5,
            isSpace: false,
            isBold: row.isBold,
          },
        ],
        width: contentW,
        targetWidth: contentW,
        xStart: 0,
        xLeft: 0,
        xRight: contentW,
        yBaseline,
        yTop: yBaseline - ascent,
        yBottom: yBaseline + descent,
        height: fontSizePt * 1.2,
        ascent,
        descent,
        isLastLine: true,
        isJustified: false,
        extraSpacePerWord: 0,
        role,
        unitId:
          row.fieldId === 'extra' ? `cover-extra-${row.extraIndex ?? 0}` : `cover-${row.fieldId}`,
        fontFamily: row.fontFamily || undefined,
        fontSizePt,
        paragraphAlignment: row.alignment,
        leadingPt: fontSizePt * 1.2,
      };
    });
    // v0.8.0 Part E (#51): a custom border image has no IDML image-link
    // machinery behind it (no Links/ folder, no <Image> items), so it
    // would vanish silently from the export. Note it in the title frame
    // instead — same honest-note pattern as image pages — naming the file
    // so it can be placed by hand in InDesign.
    if (tp.customBorderImage) {
      const noteText = `[מסגרת תמונה: ${tp.customBorderImage.fileName} — לא הוטמעה בייצוא IDML; יש להוסיף אותה ידנית ב-InDesign]`;
      const noteSize = 11;
      const lastBottom = Math.max(...lines.map(l => l.yBottom ?? l.yBaseline + l.descent));
      const yBaseline = lastBottom + 24;
      lines.push({
        lineIndex: lines.length,
        words: [{ text: noteText, glyphs: [], width: noteText.length * noteSize * 0.5, isSpace: false }],
        width: contentW,
        targetWidth: contentW,
        xStart: 0,
        xLeft: 0,
        xRight: contentW,
        yBaseline,
        yTop: yBaseline - noteSize,
        yBottom: yBaseline + noteSize * 0.25,
        height: noteSize * 1.2,
        ascent: noteSize,
        descent: noteSize * 0.25,
        isLastLine: true,
        isJustified: false,
        extraSpacePerWord: 0,
        role: 'regular_paragraph',
        unitId: 'cover-border-note',
        fontSizePt: noteSize,
        leadingPt: noteSize * 1.2,
      });
    }
    const bands: IdmlPolygonBand[] = lines.map(l => ({
      yTop: Number((mTop + (l.yTop ?? l.yBaseline - l.ascent)).toFixed(2)),
      yBottom: Number(
        Math.max(mTop + (l.yTop ?? 0) + 12, mTop + (l.yBottom ?? l.yBaseline + l.descent)).toFixed(2)
      ),
      xLeft: mLeft,
      xRight: mRight,
    }));
    const minY = Math.min(...bands.map(b => b.yTop));
    const maxY = Math.max(...bands.map(b => b.yBottom));
    const frameId = `tf_title_p${pageIndex}`;
    frames.push({
      id: frameId,
      storyId: 'u_story_title',
      pageIndex,
      yTop: minY,
      xLeft: mLeft,
      yBottom: maxY,
      xRight: mRight,
      roleLabel: 'title_page',
      polygonBands: bands,
      polygonPoints: this.bandsToPolygonPoints(bands),
      textWrapMode: 'None',
      textWrapOffsets: { top: 0, left: 0, bottom: 0, right: 0 },
      ignoreWrap: false,
    });
    linesByFrameId.set(frameId, lines);
    return { frames, linesByFrameId };
  }

  /**
   * v0.8.0 Part E — image-only pages in IDML.
   *
   * IDML cannot embed the image binary without a Links/Images pipeline
   * (see AUDIT #51 — not built yet), so an image page would otherwise
   * export as a silently blank spread. Instead, emit one honest note
   * frame per image naming the file and saying it must be placed by hand
   * in InDesign. No silent loss; the image itself stays in the PDF.
   */
  public static computeImagePageFrames(
    page: PageTypesetResult,
    pageIndex: number
  ): {
    frames: Omit<IdmlTextFrameSpec, 'previousFrameId' | 'nextFrameId'>[];
    linesByFrameId: Map<string, TypesetLine[]>;
  } {
    const frames: Omit<IdmlTextFrameSpec, 'previousFrameId' | 'nextFrameId'>[] = [];
    const linesByFrameId = new Map<string, TypesetLine[]>();
    const images = page.pageImages ?? [];
    if (images.length === 0) return { frames, linesByFrameId };
    const { geometry } = page;
    const mTop = geometry.marginTop;
    const mLeft = geometry.marginInside;
    const mRight = geometry.pageWidth - geometry.marginOutside;
    const contentW = mRight - mLeft;
    const fontSizePt = 11;
    const ascent = fontSizePt;
    const descent = fontSizePt * 0.25;
    const lines: TypesetLine[] = images.map((img, idx) => {
      const text = `[תמונה: ${img.fileName ?? 'image'} — לא הוטמעה בייצוא IDML; יש להוסיף אותה ידנית ב-InDesign]`;
      const yBaseline = mTop + 24 + idx * 20;
      return {
        lineIndex: idx,
        words: [{ text, glyphs: [], width: text.length * fontSizePt * 0.5, isSpace: false }],
        width: contentW,
        targetWidth: contentW,
        xStart: 0,
        xLeft: 0,
        xRight: contentW,
        yBaseline,
        yTop: yBaseline - ascent,
        yBottom: yBaseline + descent,
        height: fontSizePt * 1.2,
        ascent,
        descent,
        isLastLine: true,
        isJustified: false,
        extraSpacePerWord: 0,
        role: 'regular_paragraph' as ContentRole,
        unitId: page.imageUnitIds?.[idx] ?? `image-p${pageIndex}-${idx}`,
        fontSizePt,
        leadingPt: fontSizePt * 1.2,
      };
    });
    const bands: IdmlPolygonBand[] = lines.map(l => ({
      yTop: Number((l.yTop ?? l.yBaseline - l.ascent).toFixed(2)),
      yBottom: Number(Math.max((l.yTop ?? 0) + 12, l.yBottom ?? l.yBaseline + l.descent).toFixed(2)),
      xLeft: mLeft,
      xRight: mRight,
    }));
    const minY = Math.min(...bands.map(b => b.yTop));
    const maxY = Math.max(...bands.map(b => b.yBottom));
    const frameId = `tf_image_p${pageIndex}`;
    frames.push({
      id: frameId,
      storyId: `u_story_image_p${pageIndex}`,
      pageIndex,
      yTop: minY,
      xLeft: mLeft,
      yBottom: maxY,
      xRight: mRight,
      roleLabel: 'image_note',
      polygonBands: bands,
      polygonPoints: this.bandsToPolygonPoints(bands),
      textWrapMode: 'None',
      textWrapOffsets: { top: 0, left: 0, bottom: 0, right: 0 },
      ignoreWrap: false,
    });
    linesByFrameId.set(frameId, lines);
    return { frames, linesByFrameId };
  }

  public static computePageTextFrames(
    page: PageTypesetResult,
    pageIndex: number
  ): {
    frames: Omit<IdmlTextFrameSpec, 'previousFrameId' | 'nextFrameId'>[];
    linesByFrameId: Map<string, TypesetLine[]>;
  } {
    const { geometry } = page;
    const mTop = geometry.marginTop;
    const mLeft = geometry.marginInside;
    const mRight = geometry.pageWidth - geometry.marginOutside;
    const contentW = mRight - mLeft;
    // v0.8.0 Part C (§7): content height for the Michtav box geometry.
    const contentH = geometry.pageHeight - geometry.marginTop - geometry.marginBottom;

    const frames: Omit<IdmlTextFrameSpec, 'previousFrameId' | 'nextFrameId'>[] = [];
    const linesByFrameId = new Map<string, TypesetLine[]>();

    // Extract contiguous horizontal bands for a stream of solved lines
    const buildStreamBands = (
      lines: TypesetLine[],
      defaultXLeft: number,
      defaultXRight: number
    ): IdmlPolygonBand[] => {
      const bands: IdmlPolygonBand[] = [];
      for (const l of lines) {
        const xL = Number((l.xLeft !== undefined ? mLeft + l.xLeft : defaultXLeft).toFixed(2));
        const xR = Number((l.xRight !== undefined ? mLeft + l.xRight : defaultXRight).toFixed(2));
        const yT = Number(
          (mTop + (l.yTop !== undefined ? l.yTop : l.yBaseline - l.ascent)).toFixed(2)
        );
        const yB = Number(
          (mTop + (l.yBottom !== undefined ? l.yBottom : l.yBaseline + l.descent)).toFixed(2)
        );

        if (bands.length === 0) {
          bands.push({
            yTop: yT,
            yBottom: Math.max(yT + 12, yB),
            xLeft: xL,
            xRight: Math.max(xL + 20, xR),
          });
        } else {
          const prev = bands[bands.length - 1];
          if (Math.abs(xL - prev.xLeft) <= 2.0 && Math.abs(xR - prev.xRight) <= 2.0) {
            prev.yBottom = Math.max(prev.yBottom, yB);
          } else {
            const stepY = Number(Math.max(prev.yBottom, yT).toFixed(2));
            prev.yBottom = stepY;
            bands.push({
              yTop: stepY,
              yBottom: Math.max(stepY + 12, yB),
              xLeft: xL,
              xRight: Math.max(xL + 20, xR),
            });
          }
        }
      }
      return bands;
    };

    const createUnifiedPolygonFrame = (
      lines: TypesetLine[],
      bands: IdmlPolygonBand[],
      streamPrefix: string,
      storyId: string,
      options: {
        textWrapMode?: 'None' | 'Contour' | 'BoundingBoxTextWrap';
        textWrapOffsets?: { top: number; left: number; bottom: number; right: number };
        ignoreWrap?: boolean;
      } = {}
    ) => {
      if (!lines || lines.length === 0 || bands.length === 0) return;

      const minX = Math.min(...bands.map(b => b.xLeft));
      const maxX = Math.max(...bands.map(b => b.xRight));
      const minY = Math.min(...bands.map(b => b.yTop));
      const maxY = Math.max(...bands.map(b => b.yBottom));
      const polygonPoints = this.bandsToPolygonPoints(bands);

      const frameId = `tf_${streamPrefix}_p${pageIndex}`;
      frames.push({
        id: frameId,
        storyId,
        pageIndex,
        yTop: Number(minY.toFixed(2)),
        xLeft: Number(minX.toFixed(2)),
        yBottom: Number(Math.max(minY + 12, maxY).toFixed(2)),
        xRight: Number(Math.max(minX + 20, maxX).toFixed(2)),
        roleLabel: streamPrefix,
        polygonBands: bands,
        polygonPoints,
        textWrapMode: options.textWrapMode ?? 'None',
        textWrapOffsets: options.textWrapOffsets ?? { top: 0, left: 0, bottom: 0, right: 0 },
        ignoreWrap: options.ignoreWrap ?? false,
      });
      linesByFrameId.set(frameId, lines);
    };

    if (page.layoutType === 'single_column') {
      if (page.sourceLines.length > 0) {
        const srcBands = buildStreamBands(page.sourceLines, mLeft, mRight);
        createUnifiedPolygonFrame(page.sourceLines, srcBands, 'src', 'u_story_source');
      }
    } else if (page.layoutType === 'two_column') {
      const colGutter = 16.0;
      const colW = (contentW - colGutter) / 2.0;
      if (page.sourceLines.length > 0) {
        const col1Bands = buildStreamBands(page.sourceLines, mRight - colW, mRight);
        createUnifiedPolygonFrame(page.sourceLines, col1Bands, 'col1', 'u_story_source');
      }
      if (page.column2Lines && page.column2Lines.length > 0) {
        const col2Bands = buildStreamBands(page.column2Lines, mLeft, mLeft + colW);
        createUnifiedPolygonFrame(page.column2Lines, col2Bands, 'col2', 'u_story_source');
      }
    } else if (page.layoutType === 'source_top_commentary_bottom') {
      const colGutter = 14.0;
      const colW = (contentW - colGutter) / 2.0;
      if (page.sourceLines.length > 0) {
        const srcBands = buildStreamBands(page.sourceLines, mLeft, mRight);
        createUnifiedPolygonFrame(page.sourceLines, srcBands, 'src', 'u_story_source', {
          textWrapMode: 'Contour',
          textWrapOffsets: { top: 0, left: 0, bottom: 6, right: 0 },
        });
      }
      if (page.rashiLines.length > 0) {
        const rashiBands = buildStreamBands(page.rashiLines, mRight - colW, mRight);
        createUnifiedPolygonFrame(page.rashiLines, rashiBands, 'rashi', 'u_story_rashi');
      }
      if (page.tosafotLines.length > 0) {
        const tosaBands = buildStreamBands(page.tosafotLines, mLeft, mLeft + colW);
        createUnifiedPolygonFrame(page.tosafotLines, tosaBands, 'tosa', 'u_story_tosafot');
      }
    } else if (page.layoutType === 'custom_layout') {
      // v0.8.0 Part E (#44): one IDML frame per custom box, not one frame
      // per stream. Lines carry `customLayoutBoxId`; grouping by it keeps
      // the box structure editable in InDesign (frames of one story
      // thread together via the shared story id). Rotation is NOT
      // exported: the canvas rotation is frame-outline-only (see item 6),
      // so the IDML frame is the axis-aligned box the text actually flows
      // in. Lines with no box id fall back to a single full-width frame.
      const allLines = [
        ...page.sourceLines,
        ...page.rashiLines,
        ...page.tosafotLines,
        ...(page.column2Lines ?? []),
      ];
      const byBox = new Map<string, TypesetLine[]>();
      const unboxed: TypesetLine[] = [];
      for (const l of allLines) {
        const id = l.customLayoutBoxId;
        if (id) {
          const arr = byBox.get(id) ?? [];
          arr.push(l);
          byBox.set(id, arr);
        } else {
          unboxed.push(l);
        }
      }
      const storyForRole = (role: ContentRole): string =>
        role === 'primary_comment'
          ? 'u_story_rashi'
          : role === 'secondary_comment'
            ? 'u_story_tosafot'
            : 'u_story_source';
      for (const [boxId, lines] of byBox) {
        const bands = buildStreamBands(lines, mLeft, mRight);
        const safeId = boxId.replace(/[^A-Za-z0-9_-]/g, '_');
        createUnifiedPolygonFrame(
          lines,
          bands,
          `box_${safeId}`,
          storyForRole(lines[0].role)
        );
      }
      if (unboxed.length > 0) {
        const bands = buildStreamBands(unboxed, mLeft, mRight);
        createUnifiedPolygonFrame(unboxed, bands, 'src', 'u_story_source');
      }
    } else {
      // Classic Rav-Text / Mikraot Gedolot:
      // Build one unified stepped polygon per stream + active Contour TextWrap on central Source!
      const rashiW = page.knee.rightCommentaryWidth;
      const tosafotW = page.knee.leftCommentaryWidth;
      const gutter = page.knee.gutterWidth;
      const rashiLeft = mRight - rashiW;
      const sourceRight = rashiLeft - gutter;
      const sourceLeft = sourceRight - page.knee.upperSourceWidth;
      const tosafotRight = mLeft + tosafotW;

      const srcBands = buildStreamBands(page.sourceLines, sourceLeft, sourceRight);
      const rashiBands = buildStreamBands(page.rashiLines, rashiLeft, mRight);
      const tosaBands = buildStreamBands(page.tosafotLines, mLeft, tosafotRight);

      // Synchronize horizontal step Y junctions between Source and Rashi/Tosafot so stepped polygon corners never intersect
      for (const sb of srcBands) {
        for (const cb of [...rashiBands, ...tosaBands]) {
          const xO = Math.min(sb.xRight, cb.xRight) - Math.max(sb.xLeft, cb.xLeft);
          const yO = Math.min(sb.yBottom, cb.yBottom) - Math.max(sb.yTop, cb.yTop);
          if (xO > 0 && yO > 0) {
            if (sb.yBottom > cb.yTop && sb.yTop < cb.yTop) {
              sb.yBottom = Number((cb.yTop - 0.5).toFixed(2));
            } else if (cb.yBottom > sb.yTop && cb.yTop < sb.yTop) {
              cb.yBottom = Number((sb.yTop - 0.5).toFixed(2));
            }
          }
        }
      }

      // Emit commentary frames first, then the central Source exclusion frame with active Contour TextWrap!
      if (page.rashiLines.length > 0) {
        createUnifiedPolygonFrame(page.rashiLines, rashiBands, 'rashi', 'u_story_rashi', {
          textWrapMode: 'None',
          ignoreWrap: false,
        });
      }
      if (page.tosafotLines.length > 0) {
        createUnifiedPolygonFrame(page.tosafotLines, tosaBands, 'tosa', 'u_story_tosafot', {
          textWrapMode: 'None',
          ignoreWrap: false,
        });
      }
      if (page.sourceLines.length > 0) {
        createUnifiedPolygonFrame(page.sourceLines, srcBands, 'src', 'u_story_source', {
          textWrapMode: 'Contour',
          textWrapOffsets: {
            top: 4,
            left: Math.max(4, Number((gutter - 1).toFixed(1))),
            bottom: 4,
            right: Math.max(4, Number((gutter - 1).toFixed(1))),
          },
          ignoreWrap: false,
        });
      }
    }

    // v0.8.0 Part C (§1): tertiary band — its own full-width frame, like
    // the footnotes. Placed before the footnote block so the footnote
    // top is pushed below it (the footnote code takes maxBodyBottom from
    // the frames built so far).
    if (page.tertiaryLines && page.tertiaryLines.length > 0) {
      const terBands = buildStreamBands(page.tertiaryLines, mLeft, mRight);
      createUnifiedPolygonFrame(page.tertiaryLines, terBands, 'ter', 'u_story_tertiary', {
        textWrapMode: 'None',
        ignoreWrap: true,
      });
    }

    // v0.8.0 Part C (§7): the Michtav box as a simple centred text frame
    // (one synthetic line carrying the box text at the box geometry).
    if (page.michtavBox) {
      const mb = page.michtavBox;
      const mbText = mb.text ?? '';
      const mbXLeft = mLeft + (mb.xPct / 100) * contentW;
      const mbXRight = mLeft + ((mb.xPct + mb.widthPct) / 100) * contentW;
      const mbFontSize = Math.max(10, ((mb.heightPct / 100) * contentH) * 0.4);
      const mbLine: TypesetLine = {
        lineIndex: 0,
        words: [
          {
            text: mbText,
            glyphs: [],
            width: Math.max(20, mbText.length * mbFontSize * 0.55),
            isSpace: false,
            isBold: true,
            fontSizePt: mbFontSize,
          },
        ],
        width: mbXRight - mbXLeft,
        targetWidth: mbXRight - mbXLeft,
        xStart: 0,
        xLeft: (mb.xPct / 100) * contentW,
        xRight: ((mb.xPct + mb.widthPct) / 100) * contentW,
        yBaseline: ((mb.yPct + mb.heightPct / 2) / 100) * contentH + mbFontSize * 0.3,
        yTop: (mb.yPct / 100) * contentH,
        yBottom: ((mb.yPct + mb.heightPct) / 100) * contentH,
        height: (mb.heightPct / 100) * contentH,
        ascent: mbFontSize * 0.82,
        descent: mbFontSize * 0.24,
        isLastLine: true,
        isJustified: false,
        extraSpacePerWord: 0,
        role: 'main_title',
        unitId: 'michtav',
        fontSizePt: mbFontSize,
      };
      const mbBands = buildStreamBands([mbLine], mbXLeft, mbXRight);
      createUnifiedPolygonFrame([mbLine], mbBands, 'michtav', 'u_story_michtav', {
        textWrapMode: 'None',
        ignoreWrap: true,
      });
    }

    if (page.footnoteLines && page.footnoteLines.length > 0) {
      const fnBands = buildStreamBands(page.footnoteLines, mLeft, mRight);
      const maxBodyBottom =
        frames.length > 0 ? Math.max(...frames.map(f => f.yBottom)) : mTop;
      const rawFnTop = Math.min(...fnBands.map(b => b.yTop));
      const rawFnBottom = Math.max(...fnBands.map(b => b.yBottom));
      const safeFnTop = Number(Math.max(rawFnTop, maxBodyBottom + 2.0).toFixed(2));
      const safeFnBottom = Number(
        Math.max(safeFnTop + 12.0, Math.min(geometry.pageHeight - 8, rawFnBottom)).toFixed(2)
      );
      const adjustedFnBands: IdmlPolygonBand[] = [
        { yTop: safeFnTop, yBottom: safeFnBottom, xLeft: mLeft, xRight: mRight },
      ];
      createUnifiedPolygonFrame(
        page.footnoteLines,
        adjustedFnBands,
        'fn',
        'u_story_footnotes',
        { textWrapMode: 'None', ignoreWrap: true }
      );
    }

    return { frames, linesByFrameId };
  }

  /**
   * Generates an Adobe InDesign IDML package at any of the 6 incremental validation stages:
   * - `test_a_minimal`: 1 page, 1 frame, 1 paragraph (`מסכת ברכות`)
   * - `test_b_styled_lines`: 1 page, 1 frame, multiple lines + bold Dibbur styles
   * - `test_c_rav_text`: 1 page, 3 unified polygon frames (Source, Rashi, Tosafot), non-overlapping Rav-Text geometry
   * - `test_d_multi_page`: Multi-page spreads + threaded stories without footnotes
   * - `test_e_full`: Full multi-page document with Rav-Text, threaded stories, and footnotes
   * - `test_f_true_rav_text_flow`: True Rav-Text Flow with custom stepped `<PathGeometry>` commentary & central Source `TextWrapMode="Contour"` exclusion
   */
  public static async generateIncrementalStageIdml(
    bookDoc: BookTypesetDocument,
    stage: IdmlIncrementalStage = 'test_f_true_rav_text_flow'
  ): Promise<Blob> {
    if (stage === 'test_a_minimal') {
      return this.generateMinimalKnownGoodIdml('מסכת ברכות');
    }

    // Clone or filter bookDoc according to incremental stage
    const filteredPages: PageTypesetResult[] = (
      stage === 'test_b_styled_lines' || stage === 'test_c_rav_text'
        ? bookDoc.pages.slice(0, 1)
        : bookDoc.pages
    ).map(p => ({
      ...p,
      rashiLines: stage === 'test_b_styled_lines' ? [] : p.rashiLines,
      tosafotLines: stage === 'test_b_styled_lines' ? [] : p.tosafotLines,
      footnoteLines:
        stage === 'test_e_full' || stage === 'test_f_true_rav_text_flow'
          ? p.footnoteLines
          : [],
    }));

    return this.generateMultiPageIdml({
      ...bookDoc,
      pages: filteredPages,
      totalPages: filteredPages.length,
    });
  }

  /**
   * Generates a structurally valid, multi-page, fully editable Adobe InDesign IDML package (.idml)
   * built directly on top of Adobe InDesign's canonical `ADOBE_IDML_REFERENCE_FILES` DOMVersion="8.0"
   * structure and packaged via `packUcfIdmlZip`.
   */
  public static async generateMultiPageIdml(bookDoc: BookTypesetDocument): Promise<Blob> {
    // Stage 12 Level 0 Enforcement: Never knowingly export an IDML document with unresolved layout loss or Engine Hard Rule violations
    const totalPlacedOrnaments = bookDoc.pages.reduce(
      (s, p) => s + (p.placedOrnaments?.length ?? 0),
      0
    );
    EngineHardRulesEngine.assertExportAllowed({
      bookDoc,
      links: bookDoc.links,
      userSuppliedOrnamentsCount: totalPlacedOrnaments,
    });

    const { pages, geometry } = bookDoc;

    // Collect all non-overlapping frames across all pages and group lines by global threaded Story
    const allPageFrames: IdmlTextFrameSpec[][] = [];
    // v0.6.0 Part C (§8): the title-page border as graphic frames,
    // one rect list per page (empty for body pages).
    const allPageRectangles: IdmlBorderRectSpec[][] = [];
    const framesByStoryId = new Map<string, IdmlTextFrameSpec[]>();
    const linesByStoryId = new Map<string, TypesetLine[]>();

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      if (!page) {
        allPageFrames.push([]);
        allPageRectangles.push([]);
        continue;
      }
      // v0.5.0 (Title Page): the synthetic first page has no typeset
      // lines — its frames + lines are fabricated from the shared field
      // layout (see computeTitlePageFrames), so the title text flows as
      // the first story. v0.6.0 Part C (§8): the border is now emitted
      // too, as graphic frames (see computeTitlePageBorderRects).
      // v0.8.0 Part E: image-only pages get an honest note frame naming
      // each image (see computeImagePageFrames) instead of a blank spread.
      const { frames: rawFrames, linesByFrameId } = page.isTitlePage
        ? this.computeTitlePageFrames(page, i)
        : page.isImageOnlyPage
          ? this.computeImagePageFrames(page, i)
          : this.computePageTextFrames(page, i);
      const pageSpecs: IdmlTextFrameSpec[] = rawFrames.map(rf => ({
        ...rf,
        previousFrameId: 'n',
        nextFrameId: 'n',
      }));
      allPageFrames.push(pageSpecs);
      allPageRectangles.push(this.computeTitlePageBorderRects(page, i, geometry));

      for (const spec of pageSpecs) {
        if (!framesByStoryId.has(spec.storyId)) {
          framesByStoryId.set(spec.storyId, []);
          linesByStoryId.set(spec.storyId, []);
        }
        framesByStoryId.get(spec.storyId)!.push(spec);
        const fLines = linesByFrameId.get(spec.id) ?? [];
        linesByStoryId.get(spec.storyId)!.push(...fLines);
      }
    }

    // Wire PreviousTextFrame and NextTextFrame threading links within each Story
    for (const storyFrames of framesByStoryId.values()) {
      for (let idx = 0; idx < storyFrames.length; idx++) {
        storyFrames[idx].previousFrameId = idx > 0 ? storyFrames[idx - 1].id : 'n';
        storyFrames[idx].nextFrameId =
          idx < storyFrames.length - 1 ? storyFrames[idx + 1].id : 'n';
      }
    }

    const storyList = Array.from(framesByStoryId.keys());
    const spreadIds = pages.map((_, i) => `u${100 + i}`);
    const firstPageId = 'page_1';

    // 1. Build `designmap.xml` from Adobe's canonical `ADOBE_IDML_REFERENCE_FILES['designmap.xml']`
    //    preserving all Language definitions, NumberingList, NamedGrid, TextVariables, Layer uc3, Section ucc,
    //    CrossReferenceFormats, IndexingSortOptions, ABullets, and Assignment ud4!
    let designmapXml = ADOBE_IDML_REFERENCE_FILES['designmap.xml'];
    // Update StoryList attribute on <Document ...> (always include BackingStory ua8 at the end, just like Adobe)
    const fullStoryListAttr = [...storyList, 'ua8'].join(' ');
    designmapXml = designmapXml.replace(
      /StoryList="[^"]*"/,
      `StoryList="${fullStoryListAttr}"`
    );
    // Replace single `<idPkg:Spread src="Spreads/Spread_uc6.xml" />` with our spreads
    const spreadPkgLines = spreadIds
      .map(sId => `\t<idPkg:Spread src="Spreads/Spread_${sId}.xml" />`)
      .join('\n');
    designmapXml = designmapXml.replace(
      /\t<idPkg:Spread src="Spreads\/Spread_uc6\.xml"\s*\/>/,
      spreadPkgLines
    );
    // Update `<Section Self="ucc" Length="..." ... PageStart="...">` to match our page count and first page ID
    designmapXml = designmapXml.replace(
      /<Section Self="ucc" Length="\d+" AlternateLayoutLength="\d+"([^>]*?)PageStart="[^"]*"/,
      `<Section Self="ucc" Length="${Math.max(1, pages.length)}" AlternateLayoutLength="${Math.max(1, pages.length)}"$1PageStart="${firstPageId}"`
    );
    // Replace `<idPkg:Story src="Stories/Story_udc.xml" />` with our story references
    const storyPkgLines = storyList
      .map(sId => `\t<idPkg:Story src="Stories/Story_${sId}.xml" />`)
      .join('\n');
    designmapXml = designmapXml.replace(
      /\t<idPkg:Story src="Stories\/Story_udc\.xml"\s*\/>/,
      storyPkgLines
    );

    // 2. Build Stories first so we collect all custom color swatches and font families actually used in the document
    const designSettings = bookDoc.designSettings ?? pages[0]?.designSettings;
    const customColorSwatches = new Map<string, [number, number, number]>();
    // v0.6.0 Part C (§8): the title-page border stroke colour — the
    // same dark ink (#2A2622) the PDF uses for the frame.
    if (allPageRectangles.some(r => r.length > 0)) {
      customColorSwatches.set('Color/KeterBorder', [42, 38, 34]);
    }
    const usedFontFamilies = new Set<string>([
      'Frank Ruhl Libre',
      'Noto Rashi Hebrew',
      'David Libre',
    ]);
    if (bookDoc.sourceFontFamily) usedFontFamilies.add(bookDoc.sourceFontFamily);
    if (bookDoc.rashiFontFamily) usedFontFamilies.add(bookDoc.rashiFontFamily);
    if (bookDoc.tosafotFontFamily) usedFontFamilies.add(bookDoc.tosafotFontFamily);

    const resolveRoleStyleAttrs = (
      roleKey: string,
      fallbackFont: string,
      fallbackSize: number,
      fallbackLeading: number,
      fallbackAlign: 'justify' | 'right' | 'center' | 'left' = 'justify',
      fallbackWeight: number = 400
    ) => {
      const roleStyle = designSettings?.roleStyles?.[roleKey];
      const c = roleStyle?.character;
      const p = roleStyle?.paragraph;
      const fontFamily =
        roleKey === 'footnote'
          ? designSettings?.footnotes?.fontFamily || c?.fontFamily || fallbackFont
          : c?.fontFamily || fallbackFont;
      usedFontFamilies.add(fontFamily);

      const pointSize =
        roleKey === 'footnote'
          ? designSettings?.footnotes?.fontSizePt ?? c?.fontSizePt ?? fallbackSize
          : c?.fontSizePt ?? fallbackSize;
      const ratio =
        p && Number.isFinite(p.lineSpacingRatio) && p.lineSpacingRatio > 0
          ? p.lineSpacingRatio
          : 1.28;
      const leading =
        roleKey === 'footnote'
          ? designSettings?.footnotes?.leadingPt ??
            (p?.leadingMode === 'fixed' && p?.leadingPt > 0
              ? p.leadingPt
              : Number((pointSize * ratio).toFixed(2)))
          : p
          ? p.leadingMode === 'fixed' && p.leadingPt > 0
            ? p.leadingPt
            : Number((pointSize * ratio).toFixed(2))
          : fallbackLeading;

      const align = p?.alignment ?? fallbackAlign;
      const lastAlign = p?.lastLineAlignment ?? 'right';
      let justification = 'RightJustified';
      if (align === 'center') justification = 'CenterAlign';
      else if (align === 'right') justification = 'RightAlign';
      else if (align === 'left') justification = 'LeftAlign';
      else {
        justification =
          lastAlign === 'center'
            ? 'CenterJustified'
            : lastAlign === 'left'
            ? 'LeftJustified'
            : lastAlign === 'justify'
            ? 'FullyJustified'
            : 'RightJustified';
      }

      const fontStyle = this.resolveIdmlFontStyle(
        c?.fontWeight ?? fallbackWeight,
        c?.isBold,
        c?.isItalic
      );
      const underlineAttr = c?.isUnderline ? ` Underline="true"` : '';
      const trackingAttr =
        c?.trackingEm !== undefined && c.trackingEm !== 0
          ? ` Tracking="${Math.round(c.trackingEm * 1000)}"`
          : '';
      const scaleAttr =
        c?.horizontalScalePercent && c.horizontalScalePercent !== 100
          ? ` HorizontalScale="${c.horizontalScalePercent}"`
          : '';
      const baselineAttr =
        c?.baselineShiftPt ? ` BaselineShift="${c.baselineShiftPt}"` : '';
      const wordSpaceAttr =
        c?.wordSpacingRatio !== undefined && Math.abs(c.wordSpacingRatio - 1.0) > 0.005
          ? ` DesiredWordSpacing="${Math.round(c.wordSpacingRatio * 100)}"`
          : '';

      const swatch = this.normalizeHexColorToIdmlSwatch(c?.textColor);
      let fillColorAttr = '';
      if (swatch) {
        fillColorAttr = ` FillColor="${swatch.swatchId}"`;
        customColorSwatches.set(swatch.swatchId, swatch.rgb);
      }

      const hangPt = Math.max(0, p?.hangingIndentPt ?? 0);
      const firstPt = Math.max(0, p?.firstLineIndentPt ?? 0);
      const baseRightPt =
        roleKey === 'footnote'
          ? Math.max(0, designSettings?.footnotes?.indentPt ?? p?.rightIndentPt ?? 0)
          : Math.max(0, p?.rightIndentPt ?? 0);
      const effRightIndent = baseRightPt + hangPt;
      const effFirstIndent = hangPt > 0 && firstPt === 0 ? -hangPt : firstPt;

      const indentAttrs: string[] = [];
      if (effFirstIndent !== 0) indentAttrs.push(`FirstLineIndent="${effFirstIndent}"`);
      if (effRightIndent !== 0) indentAttrs.push(`RightIndent="${effRightIndent}"`);
      if (p?.leftIndentPt) indentAttrs.push(`LeftIndent="${p.leftIndentPt}"`);
      if (p?.spaceBeforePt) indentAttrs.push(`SpaceBefore="${p.spaceBeforePt}"`);
      if (p?.spaceAfterPt !== undefined) indentAttrs.push(`SpaceAfter="${p.spaceAfterPt}"`);
      const extraParaAttrs = indentAttrs.length > 0 ? ' ' + indentAttrs.join(' ') : '';

      return {
        fontFamily,
        pointSize,
        leading,
        justification,
        fontStyle,
        charAttrs: `${underlineAttr}${trackingAttr}${scaleAttr}${baselineAttr}${wordSpaceAttr}${fillColorAttr}`,
        extraParaAttrs,
      };
    };

    const srcStyle = resolveRoleStyleAttrs(
      'main_source',
      bookDoc.sourceFontFamily || 'Frank Ruhl Libre',
      14.5,
      18,
      'justify',
      400
    );
    const rashiStyle = resolveRoleStyleAttrs(
      'primary_comment',
      bookDoc.rashiFontFamily || 'Noto Rashi Hebrew',
      10.5,
      13.5,
      'justify',
      400
    );
    const tosafotStyle = resolveRoleStyleAttrs(
      'secondary_comment',
      bookDoc.tosafotFontFamily || 'Frank Ruhl Libre',
      10.5,
      13.5,
      'justify',
      400
    );
    const headingStyle = resolveRoleStyleAttrs(
      'chapter',
      bookDoc.sourceFontFamily || 'Frank Ruhl Libre',
      16,
      22,
      'center',
      700
    );
    const footnoteStyle = resolveRoleStyleAttrs(
      'footnote',
      bookDoc.sourceFontFamily || 'Frank Ruhl Libre',
      9.5,
      12.5,
      'right',
      400
    );

    // 9. Build `Stories/Story_XXX.xml` for each threaded Story with Adobe's `<InCopyExportOption>` and `<XMLElement>` wrapper
    const storyEntries: Array<{ name: string; content: string }> = [];
    for (let idx = 0; idx < storyList.length; idx++) {
      const storyId = storyList[idx];
      const sLines = linesByStoryId.get(storyId) ?? [];
      const defaultPStyle =
        storyId === 'u_story_rashi'
          ? 'ParagraphStyle/KeterRashi'
          : storyId === 'u_story_tosafot'
          ? 'ParagraphStyle/KeterTosafot'
          : storyId === 'u_story_footnotes'
          ? 'ParagraphStyle/KeterFootnote'
          : 'ParagraphStyle/KeterSource';

      const paragraphRangesXml = this.buildStoryParagraphRangesXml(
        sLines,
        defaultPStyle,
        customColorSwatches,
        usedFontFamilies
      );
      const storyXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:Story xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="8.0">
\t<Story Self="${storyId}" AppliedTOCStyle="n" TrackChanges="false" StoryTitle="$ID/" AppliedNamedGrid="n">
\t\t<StoryPreference OpticalMarginAlignment="false" OpticalMarginSize="12" FrameType="TextFrameType" StoryOrientation="Horizontal" StoryDirection="RightToLeftDirection" />
\t\t<InCopyExportOption IncludeGraphicProxies="true" IncludeAllResources="false" />
\t\t<XMLElement Self="di2i${idx + 3}" MarkupTag="XMLTag/dynamic_content" XMLContent="${storyId}">
${paragraphRangesXml}
\t\t</XMLElement>
\t</Story>
</idPkg:Story>`;

      storyEntries.push({
        name: `Stories/Story_${storyId}.xml`,
        content: storyXml,
      });
    }

    // 2. Build `Resources/Graphic.xml` from Adobe's canonical `Graphic.xml` + `Color/KeterBordeaux` + custom text colors
    const customColorsXmlLines: string[] = [
      `\t<Color Self="Color/KeterBordeaux" Model="Process" Space="CMYK" ColorValue="20 90 90 20" ColorOverride="Normal" AlternateSpace="NoAlternateColor" AlternateColorValue="" Name="KeterBordeaux" ColorEditable="true" ColorRemovable="true" Visible="true" SwatchCreatorID="7937" />`,
    ];
    for (const [swatchId, [r, g, b]] of customColorSwatches.entries()) {
      const swatchName = swatchId.replace(/^Color\//, '');
      customColorsXmlLines.push(
        `\t<Color Self="${swatchId}" Model="Process" Space="RGB" ColorValue="${r} ${g} ${b}" ColorOverride="Normal" AlternateSpace="NoAlternateColor" AlternateColorValue="" Name="${swatchName}" ColorEditable="true" ColorRemovable="true" Visible="true" SwatchCreatorID="7937" />`
      );
    }
    const graphicXml = ADOBE_IDML_REFERENCE_FILES['Resources/Graphic.xml'].replace(
      '</idPkg:Graphic>',
      `${customColorsXmlLines.join('\n')}\n</idPkg:Graphic>`
    );

    // 3. Build `Resources/Fonts.xml` from Adobe's canonical `Fonts.xml` + all Hebrew font families used in the document
    const extraHebrewFontsXml = Array.from(usedFontFamilies)
      .filter(f => Boolean(f) && f !== 'Minion Pro' && f !== 'Arial')
      .map(fam => {
        const safeFam = this.escapeXml(fam);
        const psBase = safeFam.replace(/\s+/g, '');
        return `\t<FontFamily Self="FontFamily/${safeFam}" Name="${safeFam}">
\t\t<Font Self="Font/${safeFam}-Regular" FontFamily="${safeFam}" Name="${safeFam} Regular" PostScriptName="${psBase}-Regular" Status="Installed" FontStyleName="Regular" FontType="TrueType" WritingScript="2" FullName="${safeFam} Regular" FullNameNative="${safeFam} Regular" FontStyleNameNative="Regular" PlatformName="$ID/" Version="Version 1.0" />
\t\t<Font Self="Font/${safeFam}-Bold" FontFamily="${safeFam}" Name="${safeFam} Bold" PostScriptName="${psBase}-Bold" Status="Installed" FontStyleName="Bold" FontType="TrueType" WritingScript="2" FullName="${safeFam} Bold" FullNameNative="${safeFam} Bold" FontStyleNameNative="Bold" PlatformName="$ID/" Version="Version 1.0" />
\t\t<Font Self="Font/${safeFam}-Italic" FontFamily="${safeFam}" Name="${safeFam} Italic" PostScriptName="${psBase}-Italic" Status="Installed" FontStyleName="Italic" FontType="TrueType" WritingScript="2" FullName="${safeFam} Italic" FullNameNative="${safeFam} Italic" FontStyleNameNative="Italic" PlatformName="$ID/" Version="Version 1.0" />
\t</FontFamily>`;
      })
      .join('\n');
    const fontsXml = ADOBE_IDML_REFERENCE_FILES['Resources/Fonts.xml'].replace(
      '</idPkg:Fonts>',
      `${extraHebrewFontsXml}\n</idPkg:Fonts>`
    );

    // 4. Build `Resources/Styles.xml` from Adobe's canonical `Styles.xml`
    //    injecting our Keter character & paragraph styles into `RootCharacterStyleGroup` and `RootParagraphStyleGroup`
    //    while keeping Adobe's `RootObjectStyleGroup`, `RootTableStyleGroup`, `RootCellStyleGroup`, and `TrapPreset` intact!
    const dibburChar = designSettings?.roleStyles?.dibbur_hamatchil?.character;
    const dibburFontStyle = this.resolveIdmlFontStyle(
      dibburChar?.fontWeight ?? 700,
      dibburChar?.isBold ?? true,
      dibburChar?.isItalic ?? false
    );
    const customCharStylesXml = `\t\t<CharacterStyle Self="CharacterStyle/KeterDibburBold" Imported="false" Name="KeterDibburBold" FontStyle="${dibburFontStyle}" />
\t\t<CharacterStyle Self="CharacterStyle/KeterFootnoteRef" Imported="false" Name="KeterFootnoteRef" Position="Superscript" FillColor="Color/KeterBordeaux" />`;

    const customParaStylesXml = `\t\t<ParagraphStyle Self="ParagraphStyle/KeterSource" Name="KeterSource" Imported="false" NextStyle="ParagraphStyle/KeterSource" FontStyle="${srcStyle.fontStyle}" PointSize="${srcStyle.pointSize}" Justification="${srcStyle.justification}" ParagraphDirection="RightToLeftDirection" AppliedLanguage="$ID/Hebrew"${srcStyle.charAttrs}${srcStyle.extraParaAttrs}>
\t\t\t<Properties>
\t\t\t\t<BasedOn type="string">$ID/NormalParagraphStyle</BasedOn>
\t\t\t\t<PreviewColor type="enumeration">Nothing</PreviewColor>
\t\t\t\t<Leading type="unit">${srcStyle.leading}</Leading>
\t\t\t\t<AppliedFont type="string">${this.escapeXml(srcStyle.fontFamily)}</AppliedFont>
\t\t\t</Properties>
\t\t</ParagraphStyle>
\t\t<ParagraphStyle Self="ParagraphStyle/KeterRashi" Name="KeterRashi" Imported="false" NextStyle="ParagraphStyle/KeterRashi" FontStyle="${rashiStyle.fontStyle}" PointSize="${rashiStyle.pointSize}" Justification="${rashiStyle.justification}" ParagraphDirection="RightToLeftDirection" AppliedLanguage="$ID/Hebrew"${rashiStyle.charAttrs}${rashiStyle.extraParaAttrs}>
\t\t\t<Properties>
\t\t\t\t<BasedOn type="string">$ID/NormalParagraphStyle</BasedOn>
\t\t\t\t<PreviewColor type="enumeration">Nothing</PreviewColor>
\t\t\t\t<Leading type="unit">${rashiStyle.leading}</Leading>
\t\t\t\t<AppliedFont type="string">${this.escapeXml(rashiStyle.fontFamily)}</AppliedFont>
\t\t\t</Properties>
\t\t</ParagraphStyle>
\t\t<ParagraphStyle Self="ParagraphStyle/KeterTosafot" Name="KeterTosafot" Imported="false" NextStyle="ParagraphStyle/KeterTosafot" FontStyle="${tosafotStyle.fontStyle}" PointSize="${tosafotStyle.pointSize}" Justification="${tosafotStyle.justification}" ParagraphDirection="RightToLeftDirection" AppliedLanguage="$ID/Hebrew"${tosafotStyle.charAttrs}${tosafotStyle.extraParaAttrs}>
\t\t\t<Properties>
\t\t\t\t<BasedOn type="string">$ID/NormalParagraphStyle</BasedOn>
\t\t\t\t<PreviewColor type="enumeration">Nothing</PreviewColor>
\t\t\t\t<Leading type="unit">${tosafotStyle.leading}</Leading>
\t\t\t\t<AppliedFont type="string">${this.escapeXml(tosafotStyle.fontFamily)}</AppliedFont>
\t\t\t</Properties>
\t\t</ParagraphStyle>
\t\t<ParagraphStyle Self="ParagraphStyle/KeterHeading" Name="KeterHeading" Imported="false" NextStyle="ParagraphStyle/KeterHeading" FontStyle="${headingStyle.fontStyle}" PointSize="${headingStyle.pointSize}" Justification="${headingStyle.justification}" ParagraphDirection="RightToLeftDirection" AppliedLanguage="$ID/Hebrew"${headingStyle.charAttrs}${headingStyle.extraParaAttrs}>
\t\t\t<Properties>
\t\t\t\t<BasedOn type="string">$ID/NormalParagraphStyle</BasedOn>
\t\t\t\t<PreviewColor type="enumeration">Nothing</PreviewColor>
\t\t\t\t<Leading type="unit">${headingStyle.leading}</Leading>
\t\t\t\t<AppliedFont type="string">${this.escapeXml(headingStyle.fontFamily)}</AppliedFont>
\t\t\t</Properties>
\t\t</ParagraphStyle>
\t\t<ParagraphStyle Self="ParagraphStyle/KeterFootnote" Name="KeterFootnote" Imported="false" NextStyle="ParagraphStyle/KeterFootnote" FontStyle="${footnoteStyle.fontStyle}" PointSize="${footnoteStyle.pointSize}" Justification="${footnoteStyle.justification}" ParagraphDirection="RightToLeftDirection" AppliedLanguage="$ID/Hebrew"${footnoteStyle.charAttrs}${footnoteStyle.extraParaAttrs}>
\t\t\t<Properties>
\t\t\t\t<BasedOn type="string">$ID/NormalParagraphStyle</BasedOn>
\t\t\t\t<PreviewColor type="enumeration">Nothing</PreviewColor>
\t\t\t\t<Leading type="unit">${footnoteStyle.leading}</Leading>
\t\t\t\t<AppliedFont type="string">${this.escapeXml(footnoteStyle.fontFamily)}</AppliedFont>
\t\t\t</Properties>
\t\t</ParagraphStyle>`;

    const stylesXml = ADOBE_IDML_REFERENCE_FILES['Resources/Styles.xml']
      .replace(
        '</RootCharacterStyleGroup>',
        `${customCharStylesXml}\n\t</RootCharacterStyleGroup>`
      )
      .replace(
        '</RootParagraphStyleGroup>',
        `${customParaStylesXml}\n\t</RootParagraphStyleGroup>`
      );

    // 5. Build `Resources/Preferences.xml` from Adobe's canonical `Preferences.xml`
    //    updating PageHeight, PageWidth, PagesPerDocument, FacingPages="false", PageBinding="RightToLeft", and StoryDirection="RightToLeftDirection"
    const preferencesXml = ADOBE_IDML_REFERENCE_FILES['Resources/Preferences.xml']
      .replace(
        /PageHeight="[^"]*" PageWidth="[^"]*" CreatePrimaryTextFrame="false" PagesPerDocument="\d+" FacingPages="true"/,
        `PageHeight="${geometry.pageHeight}" PageWidth="${geometry.pageWidth}" CreatePrimaryTextFrame="false" PagesPerDocument="${Math.max(1, pages.length)}" FacingPages="false"`
      )
      .replace(/PageBinding="LeftToRight"/, 'PageBinding="RightToLeft"')
      .replace(
        /StoryDirection="LeftToRightDirection"/g,
        'StoryDirection="RightToLeftDirection"'
      );

    // 6. Build `MasterSpreads/MasterSpread_ucd.xml` matching `geometry.pageWidth` and `geometry.pageHeight`
    const halfPageH = Number((geometry.pageHeight / 2).toFixed(4));
    const colSpanW = Number(
      (geometry.pageWidth - geometry.marginInside - geometry.marginOutside).toFixed(4)
    );
    const masterSpreadXml = ADOBE_IDML_REFERENCE_FILES[
      'MasterSpreads/MasterSpread_ucd.xml'
    ]
      .replace(
        /GeometricBounds="0 0 [^"]*"/g,
        `GeometricBounds="0 0 ${geometry.pageHeight} ${geometry.pageWidth}"`
      )
      .replace(
        /ItemTransform="1 0 0 1 -283\.46456692913387 -141\.73228346456693"/,
        `ItemTransform="1 0 0 1 -${geometry.pageWidth} -${halfPageH}"`
      )
      .replace(
        /ItemTransform="1 0 0 1 0 -141\.73228346456693"/,
        `ItemTransform="1 0 0 1 0 -${halfPageH}"`
      )
      .replace(
        /<MarginPreference [^>]*\/>/g,
        `<MarginPreference ColumnCount="1" ColumnGutter="12" Top="${geometry.marginTop}" Bottom="${geometry.marginBottom}" Left="${geometry.marginInside}" Right="${geometry.marginOutside}" ColumnDirection="Horizontal" ColumnsPositions="0 ${colSpanW}" />`
      );

    // 7. Build `XML/BackingStory.xml` referencing our stories
    const xmlElementsInBacking = storyList
      .map(
        (sId, idx) =>
          `\t\t\t\t\t<XMLElement Self="di2i${idx + 3}" MarkupTag="XMLTag/dynamic_content" XMLContent="${sId}" />`
      )
      .join('\n');
    const backingStoryXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:BackingStory xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="8.0">
\t<XmlStory Self="ua8" AppliedTOCStyle="n" TrackChanges="false" StoryTitle="$ID/" AppliedNamedGrid="n">
\t\t<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle">
\t\t\t<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
\t\t\t\t<XMLElement Self="di2" MarkupTag="XMLTag/Root">
${xmlElementsInBacking}
\t\t\t\t</XMLElement>
\t\t\t\t<Content>\uFEFF</Content>
\t\t\t</CharacterStyleRange>
\t\t</ParagraphStyleRange>
\t</XmlStory>
</idPkg:BackingStory>`;

    // 8. Build `Spreads/Spread_uXXX.xml` for each page using Adobe's exact Spread/Page/PathGeometry structure
    const spreadEntries: Array<{ name: string; content: string }> = [];
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const pageSpecs = allPageFrames[i] ?? [];
      const spreadId = spreadIds[i];
      const pageId = `page_${i + 1}`;
      const pageName = this.escapeXml(String(page.pageNumberHebrew || page.pageNumber || i + 1));

      const textFramesXml = pageSpecs
        .map(spec => this.buildAdobeTextFrameXml(spec, geometry.pageHeight))
        .join('\n');
      // v0.6.0 Part C (§8): the title-page border rects, after the text
      // frames so they sit above the text in z-order (a stroked, empty
      // frame — it frames the page, it does not cover the text).
      const borderRectsXml = (allPageRectangles[i] ?? [])
        .map(spec => this.buildAdobeRectangleXml(spec, geometry.pageHeight))
        .join('\n');
      const framesXml = [textFramesXml, borderRectsXml].filter(Boolean).join('\n');

      const spreadXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:Spread xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="8.0">
\t<Spread Self="${spreadId}" FlattenerOverride="Default" AllowPageShuffle="true" ItemTransform="1 0 0 1 0 0" ShowMasterItems="true" PageCount="1" BindingLocation="0" PageTransitionType="None" PageTransitionDirection="NotApplicable" PageTransitionDuration="Medium">
\t\t<FlattenerPreference LineArtAndTextResolution="300" GradientAndMeshResolution="150" ClipComplexRegions="false" ConvertAllStrokesToOutlines="false" ConvertAllTextToOutlines="false">
\t\t\t<Properties>
\t\t\t\t<RasterVectorBalance type="double">50</RasterVectorBalance>
\t\t\t</Properties>
\t\t</FlattenerPreference>
\t\t<Page Self="${pageId}" AppliedAlternateLayout="ucc" LayoutRule="UseMaster" SnapshotBlendingMode="IgnoreLayoutSnapshots" OptionalPage="false" GeometricBounds="0 0 ${geometry.pageHeight} ${geometry.pageWidth}" ItemTransform="1 0 0 1 0 -${halfPageH}" Name="${pageName}" AppliedTrapPreset="TrapPreset/$ID/kDefaultTrapStyleName" OverrideList="" AppliedMaster="ucd" MasterPageTransform="1 0 0 1 0 0" TabOrder="" GridStartingPoint="TopOutside" UseMasterGrid="true">
\t\t\t<Properties>
\t\t\t\t<Descriptor type="list">
\t\t\t\t\t<ListItem type="string"></ListItem>
\t\t\t\t\t<ListItem type="enumeration">Arabic</ListItem>
\t\t\t\t\t<ListItem type="boolean">true</ListItem>
\t\t\t\t\t<ListItem type="boolean">false</ListItem>
\t\t\t\t\t<ListItem type="long">${i + 1}</ListItem>
\t\t\t\t\t<ListItem type="string"></ListItem>
\t\t\t\t</Descriptor>
\t\t\t\t<PageColor type="enumeration">UseMasterColor</PageColor>
\t\t\t</Properties>
\t\t\t<MarginPreference ColumnCount="1" ColumnGutter="12" Top="${geometry.marginTop}" Bottom="${geometry.marginBottom}" Left="${geometry.marginInside}" Right="${geometry.marginOutside}" ColumnDirection="Horizontal" ColumnsPositions="0 ${colSpanW}" />
\t\t\t<GridDataInformation FontStyle="Regular" PointSize="12" CharacterAki="0" LineAki="9" HorizontalScale="100" VerticalScale="100" LineAlignment="LeftOrTopLineJustify" GridAlignment="AlignEmCenter" CharacterAlignment="AlignEmCenter">
\t\t\t\t<Properties>
\t\t\t\t\t<AppliedFont type="string">Minion Pro</AppliedFont>
\t\t\t\t</Properties>
\t\t\t</GridDataInformation>
\t\t</Page>
${framesXml}
\t</Spread>
</idPkg:Spread>`;

      spreadEntries.push({
        name: `Spreads/Spread_${spreadId}.xml`,
        content: spreadXml,
      });
    }

    // 10. Assemble ordered entries in exact Adobe InDesign package order
    const orderedEntries: Array<{
      name: string;
      content: string;
      storeUncompressed?: boolean;
    }> = [
      {
        name: 'mimetype',
        content: 'application/vnd.adobe.indesign-idml-package',
        storeUncompressed: true,
      },
      { name: 'designmap.xml', content: designmapXml },
      {
        name: 'META-INF/container.xml',
        content: ADOBE_IDML_REFERENCE_FILES['META-INF/container.xml'],
      },
      {
        name: 'META-INF/metadata.xml',
        content: ADOBE_IDML_REFERENCE_FILES['META-INF/metadata.xml'],
      },
      { name: 'Resources/Graphic.xml', content: graphicXml },
      { name: 'Resources/Fonts.xml', content: fontsXml },
      { name: 'Resources/Styles.xml', content: stylesXml },
      { name: 'Resources/Preferences.xml', content: preferencesXml },
      { name: 'XML/Tags.xml', content: ADOBE_IDML_REFERENCE_FILES['XML/Tags.xml'] },
      { name: 'MasterSpreads/MasterSpread_ucd.xml', content: masterSpreadXml },
      ...spreadEntries,
      { name: 'XML/BackingStory.xml', content: backingStoryXml },
      ...storyEntries,
    ];

    return this.packUcfIdmlZip(orderedEntries);
  }

  /**
   * Point-in-polygon test (ray-casting algorithm) for axis-aligned/general 2D polygons
   */
  private static isPointStrictlyInsidePolygon(
    px: number,
    py: number,
    poly: Array<{ x: number; y: number }>
  ): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x;
      const yi = poly[i].y;
      const xj = poly[j].x;
      const yj = poly[j].y;
      const intersect =
        yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  /**
   * Checks whether two axis-aligned polygons overlap by more than `tolerance` points
   * by sampling a dense interior grid inside their bounding-box intersection.
   */
  public static doPolygonsOverlap(
    polyA: Array<{ x: number; y: number }>,
    polyB: Array<{ x: number; y: number }>,
    tolerance: number = 1.0
  ): boolean {
    if (polyA.length < 3 || polyB.length < 3) return false;
    const minXA = Math.min(...polyA.map(p => p.x));
    const maxXA = Math.max(...polyA.map(p => p.x));
    const minYA = Math.min(...polyA.map(p => p.y));
    const maxYA = Math.max(...polyA.map(p => p.y));

    const minXB = Math.min(...polyB.map(p => p.x));
    const maxXB = Math.max(...polyB.map(p => p.x));
    const minYB = Math.min(...polyB.map(p => p.y));
    const maxYB = Math.max(...polyB.map(p => p.y));

    const ixLeft = Math.max(minXA, minXB) + tolerance;
    const ixRight = Math.min(maxXA, maxXB) - tolerance;
    const iyTop = Math.max(minYA, minYB) + tolerance;
    const iyBottom = Math.min(maxYA, maxYB) - tolerance;

    if (ixRight <= ixLeft || iyBottom <= iyTop) return false;

    const steps = 8;
    for (let sx = 0; sx <= steps; sx++) {
      const px = ixLeft + ((ixRight - ixLeft) * sx) / steps;
      for (let sy = 0; sy <= steps; sy++) {
        const py = iyTop + ((iyBottom - iyTop) * sy) / steps;
        if (
          this.isPointStrictlyInsidePolygon(px, py, polyA) &&
          this.isPointStrictlyInsidePolygon(px, py, polyB)
        ) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Comprehensive structural, binary UCF, & semantic auditor for generated IDML packages.
   */
  public static async auditIdmlPackage(
    idmlBlob: Blob,
    bookDoc?: BookTypesetDocument
  ): Promise<IdmlPackageAuditResult> {
    const errors: string[] = [];
    const brokenStoryReferences: string[] = [];
    const overlappingTextFrames: string[] = [];

    const buffer = await idmlBlob.arrayBuffer();
    const zipBinaryAudit = this.inspectZipBinary(buffer);

    if (!zipBinaryAudit.isFirstEntryMimetype) {
      errors.push('First ZIP entry is not "mimetype" at byte offset 0');
    }
    if (zipBinaryAudit.firstEntryCompressionMethod !== 0) {
      errors.push(
        `mimetype compression method must be 0 (STORE), got ${zipBinaryAudit.firstEntryCompressionMethod}`
      );
    }
    if (zipBinaryAudit.firstEntryExtraFieldLength !== 0) {
      errors.push(
        `mimetype extraFieldLength must be 0, got ${zipBinaryAudit.firstEntryExtraFieldLength}`
      );
    }
    if (!zipBinaryAudit.firstEntryDataExact) {
      errors.push('mimetype payload is not exact 43-byte application/vnd.adobe.indesign-idml-package');
    }
    if (!zipBinaryAudit.hasZeroDirectoryEntries) {
      errors.push('ZIP contains explicit 0-byte directory entries (not allowed in Adobe UCF)');
    }

    const zip = await JSZip.loadAsync(buffer);

    const mimetypeFile = zip.file('mimetype');
    const mimetypeText = mimetypeFile ? await mimetypeFile.async('string') : '';
    const hasValidMimetype =
      mimetypeText === 'application/vnd.adobe.indesign-idml-package' &&
      zipBinaryAudit.isFirstEntryMimetype &&
      zipBinaryAudit.firstEntryCompressionMethod === 0 &&
      zipBinaryAudit.firstEntryDataExact;

    const containerXml = await zip.file('META-INF/container.xml')?.async('string');
    const hasContainerXml = Boolean(
      containerXml && containerXml.includes('full-path="designmap.xml"')
    );
    if (!hasContainerXml) {
      errors.push('Missing or invalid META-INF/container.xml');
    }

    const designmapXml = await zip.file('designmap.xml')?.async('string');
    const hasDesignmapXml = Boolean(designmapXml && designmapXml.includes('<Document'));
    if (!hasDesignmapXml) {
      errors.push('Missing or invalid designmap.xml');
    }

    const hasCorrectAdobeNamespace = Boolean(
      designmapXml &&
        designmapXml.includes(
          'xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging"'
        ) &&
        !designmapXml.includes('http://schemas.adobe.com/idml/1.0/packaging')
    );
    if (!hasCorrectAdobeNamespace) {
      errors.push(
        'Invalid xmlns:idPkg namespace (must be http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging)'
      );
    }

    const hasAidProcessingInstruction = Boolean(
      designmapXml && designmapXml.includes('<?aid style="50" type="document"')
    );
    if (!hasAidProcessingInstruction) {
      errors.push('Missing <?aid style="50" type="document" ...?> in designmap.xml');
    }

    const hasLayerInDesignmap = Boolean(
      designmapXml && designmapXml.includes('<Layer Self="uc3"')
    );
    if (!hasLayerInDesignmap) {
      errors.push('Missing <Layer Self="uc3"> in designmap.xml');
    }

    const hasSectionInDesignmap = Boolean(
      designmapXml && designmapXml.includes('<Section Self="ucc"')
    );
    if (!hasSectionInDesignmap) {
      errors.push('Missing <Section Self="ucc"> in designmap.xml');
    }

    const graphicXml = await zip.file('Resources/Graphic.xml')?.async('string');
    const fontsXml = await zip.file('Resources/Fonts.xml')?.async('string');
    const stylesXml = await zip.file('Resources/Styles.xml')?.async('string');
    const prefsXml = await zip.file('Resources/Preferences.xml')?.async('string');
    const hasResources = Boolean(
      graphicXml &&
        fontsXml &&
        stylesXml &&
        prefsXml &&
        stylesXml.includes('RootObjectStyleGroup') &&
        stylesXml.includes('ObjectStyle/$ID/[Normal Text Frame]')
    );
    if (!hasResources) {
      errors.push('Missing Resources/*.xml or missing RootObjectStyleGroup in Styles.xml');
    }

    const masterSpreadXml = await zip
      .file('MasterSpreads/MasterSpread_ucd.xml')
      ?.async('string');
    const hasMasterSpread = Boolean(
      masterSpreadXml && masterSpreadXml.includes('<MasterSpread Self="ucd"')
    );
    if (!hasMasterSpread) {
      errors.push('Missing MasterSpreads/MasterSpread_ucd.xml');
    }

    const backingStoryXml = await zip.file('XML/BackingStory.xml')?.async('string');
    const hasBackingStory = Boolean(
      backingStoryXml && backingStoryXml.includes('<XmlStory Self="ua8"')
    );
    if (!hasBackingStory) {
      errors.push('Missing XML/BackingStory.xml');
    }

    const tagsXml = await zip.file('XML/Tags.xml')?.async('string');
    const hasTagsXml = Boolean(tagsXml && tagsXml.includes('XMLTag/Root'));
    if (!hasTagsXml) {
      errors.push('Missing XML/Tags.xml');
    }

    // Parse StoryList from designmap.xml (excluding BackingStory 'ua8')
    const storyListMatch = designmapXml?.match(/StoryList="([^"]*)"/);
    const declaredStoryIds = storyListMatch
      ? storyListMatch[1]
          .split(/\s+/)
          .filter(id => Boolean(id) && id !== 'ua8')
      : [];

    const existingStoryIds = new Set<string>();
    let hasRtlStoryDirection = true;
    let hasRtlParagraphDirection = true;
    let hasBoldDibburCharacterStyle = false;
    let conservedWordCount = 0;

    for (const sId of declaredStoryIds) {
      const sXml = await zip.file(`Stories/Story_${sId}.xml`)?.async('string');
      if (!sXml) {
        brokenStoryReferences.push(`Declared story "${sId}" has no Stories/Story_${sId}.xml`);
        continue;
      }
      existingStoryIds.add(sId);
      if (!sXml.includes('StoryDirection="RightToLeftDirection"')) {
        hasRtlStoryDirection = false;
      }
      if (!sXml.includes('ParagraphDirection="RightToLeftDirection"')) {
        hasRtlParagraphDirection = false;
      }
      if (sXml.includes('CharacterStyle/KeterDibburBold') || sXml.includes('FontStyle="Bold"')) {
        hasBoldDibburCharacterStyle = true;
      }

      const contentMatches = Array.from(sXml.matchAll(/<Content>([\s\S]*?)<\/Content>/g));
      for (const m of contentMatches) {
        const raw = m[1]
          .replace(/\uFEFF/g, '')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&');
        if (/^\[\d+\]\s*$/.test(raw)) continue;
        const tokens = raw.trim().split(/\s+/).filter(Boolean);
        conservedWordCount += tokens.length;
      }
    }

    let expectedWordCount = conservedWordCount;
    if (bookDoc) {
      expectedWordCount = 0;
      for (const p of bookDoc.pages) {
        const allLines = [
          ...p.sourceLines,
          ...(p.rashiLines ?? []),
          ...(p.tosafotLines ?? []),
          ...(p.column2Lines ?? []),
          ...(p.footnoteLines ?? []),
        ];
        for (const l of allLines) {
          expectedWordCount += l.words.filter(w => !w.isSpace && w.text.trim().length > 0).length;
        }
      }
    }

    // Find all Spread files in the archive
    const spreadFileNames = Object.keys(zip.files).filter(
      f => f.startsWith('Spreads/Spread_') && f.endsWith('.xml')
    );

    let totalSpreads = 0;
    let totalTextFrames = 0;
    let hasRasterizedSubstitutes = false;
    let hasPathGeometryInFrames = true;
    let hasSourceTextWrapExclusion = false;
    let hasUnifiedStreamFrames = true;
    const allFrameIds = new Set<string>();
    const frameThreadRefs: Array<{ id: string; prev: string; next: string }> = [];

    for (let i = 0; i < spreadFileNames.length; i++) {
      const spXml = await zip.file(spreadFileNames[i])?.async('string');
      if (!spXml) continue;
      totalSpreads++;

      if (spXml.includes('<Image ') || spXml.includes('<EPS ') || spXml.includes('<PDF ')) {
        hasRasterizedSubstitutes = true;
        errors.push(`Spread ${spreadFileNames[i]} contains rasterized image substitute`);
      }

      const pageBoundsMatch = spXml.match(/<Page[^>]*GeometricBounds="0 0 ([\d.]+) ([\d.]+)"/);
      const pageH = pageBoundsMatch ? Number(pageBoundsMatch[1]) : 600;

      const tfBlocks = Array.from(spXml.matchAll(/<TextFrame\b([\s\S]*?)<\/TextFrame>/g));
      const spreadFrames: Array<{
        id: string;
        parentStory: string;
        poly: Array<{ x: number; y: number }>;
      }> = [];
      const storiesOnSpread = new Set<string>();

      for (const blockMatch of tfBlocks) {
        const tfBlock = blockMatch[0];
        const selfMatch = tfBlock.match(/Self="([^"]+)"/);
        const parentMatch = tfBlock.match(/ParentStory="([^"]+)"/);
        const prevMatch = tfBlock.match(/PreviousTextFrame="([^"]+)"/);
        const nextMatch = tfBlock.match(/NextTextFrame="([^"]+)"/);
        const transformMatch = tfBlock.match(/ItemTransform="1 0 0 1 ([-\d.]+) ([-\d.]+)"/);
        const anchors = Array.from(
          tfBlock.matchAll(/<PathPointType\s+Anchor="([-\d.]+)\s+([-\d.]+)"/g)
        );

        if (!selfMatch || !parentMatch || !prevMatch || !nextMatch) continue;
        const tfId = selfMatch[1];
        const parentStory = parentMatch[1];
        const prevTf = prevMatch[1];
        const nextTf = nextMatch[1];

        totalTextFrames++;
        allFrameIds.add(tfId);
        frameThreadRefs.push({ id: tfId, prev: prevTf, next: nextTf });

        if (storiesOnSpread.has(parentStory) && !tfId.includes('col')) {
          hasUnifiedStreamFrames = false;
        }
        storiesOnSpread.add(parentStory);

        if (
          parentStory === 'u_story_source' &&
          tfBlock.includes('TextWrapMode="Contour"') &&
          tfBlock.includes('ContourType="SameAsClipping"')
        ) {
          hasSourceTextWrapExclusion = true;
        }

        if (!existingStoryIds.has(parentStory)) {
          brokenStoryReferences.push(
            `TextFrame "${tfId}" references non-existent ParentStory="${parentStory}"`
          );
        }

        if (!tfBlock.includes('<PathGeometry>') || anchors.length < 4 || !transformMatch) {
          hasPathGeometryInFrames = false;
          errors.push(`TextFrame "${tfId}" is missing Adobe <PathGeometry> or ItemTransform`);
        } else {
          const tx = Number(transformMatch[1]);
          const ty = Number(transformMatch[2]);
          const poly = anchors.map(a => ({
            x: tx + Number(a[1]),
            y: ty + Number(a[2]) + pageH / 2,
          }));
          spreadFrames.push({ id: tfId, parentStory, poly });
        }
      }

      // Check for overlapping TextFrame polygons on this spread (using 1.0pt tolerance)
      for (let a = 0; a < spreadFrames.length; a++) {
        for (let b = a + 1; b < spreadFrames.length; b++) {
          const fa = spreadFrames[a];
          const fb = spreadFrames[b];
          if (this.doPolygonsOverlap(fa.poly, fb.poly, 1.0)) {
            overlappingTextFrames.push(
              `Spread ${i}: polygon "${fa.id}" overlaps polygon "${fb.id}"`
            );
          }
        }
      }
    }

    for (const ref of frameThreadRefs) {
      if (ref.prev !== 'n' && !allFrameIds.has(ref.prev)) {
        brokenStoryReferences.push(
          `TextFrame "${ref.id}" has broken PreviousTextFrame="${ref.prev}"`
        );
      }
      if (ref.next !== 'n' && !allFrameIds.has(ref.next)) {
        brokenStoryReferences.push(
          `TextFrame "${ref.id}" has broken NextTextFrame="${ref.next}"`
        );
      }
    }

    if (brokenStoryReferences.length > 0) {
      errors.push(...brokenStoryReferences);
    }
    if (overlappingTextFrames.length > 0) {
      errors.push(...overlappingTextFrames);
    }
    if (bookDoc && conservedWordCount !== expectedWordCount) {
      errors.push(
        `Word conservation mismatch: IDML=${conservedWordCount} vs Solved=${expectedWordCount}`
      );
    }

    // Stage 12 Level 0 Enforcement: Evaluate IDML structural & conservation rules via EngineHardRulesEngine
    const idmlHardReport = EngineHardRulesEngine.evaluateContext({
      bookDoc,
      userSuppliedOrnamentsCount: bookDoc
        ? bookDoc.pages.reduce((s, p) => s + (p.placedOrnaments?.length ?? 0), 0)
        : 0,
      idmlAudit: {
        hasRasterizedSubstitutes,
        overlappingTextFrames,
        brokenStoryReferences,
        conservedWordCount,
        expectedWordCount,
      },
    });
    for (const v of idmlHardReport.violations) {
      if (!errors.includes(v.message)) {
        errors.push(v.message);
      }
    }

    const expectedSpreadCount = bookDoc ? bookDoc.pages.length : 1;
    const passed =
      hasValidMimetype &&
      hasContainerXml &&
      hasDesignmapXml &&
      hasResources &&
      hasCorrectAdobeNamespace &&
      hasAidProcessingInstruction &&
      hasLayerInDesignmap &&
      hasSectionInDesignmap &&
      hasMasterSpread &&
      hasBackingStory &&
      hasTagsXml &&
      hasPathGeometryInFrames &&
      totalSpreads === expectedSpreadCount &&
      totalTextFrames > 0 &&
      brokenStoryReferences.length === 0 &&
      overlappingTextFrames.length === 0 &&
      hasRtlStoryDirection &&
      hasRtlParagraphDirection &&
      !hasRasterizedSubstitutes &&
      conservedWordCount === expectedWordCount &&
      errors.length === 0;

    return {
      passed,
      hasValidMimetype,
      hasContainerXml,
      hasDesignmapXml,
      hasResources,
      hasCorrectAdobeNamespace,
      hasAidProcessingInstruction,
      hasLayerInDesignmap,
      hasSectionInDesignmap,
      hasMasterSpread,
      hasBackingStory,
      hasTagsXml,
      hasPathGeometryInFrames,
      hasSourceTextWrapExclusion,
      hasUnifiedStreamFrames,
      zipBinaryAudit,
      totalSpreads,
      totalStories: existingStoryIds.size,
      totalTextFrames,
      brokenStoryReferences,
      overlappingTextFrames,
      hasRtlStoryDirection,
      hasRtlParagraphDirection,
      hasBoldDibburCharacterStyle,
      conservedWordCount,
      expectedWordCount,
      hasRasterizedSubstitutes,
      errors,
    };
  }

  /**
   * Backward-compatible helper for single page / legacy call format
   */
  public static async generateIdml(options: {
    bookTitle?: string;
    sourceLines?: any[];
    rashiLines?: any[];
    tosafotLines?: any[];
    knee?: any;
    geometry: any;
    pageNumber?: number;
  }): Promise<Blob> {
    const page: PageTypesetResult = {
      pageIndex: 0,
      pageNumber: options.pageNumber || 1,
      pageNumberHebrew: 'א׳',
      headerTitle: options.bookTitle || 'ספר קודש',
      layoutType: 'rav_text',
      geometry: options.geometry,
      sourceLines: options.sourceLines || [],
      rashiLines: options.rashiLines || [],
      tosafotLines: options.tosafotLines || [],
      footnoteLines: [],
      knee: options.knee || {
        pageContentWidth: options.geometry.pageWidth - 80,
        pageContentHeight: options.geometry.pageHeight - 96,
        topY: 0,
        kneeJunctionY: 300,
        bottomY: options.geometry.pageHeight - 96,
        upperSourceWidth: 200,
        lowerSourceWidth: 160,
        innerXOffset: 40,
        isLeftStepped: true,
        rightCommentaryWidth: 100,
        leftCommentaryWidth: 100,
        gutterWidth: 12,
      },
    };

    const doc: BookTypesetDocument = {
      title: options.bookTitle || 'ספר קודש',
      layoutType: 'rav_text',
      pages: [page],
      totalPages: 1,
      geometry: options.geometry,
    };

    return this.generateMultiPageIdml(doc);
  }
}
