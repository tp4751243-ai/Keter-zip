import React, { useMemo, useRef, useState } from 'react';
import {
  LayoutTemplate,
  Plus,
  Trash2,
  Save,
  RotateCcw,
  Move,
  Grip,
  ChevronDown,
  ChevronUp,
  Shapes,
  Scissors,
  Download,
  Upload,
} from 'lucide-react';
import { BookLayoutType } from '../types/typesetter';
import {
  CustomLayoutBox,
  CustomLayoutBoxRole,
  CustomLayoutBoxRules,
  CustomLayoutBoxTier,
  CustomLayoutPolygonKind,
  CustomLayoutPolygonPoint,
} from '../types/design-settings';
import {
  CUSTOM_LAYOUT_BOX_ROLE_LABELS_EN,
  CUSTOM_LAYOUT_BOX_ROLE_LABELS_HE,
  CUSTOM_LAYOUT_BOX_TIERS,
  CUSTOM_LAYOUT_POLYGON_KINDS,
  CUSTOM_LAYOUT_POLYGON_LABELS_HE,
  boxRoleLabel,
  boxTierLabel,
  defaultBoxesForBaseLayout,
  deleteCustomLayoutTemplate,
  effectiveBoxTier,
  estimateBoxCapacity,
  listCustomLayoutTemplates,
  makeCustomLayoutBox,
  makePolygonShape,
  planCustomLayoutFlow,
  samplePreviewUnits,
  sanitizeCustomLayoutBoxRules,
  sanitizePolygonShape,
  saveCustomLayoutTemplate,
} from '../engine/custom-layout-engine';
import {
  KETER_TEMPLATE_EXTENSION,
  deserializeRecipe,
  recipeFromBoxes,
  recipeToCustomLayoutBoxes,
  serializeRecipe,
  type LayoutRecipe,
} from '../engine/layout-recipes';
import { useLanguage } from '../i18n/LanguageContext';
import { Hint } from './Hint';

interface CustomLayoutDesignerProps {
  /** Boxes currently in the design (controlled by the parent). */
  boxes: CustomLayoutBox[];
  onBoxesChange: (boxes: CustomLayoutBox[]) => void;
  baseLayout: BookLayoutType;
  onBaseLayoutChange?: (base: BookLayoutType) => void;
  /** Page content size in pt (inside the margins) — used for snap + fit. */
  contentWidthPt?: number;
  contentHeightPt?: number;
  /** When set, edits can be scoped to this 0-based page only. */
  pageIndex?: number | null;
  pageOverrideExists?: boolean;
  onPageOverrideChange?: (pageIndex: number, boxes: CustomLayoutBox[]) => void;
  onClearPageOverride?: (pageIndex: number) => void;
  compact?: boolean;
  /**
   * v0.9.0 Part B — template file handlers supplied by the host (the
   * Design panel wires these to App's transactional handlers: export
   * builds the recipe from the full book settings, import validates and
   * applies it through the preset-switch transaction). When a host does
   * not supply them (Home / New-Project setup screens), the designer
   * falls back to a local boxes-only export/import, so the buttons are
   * never dead — they always do the best correct thing for their host.
   */
  onExportTemplate?: () => void;
  onImportTemplateFile?: (file: File) => void;
}

const BASE_LAYOUT_OPTIONS: Array<{ id: BookLayoutType; labelHe: string; labelEn: string }> = [
  { id: 'rav_text', labelHe: 'ש״ס וילנא (רב-טקסט)', labelEn: 'Vilna Shas (multi-text)' },
  { id: 'single_column', labelHe: 'טור יחיד', labelEn: 'Single column' },
  { id: 'two_column', labelHe: 'שני טורים', labelEn: 'Two columns' },
  { id: 'source_top_commentary_bottom', labelHe: 'מקור עליון + מפרשים', labelEn: 'Upper source + commentaries' },
  { id: 'mikraot_gedolot', labelHe: 'מקראות גדולות', labelEn: 'Mikraot Gedolot' },
];

const BOX_ROLE_ORDER: CustomLayoutBoxRole[] = [
  'main_text',
  'commentary',
  'header',
  'footnote',
  'side_note',
];

const ROLE_TINT: Record<CustomLayoutBoxRole, string> = {
  main_text: 'rgba(52, 74, 103, 0.10)',
  commentary: 'rgba(120, 84, 20, 0.10)',
  header: 'rgba(30, 90, 60, 0.10)',
  footnote: 'rgba(90, 40, 90, 0.10)',
  side_note: 'rgba(90, 90, 30, 0.10)',
};

const ROLE_BORDER: Record<CustomLayoutBoxRole, string> = {
  main_text: '#344A67',
  commentary: '#785414',
  header: '#1E5A3C',
  footnote: '#5A285A',
  side_note: '#5A5A1E',
};

/**
 * v0.5.0 Part C — Module 3: interactive page-preview editor for the custom
 * layout. Drag a box to move it, drag its corner handle to resize it
 * (snaps to a 6pt grid), add/remove boxes per text kind, save the whole
 * arrangement as a reusable template, and optionally scope edits to one
 * page. The preview shows real fitted text: `planCustomLayoutFlow` reflows
 * sample units into the boxes, so what you see is what the engine will
 * flow on a real page.
 */
export const CustomLayoutDesigner: React.FC<CustomLayoutDesignerProps> = ({
  boxes,
  onBoxesChange,
  baseLayout,
  onBaseLayoutChange,
  contentWidthPt = 394,
  contentHeightPt = 584,
  pageIndex = null,
  pageOverrideExists = false,
  onPageOverrideChange,
  onClearPageOverride,
  compact = false,
  onExportTemplate,
  onImportTemplateFile,
}) => {
  const { t, dir, lang } = useLanguage();
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<CustomLayoutBox[] | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [templates, setTemplates] = useState(() => listCustomLayoutTemplates());
  const [perPageOnly, setPerPageOnly] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // v0.9.0 Part B — template import errors (plain language, shown under
  // the import button until the next successful import).
  const [importErrors, setImportErrors] = useState<string[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Declutter (v0.5.0 follow-up): only the essentials are visible up
  // front — preview, add-box, selected box. Base layout, per-page scope
  // and the template library live behind "More options".
  const [showAdvanced, setShowAdvanced] = useState(false);
  // v0.6.0 Part C (§2) — polygonal frames: which cut-out of the selected
  // box the vertex handles edit (null = the box's own shape).
  const [selectedExclusionId, setSelectedExclusionId] = useState<string | null>(null);
  // Snapping guides shown while a vertex is dragged (container % coords).
  const [guideLines, setGuideLines] = useState<{ xPct?: number; yPct?: number } | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  // The drag/resize gesture in progress (kept in a ref so moving the
  // pointer does not re-render the parent on every pixel).
  const gestureRef = useRef<{
    boxId: string;
    mode: 'move' | 'resize';
    startClientX: number;
    startClientY: number;
    startBox: CustomLayoutBox;
  } | null>(null);

  // v0.6.0 Part C (§2) — vertex-drag gesture for a polygon / cut-out.
  const vertexDragRef = useRef<{
    boxId: string;
    exclusionId: string | null;
    vertexIndex: number;
    startClientX: number;
    startClientY: number;
    startPoints: CustomLayoutPolygonPoint[];
  } | null>(null);

  const shownBoxes = dragPreview ?? boxes;
  const previewScale = 440 / contentWidthPt;

  // Live reflow preview: sample units flowed into the current boxes.
  const previewPlan = useMemo(() => {
    const { pages } = planCustomLayoutFlow(samplePreviewUnits(), shownBoxes, {
      contentWidthPt,
      contentHeightPt,
      fontSizePtByRole: {
        main_source: 14.5,
        primary_comment: 10.5,
        secondary_comment: 10.5,
        footnote: 9.5,
      },
    });
    return pages[0];
  }, [shownBoxes, contentWidthPt, contentHeightPt]);

  const textForBox = (boxId: string): string => {
    const found = previewPlan?.assignments.filter(a => a.boxId === boxId) ?? [];
    return found.map(a => a.text).join(' ');
  };

  const commitBoxes = (next: CustomLayoutBox[]) => {
    setDragPreview(null);
    if (perPageOnly && pageIndex !== null && onPageOverrideChange) {
      onPageOverrideChange(pageIndex, next);
      setNotice(t('השינוי נשמר לדף זה בלבד — שאר הספר לא השתנה.'));
    } else {
      onBoxesChange(next);
    }
  };

  // ── v0.6.0 Part C (§2): polygonal frames ──────────────────────────────
  // The selected box's shape (or its selected cut-out) is edited through
  // these helpers; every change commits through `commitBoxes`, so shapes
  // and cut-outs save exactly like the boxes (globally, or to this page
  // only when "רק לדף זה" is on) and ride along in saved templates.
  const selectedBoxForShape = shownBoxes.find(b => b.id === selectedBoxId) ?? null;
  const selectedPolygonPoints: CustomLayoutPolygonPoint[] | null =
    selectedBoxForShape
      ? selectedExclusionId
        ? selectedBoxForShape.exclusions?.find(e => e.id === selectedExclusionId)?.points ?? null
        : selectedBoxForShape.shape?.points ?? null
      : null;

  const applyPolygonPoints = (boxId: string, exclusionId: string | null, points: CustomLayoutPolygonPoint[]) => {
    const clean = sanitizePolygonShape({ kind: 'custom', points });
    const next = shownBoxes.map(b => {
      if (b.id !== boxId) return b;
      if (exclusionId) {
        return {
          ...b,
          exclusions: (b.exclusions ?? []).map(e =>
            e.id === exclusionId ? { ...e, points: clean?.points ?? e.points } : e
          ),
        };
      }
      return { ...b, shape: clean ? { kind: b.shape?.kind ?? 'custom', points: clean.points } : undefined };
    });
    setDragPreview(next);
  };

  const commitPolygonPoints = (boxId: string, exclusionId: string | null, points: CustomLayoutPolygonPoint[]) => {
    const clean = sanitizePolygonShape({ kind: 'custom', points });
    const next = shownBoxes.map(b => {
      if (b.id !== boxId) return b;
      if (exclusionId) {
        return {
          ...b,
          exclusions: (b.exclusions ?? []).map(e =>
            e.id === exclusionId ? { ...e, points: clean?.points ?? e.points } : e
          ),
        };
      }
      return { ...b, shape: clean ? { kind: b.shape?.kind ?? 'custom', points: clean.points } : undefined };
    });
    commitBoxes(next);
  };

  const handleShapeKind = (kind: CustomLayoutPolygonKind) => {
    if (!selectedBoxForShape) return;
    if (kind === 'rectangle') {
      commitBoxes(shownBoxes.map(b => (b.id === selectedBoxForShape.id ? { ...b, shape: undefined } : b)));
      return;
    }
    const shape = makePolygonShape(kind);
    commitBoxes(
      shownBoxes.map(b => (b.id === selectedBoxForShape.id ? { ...b, shape } : b))
    );
    setSelectedExclusionId(null);
  };

  const handleAddExclusion = () => {
    if (!selectedBoxForShape) return;
    const ex = {
      id: `ex-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      points: [
        { x: 0.3, y: 0.3 }, { x: 0.7, y: 0.3 }, { x: 0.7, y: 0.7 }, { x: 0.3, y: 0.7 },
      ],
    };
    commitBoxes(
      shownBoxes.map(b =>
        b.id === selectedBoxForShape.id
          ? { ...b, exclusions: [...(b.exclusions ?? []), ex] }
          : b
      )
    );
    setSelectedExclusionId(ex.id);
  };

  const handleRemoveExclusion = (exclusionId: string) => {
    if (!selectedBoxForShape) return;
    commitBoxes(
      shownBoxes.map(b =>
        b.id === selectedBoxForShape.id
          ? { ...b, exclusions: (b.exclusions ?? []).filter(e => e.id !== exclusionId) }
          : b
      )
    );
    setSelectedExclusionId(null);
  };

  const polygonClipCss = (points: CustomLayoutPolygonPoint[]): string =>
    `polygon(${points.map(p => `${(p.x * 100).toFixed(1)}% ${(p.y * 100).toFixed(1)}%`).join(', ')})`;

  /** Snap a normalized vertex coordinate to the 6pt grid (in box units). */
  const snapNorm = (v: number, boxSizePct: number, pageSizePt: number): number => {
    const stepPct = (6 / pageSizePt) * 100;
    const step = stepPct / Math.max(1, boxSizePct);
    if (step <= 0) return v;
    return Math.round(v / step) * step;
  };

  const onVertexPointerDown = (
    e: React.PointerEvent,
    box: CustomLayoutBox,
    exclusionId: string | null,
    vertexIndex: number,
    points: CustomLayoutPolygonPoint[]
  ) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedBoxId(box.id);
    setSelectedExclusionId(exclusionId);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    vertexDragRef.current = {
      boxId: box.id,
      exclusionId,
      vertexIndex,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPoints: points.map(p => ({ ...p })),
    };
  };

  const onEdgeMidpointPointerDown = (
    e: React.PointerEvent,
    box: CustomLayoutBox,
    exclusionId: string | null,
    edgeIndex: number,
    points: CustomLayoutPolygonPoint[]
  ) => {
    // Edge split: insert a vertex at the edge midpoint, then drag it.
    e.stopPropagation();
    e.preventDefault();
    const a = points[edgeIndex];
    const b = points[(edgeIndex + 1) % points.length];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const nextPoints = [...points.slice(0, edgeIndex + 1), mid, ...points.slice(edgeIndex + 1)];
    setSelectedBoxId(box.id);
    setSelectedExclusionId(exclusionId);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    vertexDragRef.current = {
      boxId: box.id,
      exclusionId,
      vertexIndex: edgeIndex + 1,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPoints: nextPoints.map(p => ({ ...p })),
    };
    applyPolygonPoints(box.id, exclusionId, nextPoints);
  };

  const handleVertexPointerMove = (e: React.PointerEvent) => {
    const g = vertexDragRef.current;
    if (!g) return false;
    const rect = previewRef.current?.getBoundingClientRect();
    const box = shownBoxes.find(b => b.id === g.boxId);
    if (!rect || !box) return true;
    const boxWpx = (box.widthPct / 100) * rect.width;
    const boxHpx = (box.heightPct / 100) * rect.height;
    const start = g.startPoints[g.vertexIndex];
    if (!start) return true;
    let nx = start.x + (e.clientX - g.startClientX) / Math.max(1, boxWpx);
    let ny = start.y + (e.clientY - g.startClientY) / Math.max(1, boxHpx);
    nx = snapNorm(nx, box.widthPct, contentWidthPt);
    ny = snapNorm(ny, box.heightPct, contentHeightPt);
    // Smart snapping: pull to a sibling vertex / box edge / centre when
    // close, and show the guide line for the snapped coordinate.
    const guides: { xPct?: number; yPct?: number } = {};
    const snapTargetsX = [0, 0.5, 1, ...g.startPoints.map(p => p.x)];
    const snapTargetsY = [0, 0.5, 1, ...g.startPoints.map(p => p.y)];
    for (const tx of snapTargetsX) {
      if (Math.abs(nx - tx) < 0.03) {
        nx = tx;
        guides.xPct = box.xPct + tx * box.widthPct;
        break;
      }
    }
    for (const ty of snapTargetsY) {
      if (Math.abs(ny - ty) < 0.03) {
        ny = ty;
        guides.yPct = box.yPct + ty * box.heightPct;
        break;
      }
    }
    setGuideLines(Object.keys(guides).length > 0 ? guides : null);
    const nextPoints = g.startPoints.map((p, i) =>
      i === g.vertexIndex
        ? { x: Math.max(0, Math.min(1, nx)), y: Math.max(0, Math.min(1, ny)) }
        : { ...p }
    );
    applyPolygonPoints(g.boxId, g.exclusionId, nextPoints);
    return true;
  };

  const handleVertexPointerUp = () => {
    const g = vertexDragRef.current;
    vertexDragRef.current = null;
    setGuideLines(null);
    if (!g || !dragPreview) return true;
    const box = dragPreview.find(b => b.id === g.boxId);
    const points = g.exclusionId
      ? box?.exclusions?.find(e => e.id === g.exclusionId)?.points ?? []
      : box?.shape?.points ?? [];
    commitPolygonPoints(g.boxId, g.exclusionId, points);
    return true;
  };

  const pctFromClient = (box: CustomLayoutBox, dxPx: number, dyPx: number) => {
    const rect = previewRef.current?.getBoundingClientRect();
    if (!rect) return { dxPct: 0, dyPct: 0 };
    return {
      dxPct: (dxPx / rect.width) * 100,
      dyPct: (dyPx / rect.height) * 100,
    };
  };

  const snap = (v: number, pageSizePt: number): number => {
    const stepPct = (6 / pageSizePt) * 100;
    return Math.round(v / stepPct) * stepPct;
  };

  const clampBox = (b: CustomLayoutBox): CustomLayoutBox => ({
    ...b,
    xPct: Math.max(0, Math.min(90, Number(snap(b.xPct, contentWidthPt).toFixed(2)))),
    yPct: Math.max(0, Math.min(95, Number(snap(b.yPct, contentHeightPt).toFixed(2)))),
    widthPct: Math.max(
      10,
      Math.min(100 - Math.max(0, b.xPct), Number(snap(b.widthPct, contentWidthPt).toFixed(2)))
    ),
    heightPct: Math.max(
      5,
      Math.min(100 - Math.max(0, b.yPct), Number(snap(b.heightPct, contentHeightPt).toFixed(2)))
    ),
  });

  const onBoxPointerDown = (
    e: React.PointerEvent,
    box: CustomLayoutBox,
    mode: 'move' | 'resize'
  ) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedBoxId(box.id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    gestureRef.current = {
      boxId: box.id,
      mode,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startBox: { ...box },
    };
  };

  const onBoxPointerMove = (e: React.PointerEvent) => {
    if (vertexDragRef.current) {
      handleVertexPointerMove(e);
      return;
    }
    const g = gestureRef.current;
    if (!g) return;
    const { dxPct, dyPct } = pctFromClient(g.startBox, e.clientX - g.startClientX, e.clientY - g.startClientY);
    const next = shownBoxes.map(b => {
      if (b.id !== g.boxId) return b;
      if (g.mode === 'move') {
        return clampBox({ ...b, xPct: g.startBox.xPct + dxPct, yPct: g.startBox.yPct + dyPct });
      }
      return clampBox({
        ...b,
        widthPct: g.startBox.widthPct + dxPct,
        heightPct: g.startBox.heightPct + dyPct,
      });
    });
    setDragPreview(next);
  };

  const onBoxPointerUp = () => {
    if (vertexDragRef.current) {
      handleVertexPointerUp();
      return;
    }
    const g = gestureRef.current;
    gestureRef.current = null;
    if (!g || !dragPreview) return;
    commitBoxes(dragPreview);
  };

  const handleAddBox = (role: CustomLayoutBoxRole) => {
    const n = boxes.length;
    const box = makeCustomLayoutBox(
      role,
      5 + (n % 4) * 6,
      5 + (n % 4) * 6,
      role === 'footnote' || role === 'header' ? 90 : 42,
      role === 'footnote' || role === 'header' ? 10 : 34
    );
    commitBoxes([...boxes, box]);
    setSelectedBoxId(box.id);
  };

  const handleRemoveBox = (id: string) => {
    if (boxes.length <= 1) {
      setNotice(t('חייבת להישאר לפחות תיבה אחת בעמוד.'));
      return;
    }
    commitBoxes(boxes.filter(b => b.id !== id));
    setSelectedBoxId(null);
  };

  const handleResetToDefaults = () => {
    commitBoxes(defaultBoxesForBaseLayout(baseLayout));
    setSelectedBoxId(null);
    setNotice(t('התיבות אופסו לברירת המחדל של תבנית הבסיס.'));
  };

  const handleSaveTemplate = () => {
    const name = templateName.trim();
    if (!name) {
      setNotice(t('כתבו שם לתבנית לפני השמירה.'));
      return;
    }
    saveCustomLayoutTemplate(name, baseLayout, boxes);
    setTemplates(listCustomLayoutTemplates());
    setTemplateName('');
    setNotice(t('התבנית נשמרה — תוכלו להפעיל אותה בכל ספר.'));
  };

  const handleApplyTemplate = (id: string) => {
    const tpl = templates.find(t => t.id === id);
    if (!tpl) return;
    commitBoxes(tpl.boxes.map(b => ({ ...b })));
    if (onBaseLayoutChange && tpl.baseLayout !== baseLayout) {
      onBaseLayoutChange(tpl.baseLayout);
    }
    setNotice(t('התבנית הופעלה על העמוד.'));
  };

  // ── v0.9.0 Part B — template export / import (.keter-template.json) ──
  // Export: the host's handler (App) builds the recipe from the full book
  // settings; without a host handler the designer exports its own boxes.
  // Download uses the same anchor-download mechanism as ExportWorkspaceView
  // (browser download / Electron save), so it works in both.
  const handleExportTemplateFile = () => {
    if (onExportTemplate) {
      onExportTemplate();
      return;
    }
    const name = templateName.trim() || t('תבנית מותאמת אישית');
    const recipe = recipeFromBoxes(boxes, baseLayout, { nameHe: name, nameEn: name });
    const blob = new Blob([serializeRecipe(recipe)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.replace(/[\\/:*?"<>|]/g, '_')}${KETER_TEMPLATE_EXTENSION}`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setImportErrors(null);
    setNotice(t('התבנית יוצאה כקובץ keter-template.json.'));
  };

  // Import: the host's handler (App) validates and applies the recipe
  // through the preset-switch transaction; without a host handler the
  // designer validates locally and applies the frames to this design.
  // An invalid file never changes anything — the errors are shown in
  // plain language under the button.
  const handleImportTemplateFile = async (file: File) => {
    if (onImportTemplateFile) {
      onImportTemplateFile(file);
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      setImportErrors([t('לא הצלחנו לקרוא את הקובץ — נסו שוב.')]);
      return;
    }
    let recipe: LayoutRecipe;
    try {
      recipe = deserializeRecipe(text);
    } catch (e) {
      setImportErrors([e instanceof Error ? e.message : String(e)]);
      setNotice(null);
      return;
    }
    setImportErrors(null);
    commitBoxes(recipeToCustomLayoutBoxes(recipe));
    if (onBaseLayoutChange && recipe.baseLayout && recipe.baseLayout !== baseLayout) {
      onBaseLayoutChange(recipe.baseLayout);
    }
    setNotice(t('התבנית נטענה והוחלה על העמוד.'));
  };

  // ── v0.9.0 Part B — tier assignment + rule inspector ──────────────────
  // Both write into the box state (via commitBoxes), so the tier and the
  // rules ride along in saved templates and .keter-template.json exports.
  const handleBoxTierChange = (tier: CustomLayoutBoxTier) => {
    if (!selectedBox) return;
    commitBoxes(shownBoxes.map(b => (b.id === selectedBox.id ? { ...b, tier } : b)));
  };

  const handleBoxRulesChange = (patch: Partial<CustomLayoutBoxRules>) => {
    if (!selectedBox) return;
    const merged: CustomLayoutBoxRules = { ...(selectedBox.rules ?? {}), ...patch };
    // An explicitly cleared field leaves the rules object.
    for (const key of Object.keys(patch) as Array<keyof CustomLayoutBoxRules>) {
      if (patch[key] === undefined) delete merged[key];
    }
    const clean = sanitizeCustomLayoutBoxRules(
      Object.keys(merged).length > 0 ? merged : undefined
    );
    commitBoxes(
      shownBoxes.map(b =>
        b.id === selectedBox.id ? { ...b, rules: clean } : b
      )
    );
  };

  /** Parse a rule number input: '' clears the rule, garbage is ignored. */
  const ruleNumber = (value: string): number | undefined | null => {
    if (value.trim() === '') return undefined;
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return n;
  };

  const selectedBox = shownBoxes.find(b => b.id === selectedBoxId) ?? null;
  const gridXPct = (6 / contentWidthPt) * 100;
  const gridYPct = (6 / contentHeightPt) * 100;

  return (
    <div dir={dir} className="space-y-3">
      <div className="flex items-center gap-2">
        <LayoutTemplate className="w-4 h-4 text-[var(--ui-accent)] shrink-0" />
        <div>
          <div className="text-xs font-bold text-[var(--ui-text-primary)]">
            {t('מעצב כתבי־יד ופריסה מותאמת אישית')}
          </div>
          <Hint>
            {t('גררו כל תיבה למקום אחר בעמוד, ומשכו את הפינה הימנית התחתונה כדי לשנות את גודלה. בחרו שכבה לכל תיבה (רש״י, תוספות, גליון…) וקבעו כללים — גודל גופן, גובה שורה ויישור. הטקסט זורם לתוך התיבות לפי הסדר שלהן.')}
          </Hint>
        </div>
      </div>

      {/* Declutter: advanced controls (base layout, per-page scope,
          templates) live behind this disclosure; the essentials — preview,
          add-box, selected box — stay visible up front. */}
      <button
        type="button"
        onClick={() => setShowAdvanced(v => !v)}
        aria-expanded={showAdvanced}
        className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ui-accent)] hover:underline"
      >
        {showAdvanced ? (
          <ChevronUp className="w-3.5 h-3.5" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5" />
        )}
        <span>{t('אפשרויות נוספות')}</span>
      </button>

      {/* Base layout the boxes sit on — advanced (behind "More options") */}
      {showAdvanced && (
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <label className="font-semibold text-[var(--ui-text-secondary)]">
          {t('תבנית בסיס מתחת לתיבות:')}
        </label>
        <select
          value={baseLayout}
          onChange={e => {
            const next = e.target.value as BookLayoutType;
            onBaseLayoutChange?.(next);
            onBoxesChange(defaultBoxesForBaseLayout(next));
            setSelectedBoxId(null);
          }}
          className="bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2 py-1.5 text-xs text-[var(--ui-text-primary)]"
        >
          {BASE_LAYOUT_OPTIONS.map(o => (
            <option key={o.id} value={o.id}>
              {lang === 'en' ? o.labelEn : o.labelHe}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleResetToDefaults}
          className="px-2.5 py-1.5 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface-subtle)] hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-primary)] flex items-center gap-1"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>{t('איפוס תיבות')}</span>
        </button>
        {pageIndex !== null && onPageOverrideChange && (
          <label className="flex items-center gap-1.5 text-[var(--ui-text-secondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={perPageOnly}
              onChange={e => setPerPageOnly(e.target.checked)}
            />
            <span>{t('רק לדף זה (לא לכל הספר)')}</span>
          </label>
        )}
        {pageIndex !== null && pageOverrideExists && onClearPageOverride && (
          <button
            type="button"
            onClick={() => onClearPageOverride(pageIndex)}
            className="px-2.5 py-1.5 rounded-lg border border-[var(--ui-border)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]"
          >
            {t('בטל התאמה לדף זה')}
          </button>
        )}
      </div>
      )}

      {/* Page preview with draggable boxes */}
      <div className="flex flex-col lg:flex-row gap-4 items-start">
        <div
          ref={previewRef}
          dir="ltr"
          role="application"
          aria-label={t('תצוגת עמוד — גרירת תיבות')}
          className="relative shrink-0 w-full max-w-[380px] rounded-lg border border-[var(--ui-border-strong)] bg-[#FFFDF7] shadow-xs overflow-hidden select-none"
          style={{
            aspectRatio: `${contentWidthPt} / ${contentHeightPt}`,
            backgroundImage: `linear-gradient(rgba(52,74,103,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(52,74,103,0.07) 1px, transparent 1px)`,
            backgroundSize: `${gridXPct}% ${gridYPct}%`,
          }}
          onPointerMove={onBoxPointerMove}
          onPointerUp={onBoxPointerUp}
          onClick={() => setSelectedBoxId(null)}
        >
          {shownBoxes.map(box => {
            const isSelected = box.id === selectedBoxId;
            // v0.9.0 Part B — the rule inspector's font-size range clamps
            // the preview size, so the preview shows the rules in effect.
            const roleDefaultSize =
              box.role === 'main_text' ? 14.5 : box.role === 'footnote' ? 9.5 : 10.5;
            const rawSizePt = box.fontSizePt ?? roleDefaultSize;
            const clampedSizePt = Math.max(
              box.rules?.minFontSizePt ?? 6,
              Math.min(box.rules?.maxFontSizePt ?? 72, rawSizePt)
            );
            const fontSizePx = Math.max(7, clampedSizePt * previewScale);
            const boxLineHeight =
              box.rules?.lineHeightRatio ?? box.lineHeight ?? 1.32;
            return (
              <div
                key={box.id}
                role="button"
                tabIndex={0}
                aria-label={`${boxRoleLabel(box.role, lang)} — ${(lang === 'en' ? box.labelEn : box.labelHe) ?? ''}`}
                onPointerDown={e => onBoxPointerDown(e, box, 'move')}
                onClick={e => {
                  e.stopPropagation();
                  setSelectedBoxId(box.id);
                  setSelectedExclusionId(null);
                }}
                onKeyDown={e => {
                  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                  e.preventDefault();
                  const step = 1;
                  const next = shownBoxes.map(b => {
                    if (b.id !== box.id) return b;
                    if (e.shiftKey) {
                      return clampBox({
                        ...b,
                        widthPct: b.widthPct + (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0),
                        heightPct: b.heightPct + (e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0),
                      });
                    }
                    return clampBox({
                      ...b,
                      xPct: b.xPct + (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0),
                      yPct: b.yPct + (e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0),
                    });
                  });
                  commitBoxes(next);
                }}
                className={`absolute overflow-hidden cursor-move transition-shadow ${
                  isSelected ? 'ring-2 ring-[var(--ui-accent)] shadow-md z-10' : ''
                }`}
                style={{
                  left: `${box.xPct}%`,
                  top: `${box.yPct}%`,
                  width: `${box.widthPct}%`,
                  height: `${box.heightPct}%`,
                  backgroundColor: ROLE_TINT[box.role],
                  border: `1.5px ${isSelected ? 'solid' : 'dashed'} ${ROLE_BORDER[box.role]}`,
                }}
              >
                <div
                  className="flex items-center justify-between px-1.5 py-0.5 text-[9px] font-bold text-[#2A2622]"
                  style={{ backgroundColor: 'rgba(255,255,255,0.65)' }}
                >
                  <span className="flex items-center gap-1 truncate">
                    <Move className="w-2.5 h-2.5 shrink-0" />
                    <span className="truncate">
                      {(lang === 'en' ? box.labelEn : box.labelHe) ?? (lang === 'en' ? CUSTOM_LAYOUT_BOX_ROLE_LABELS_EN[box.role] : CUSTOM_LAYOUT_BOX_ROLE_LABELS_HE[box.role])}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono">
                    {Math.round(box.widthPct)}×{Math.round(box.heightPct)}%
                  </span>
                </div>
                <div
                  dir="rtl"
                  className="px-1.5 py-1 text-start text-[#2A2622] leading-snug overflow-hidden"
                  style={{
                    fontSize: `${fontSizePx}px`,
                    fontFamily: '"Frank Ruhl Libre", serif',
                    // v0.9.0 Part B — the rule inspector's alignment and
                    // line height apply to the fitted preview text.
                    textAlign: box.rules?.alignment ?? 'right',
                    lineHeight: boxLineHeight,
                    // v0.6.0 Part C (§2): the fitted text is clipped to the
                    // polygon, so the preview shows the real flow region.
                    clipPath: box.shape ? polygonClipCss(box.shape.points) : undefined,
                  }}
                >
                  {textForBox(box.id)}
                </div>
                {/* v0.6.0 Part C (§2): polygon + cut-out outlines. */}
                {box.shape && (
                  <svg
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <polygon
                      points={box.shape.points.map(p => `${p.x * 100},${p.y * 100}`).join(' ')}
                      fill="none"
                      stroke={ROLE_BORDER[box.role]}
                      strokeWidth={1.5}
                      vectorEffect="non-scaling-stroke"
                      strokeDasharray="4 2"
                    />
                  </svg>
                )}
                {(box.exclusions ?? []).map(ex => (
                  <svg
                    key={ex.id}
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <polygon
                      points={ex.points.map(p => `${p.x * 100},${p.y * 100}`).join(' ')}
                      fill="rgba(180,40,40,0.10)"
                      stroke="#B42828"
                      strokeWidth={1.5}
                      vectorEffect="non-scaling-stroke"
                      strokeDasharray="3 2"
                    />
                  </svg>
                ))}
                {isSelected && (
                  <>
                    <button
                      type="button"
                      aria-label={t('מחק תיבה')}
                      onPointerDown={e => e.stopPropagation()}
                      onClick={e => {
                        e.stopPropagation();
                        handleRemoveBox(box.id);
                      }}
                      className="absolute top-0.5 left-0.5 p-0.5 rounded bg-white/90 border border-[var(--ui-border)] text-[var(--ui-danger)]"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                    <div
                      role="button"
                      aria-label={t('שנה גודל')}
                      onPointerDown={e => onBoxPointerDown(e, box, 'resize')}
                      className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize flex items-end justify-end bg-white/80 border-t border-l border-[var(--ui-border)] rounded-tl"
                    >
                      <Grip className="w-3 h-3 text-[var(--ui-text-secondary)]" />
                    </div>
                  </>
                )}
              </div>
            );
          })}
          {/* v0.6.0 Part C (§2): vertex handles + edge-split points for the
              selected box's polygon (or its selected cut-out), plus the
              smart-snapping guide lines while a vertex is dragged. */}
          {selectedBox && selectedPolygonPoints && (
            <div className="absolute inset-0 pointer-events-none z-20">
              {guideLines?.xPct !== undefined && (
                <div
                  className="absolute top-0 bottom-0 border-l border-dashed border-[#B42828]"
                  style={{ left: `${guideLines.xPct}%` }}
                />
              )}
              {guideLines?.yPct !== undefined && (
                <div
                  className="absolute left-0 right-0 border-t border-dashed border-[#B42828]"
                  style={{ top: `${guideLines.yPct}%` }}
                />
              )}
              {selectedPolygonPoints.map((pt, i) => (
                <div
                  key={`v-${selectedExclusionId ?? 'shape'}-${i}`}
                  role="button"
                  aria-label={t('גרור נקודה')}
                  onPointerDown={e =>
                    onVertexPointerDown(e, selectedBox, selectedExclusionId, i, selectedPolygonPoints)
                  }
                  onClick={e => e.stopPropagation()}
                  className="absolute w-3 h-3 rounded-full bg-white border-2 border-[var(--ui-accent)] cursor-grab pointer-events-auto"
                  style={{
                    left: `${selectedBox.xPct + pt.x * selectedBox.widthPct}%`,
                    top: `${selectedBox.yPct + pt.y * selectedBox.heightPct}%`,
                    transform: 'translate(-50%, -50%)',
                  }}
                />
              ))}
              {selectedPolygonPoints.map((pt, i) => {
                const next = selectedPolygonPoints[(i + 1) % selectedPolygonPoints.length];
                return (
                  <div
                    key={`m-${selectedExclusionId ?? 'shape'}-${i}`}
                    role="button"
                    aria-label={t('הוסף נקודה באמצע הצלע')}
                    title={t('לחץ כדי להוסיף נקודה באמצע הצלע')}
                    onPointerDown={e =>
                      onEdgeMidpointPointerDown(e, selectedBox, selectedExclusionId, i, selectedPolygonPoints)
                    }
                    onClick={e => e.stopPropagation()}
                    className="absolute w-2.5 h-2.5 rounded-full bg-[var(--ui-accent)] text-white text-[8px] leading-none flex items-center justify-center cursor-copy pointer-events-auto"
                    style={{
                      left: `${selectedBox.xPct + ((pt.x + next.x) / 2) * selectedBox.widthPct}%`,
                      top: `${selectedBox.yPct + ((pt.y + next.y) / 2) * selectedBox.heightPct}%`,
                      transform: 'translate(-50%, -50%)',
                    }}
                  >
                    +
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Side controls */}
        <div className="flex-1 min-w-0 space-y-3 text-xs w-full">
          <div>
            <div className="font-semibold text-[var(--ui-text-secondary)] mb-1.5">
              {t('הוספת תיבה:')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {BOX_ROLE_ORDER.map(role => (
                <button
                  key={role}
                  type="button"
                  onClick={() => handleAddBox(role)}
                  className="px-2.5 py-1.5 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface-subtle)] hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-primary)] flex items-center gap-1 whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5 shrink-0" />
                  <span>{lang === 'en' ? CUSTOM_LAYOUT_BOX_ROLE_LABELS_EN[role] : CUSTOM_LAYOUT_BOX_ROLE_LABELS_HE[role]}</span>
                </button>
              ))}
            </div>
          </div>

          {/* v0.9.0 Part B — template file (.keter-template.json):
              export the current layout to a file, or load one from disk.
              Import validates first; an invalid file changes nothing and
              its errors are listed below in plain language. */}
          <div className="rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface-subtle)] p-3 space-y-2">
            <div className="font-bold text-[var(--ui-text-primary)]">
              {t('קובץ תבנית (.keter-template.json)')}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleExportTemplateFile}
                className="px-2.5 py-1.5 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-primary)] flex items-center gap-1.5 whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5 shrink-0" />
                <span>{t('ייצוא התבנית לקובץ')}</span>
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-2.5 py-1.5 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-primary)] flex items-center gap-1.5 whitespace-nowrap"
              >
                <Upload className="w-3.5 h-3.5 shrink-0" />
                <span>{t('ייבוא תבנית מקובץ')}</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                aria-label={t('בחרו קובץ תבנית keter-template.json')}
                onChange={e => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void handleImportTemplateFile(file);
                }}
              />
            </div>
            <p className="text-[var(--ui-text-secondary)] leading-relaxed">
              {t('הקובץ שומר את התיבות, השכבות והכללים — אפשר לשלוח אותו לספר אחר או לשמור אותו כגיבוי.')}
            </p>
            {importErrors && (
              <div
                role="alert"
                className="rounded-lg border border-[var(--ui-danger)]/40 bg-[var(--ui-danger)]/5 p-2 space-y-1"
              >
                <div className="font-bold text-[var(--ui-danger)]">
                  {t('הקובץ אינו תבנית תקינה — לא הוחל שום שינוי:')}
                </div>
                <ul className="list-disc ps-4 space-y-0.5 text-[var(--ui-text-primary)]">
                  {importErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {selectedBox && (
            <div className="rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface-subtle)] p-2.5 space-y-1.5">
              <div className="font-bold text-[var(--ui-text-primary)]">
                {t('התיבה הנבחרת:')} {(lang === 'en' ? selectedBox.labelEn : selectedBox.labelHe) ?? (lang === 'en' ? CUSTOM_LAYOUT_BOX_ROLE_LABELS_EN[selectedBox.role] : CUSTOM_LAYOUT_BOX_ROLE_LABELS_HE[selectedBox.role])}
              </div>
              <div className="text-[var(--ui-text-secondary)]">
                {t('מיקום:')} {Math.round(selectedBox.xPct)}%, {Math.round(selectedBox.yPct)}% ·{' '}
                {t('גודל:')} {Math.round(selectedBox.widthPct)}% × {Math.round(selectedBox.heightPct)}%
              </div>
              <div className="text-[var(--ui-text-secondary)]">
                {(() => {
                  const cap = estimateBoxCapacity(
                    selectedBox,
                    contentWidthPt,
                    contentHeightPt,
                    selectedBox.fontSizePt ?? (selectedBox.role === 'main_text' ? 14.5 : 10.5)
                  );
                  return `${t('נכנסות בה בערך')} ${cap.words} ${t('מילים')} (${cap.lines} ${t('שורות')})`;
                })()}
              </div>
              <div className="text-[var(--ui-text-secondary)]">
                {t('מקשי חצים מזיזים את התיבה; Shift + חצים משנים את גודלה.')}
              </div>

              {/* v0.9.0 Part B — tier assignment + rule inspector. Both
                  persist on the box (saved templates + template files). */}
              <div className="pt-2 border-t border-[var(--ui-border)] space-y-2">
                <div className="font-bold text-[var(--ui-text-primary)]">
                  {t('שכבה וכללים לתיבה זו:')}
                </div>
                <label className="block">
                  <span className="block text-[var(--ui-text-secondary)] mb-0.5">
                    {t('השכבה של התיבה (מה היא מכילה):')}
                  </span>
                  <select
                    value={effectiveBoxTier(selectedBox)}
                    onChange={e =>
                      handleBoxTierChange(e.target.value as CustomLayoutBoxTier)
                    }
                    className="w-full bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-lg px-2 py-1.5 text-xs text-[var(--ui-text-primary)]"
                  >
                    {CUSTOM_LAYOUT_BOX_TIERS.map(tier => (
                      <option key={tier} value={tier}>
                        {t(boxTierLabel(tier, lang))}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="block text-[var(--ui-text-secondary)] mb-0.5">
                      {t('גופן מינימלי (pt)')}
                    </span>
                    <input
                      type="number"
                      min={6}
                      max={72}
                      step={0.5}
                      value={selectedBox.rules?.minFontSizePt ?? ''}
                      placeholder={t('ללא הגבלה')}
                      onChange={e => {
                        const v = ruleNumber(e.target.value);
                        if (v === null) return;
                        handleBoxRulesChange({ minFontSizePt: v });
                      }}
                      className="w-full bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-lg px-2 py-1.5 text-xs text-[var(--ui-text-primary)]"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-[var(--ui-text-secondary)] mb-0.5">
                      {t('גופן מקסימלי (pt)')}
                    </span>
                    <input
                      type="number"
                      min={6}
                      max={72}
                      step={0.5}
                      value={selectedBox.rules?.maxFontSizePt ?? ''}
                      placeholder={t('ללא הגבלה')}
                      onChange={e => {
                        const v = ruleNumber(e.target.value);
                        if (v === null) return;
                        handleBoxRulesChange({ maxFontSizePt: v });
                      }}
                      className="w-full bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-lg px-2 py-1.5 text-xs text-[var(--ui-text-primary)]"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-[var(--ui-text-secondary)] mb-0.5">
                      {t('גובה שורה (יחס)')}
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={2.2}
                      step={0.05}
                      value={selectedBox.rules?.lineHeightRatio ?? ''}
                      placeholder="1.32"
                      onChange={e => {
                        const v = ruleNumber(e.target.value);
                        if (v === null) return;
                        handleBoxRulesChange({ lineHeightRatio: v });
                      }}
                      className="w-full bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-lg px-2 py-1.5 text-xs text-[var(--ui-text-primary)]"
                    />
                  </label>
                  {/* v0.9.2 Part A (A1): the column-gutter field was removed —
                      a single box holds one column, so the value had no
                      effect anywhere (the type field is kept: recipes may
                      still carry it, and the template round-trip preserves
                      it). */}
                </div>
                <label className="block">
                  <span className="block text-[var(--ui-text-secondary)] mb-0.5">
                    {t('יישור הטקסט בתיבה:')}
                  </span>
                  <select
                    value={selectedBox.rules?.alignment ?? ''}
                    onChange={e => {
                      const v = e.target.value;
                      handleBoxRulesChange({
                        alignment:
                          v === ''
                            ? undefined
                            : (v as NonNullable<CustomLayoutBoxRules['alignment']>),
                      });
                    }}
                    className="w-full bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-lg px-2 py-1.5 text-xs text-[var(--ui-text-primary)]"
                  >
                    <option value="">{t('ברירת מחדל (ימין)')}</option>
                    <option value="justify">{t('מיושר לשני הצדדים')}</option>
                    <option value="right">{t('ימין')}</option>
                    <option value="center">{t('מרכז')}</option>
                    <option value="left">{t('שמאל')}</option>
                  </select>
                </label>
              </div>

              {/* v0.6.0 Part C (§2): polygonal frame for this box. */}
              <div className="pt-2 border-t border-[var(--ui-border)] space-y-2">
                <div className="font-bold text-[var(--ui-text-primary)] flex items-center gap-1.5">
                  <Shapes className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
                  <span>{t('צורת התיבה:')}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {CUSTOM_LAYOUT_POLYGON_KINDS.map(kind => {
                    const active =
                      kind === 'rectangle'
                        ? !selectedBox.shape
                        : selectedBox.shape?.kind === kind;
                    return (
                      <button
                        key={kind}
                        type="button"
                        onClick={() => handleShapeKind(kind)}
                        aria-pressed={active}
                        className={`px-2 py-1 rounded-lg border text-[11px] ${
                          active
                            ? 'border-[var(--ui-accent)] bg-[var(--ui-selected-bg)] text-[var(--ui-accent)] font-bold'
                            : 'border-[var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-text-primary)] hover:bg-[var(--ui-surface-hover)]'
                        }`}
                      >
                        {t(CUSTOM_LAYOUT_POLYGON_LABELS_HE[kind])}
                      </button>
                    );
                  })}
                </div>
                {selectedBox.shape && (
                  <p className="text-[var(--ui-text-secondary)]">
                    {t('גררו את הנקודות הלבנות כדי לעצב את המצולע; לחצו על + באמצע צלע כדי להוסיף נקודה. הנקודות נצמדות לרשת ולקווים של נקודות אחרות.')}
                  </p>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={handleAddExclusion}
                    className="px-2 py-1 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-text-primary)] hover:bg-[var(--ui-surface-hover)] flex items-center gap-1"
                  >
                    <Scissors className="w-3 h-3" />
                    <span>{t('הוסף חיתוך (הטקסט יעקוף אותו)')}</span>
                  </button>
                  {(selectedBox.exclusions ?? []).map(ex => (
                    <span
                      key={ex.id}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] ${
                        selectedExclusionId === ex.id
                          ? 'border-[#B42828] bg-[#B42828]/10 text-[#B42828] font-bold'
                          : 'border-[var(--ui-border)] bg-[var(--ui-surface)]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedExclusionId(ex.id)}
                      >
                        {t('חיתוך')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveExclusion(ex.id)}
                        aria-label={t('מחק חיתוך')}
                        className="text-[var(--ui-danger)]"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
                {selectedExclusionId && (
                  <p className="text-[var(--ui-text-secondary)]">
                    {t('עורכים כעת את החיתוך — גררו את נקודותיו. לחצו על התיבה כדי לחזור לצורתה.')}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Templates — advanced (behind "More options") */}
          {showAdvanced && (
          <div className="rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface-subtle)] p-2.5 space-y-2">
            <div className="font-bold text-[var(--ui-text-primary)]">
              {t('תבניות שמורות — לשימוש חוזר בכל ספר')}
            </div>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={templateName}
                onChange={e => setTemplateName(e.target.value)}
                placeholder={t('שם לתבנית, למשל: ש״ס קומפקטי')}
                className="flex-1 min-w-0 bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--ui-text-primary)] focus:outline-none focus:border-[var(--ui-accent)]"
              />
              <button
                type="button"
                onClick={handleSaveTemplate}
                className="px-2.5 py-1.5 rounded-lg bg-[var(--ui-accent)] text-white font-semibold flex items-center gap-1 shrink-0"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{t('שמור תבנית')}</span>
              </button>
            </div>
            {templates.length === 0 ? (
              <p className="text-[var(--ui-text-secondary)]">
                {t('עדיין לא נשמרו תבניות.')}
              </p>
            ) : (
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {templates.map(tpl => (
                  <div
                    key={tpl.id}
                    className="flex items-center justify-between gap-2 rounded-lg bg-[var(--ui-surface)] border border-[var(--ui-border)] px-2 py-1.5"
                  >
                    <button
                      type="button"
                      onClick={() => handleApplyTemplate(tpl.id)}
                      className="flex-1 text-start font-medium text-[var(--ui-text-primary)] truncate"
                      title={t('הפעל תבנית זו')}
                    >
                      {tpl.nameHe} · {tpl.boxes.length} {t('תיבות')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        deleteCustomLayoutTemplate(tpl.id);
                        setTemplates(listCustomLayoutTemplates());
                      }}
                      className="p-1 text-[var(--ui-text-muted)] hover:text-[var(--ui-danger)]"
                      title={t('מחק תבנית')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          )}

          {notice && (
            <p className="text-[var(--ui-success)] text-[11px]">{notice}</p>
          )}
          {!compact && (
            <Hint>
              {t('התיבות נשמרות עם הספר בקובץ ה־.keter, והתבניות נשמרות במחשב לשימוש חוזר.')}
            </Hint>
          )}
        </div>
      </div>
    </div>
  );
};
