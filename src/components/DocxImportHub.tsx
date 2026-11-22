import React, { useEffect, useRef, useState } from 'react';
import { DocxImporter, flagUncertainMatches, describeConfidence, type DocxImportResult } from '../engine/docx-importer';
import { classifyForImport, type AutoLayoutImportInfo } from '../engine/auto-layout';
import { analyzeImportedDocx, formatPreviewCounts, type DocxPreviewStats } from '../engine/docx-semantics';
// v0.9.8 Phase 3 — CommentaryLinkerEngine: the new fuzzy dibbur linker
// runs over the old linker's output and the merge keeps the
// higher-confidence link per commentary; the LinkingReport surfaces in
// the EXISTING review queue below (no second review UI).
import {
  linkCommentariesToSource,
  anchorLinksToRavTextLinks,
  mergeLinkSets,
  buildLinkingReport,
  formatLinkingReportSummary,
} from '../engine/commentary-linker';
// v0.9.8 Phase 1 — Sefer Wizard Step 2/3: archetype slot matrix.
// v0.9.9 — the pending-archetype seam is gone: the parent passes the
// chosen setup to App explicitly, so the hub saves nothing at import.
import {
  getArchetypeById,
  wizardStep2Title,
  wizardSlotLabel,
  wizardSlotHint,
  type SeferArchetypeId,
  type WizardSlot,
} from '../engine/sefer-wizard';
import { ContentRole, ContentUnit, RavTextLink, type LinkingReport } from '../types/typesetter';
import { FileUp, BookOpen, Scroll, CheckCircle, X, Sparkles, ShieldCheck, Files, Link2, Trash2, Plus, Loader2, ArrowLeft, ArrowRight } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';

/**
 * v0.9.7 — ONE shared DOCX import hub, rendered in TWO places: inline
 * in the Home screen's DOCX card, and inside DocxImportModal.
 *
 * The v0.9.2 lesson applies: the old inline importer was removed
 * because it was a SECOND copy (its own layout decision, its own
 * staging) that drifted from the modal. The user now explicitly wants
 * the hub VISIBLE on the start screen — so it comes back, but as this
 * one shared component, not as a second copy: one file-list + role
 * tagging + process flow + review queues, one import engine
 * (DocxImporter + classifyForImport), no second layout decision.
 * Both entry points call the same onImportUnits with the same units,
 * links and auto-layout decision.
 *
 * v0.9.8 Uniformity Audit — the hub has ONE tone now (theme vars):
 * the modal used to be a hardcoded dark (stone-900) card with a
 * `variant="dark"` tone, while the inline Home card used theme vars.
 * All dialogs now share the theme surface, so the modal hub uses the
 * same light tone; the dark tone map is removed, not left dead.
 */

export type DocxImportHubVariant = 'light';

interface DocxImportHubProps {
  onImportUnits: (units: ContentUnit[], title: string, links?: RavTextLink[], autoLayout?: AutoLayoutImportInfo) => void;
  /** Modal only: closes the dialog after a completed import. Inline Home has no dialog to close. */
  onClose?: () => void;
  variant: DocxImportHubVariant;
  /** testid prefix, so the inline hub and the modal hub can be told apart. */
  testIdPrefix: string;
  /**
   * v0.9.8 Phase 1 — wizard Step 2: the archetype whose slot matrix
   * this hub renders. When set, the generic dropzone + file list are
   * replaced by one dropzone per slot (role preset by the slot) and
   * per-file preview stats; when unset the hub behaves exactly as in
   * v0.9.7.
   */
  archetypeId?: SeferArchetypeId | null;
  /**
   * v0.9.9 — explicit per-layout slot matrix from the parent (Home
   * passes slotMatrixForStartOption for the picked start card). Wins
   * over the archetype's own slots: Yiddish / Siddur / two-column /
   * source-top cards map to the generic 'classic' archetype, whose
   * slots would be wrong for them. When absent, the archetype's slots
   * are used exactly as before (modal hub passes neither).
   */
  slotsOverride?: WizardSlot[];
  /**
   * v0.9.8 Phase 1 — wizard Step 3: label for the import button
   * ("Generate & Open Typesetting Studio"). Defaults to the v0.9.7 import label.
   */
  generateLabel?: string;
  /** Hide the legacy one-click sample document grid (used by the streamlined Home 2-step wizard). */
  hideSamples?: boolean;
  /** Optional explicit book title entered in the wizard; overrides filename-derived title on import. */
  projectTitleOverride?: string;
  /** Optional quiet fallback action when no files are uploaded yet in wizard mode. */
  onStartEmptyInArchetype?: () => void;
  /** Optional override for the quiet-fallback link label (Home passes the sample
      label when its starter mode is 'sample', so the link never lies). */
  startEmptyLabel?: string;
  /** Notifies parent when staged file count changes. */
  onFileCountChange?: (count: number) => void;
  /** Optional hook executed right before parsing/importing files so parent can persist explicit layout/recipe/custom boxes. */
  onBeforeImport?: () => void;
}

interface UploadedFileEntry {
  /** Stable id (previews + cached parses are keyed by it). */
  id: string;
  file: File;
  name: string;
  role: ContentRole;
  sizeKb: number;
  /** Wizard slot this file was dropped into (slot mode only). */
  slotKey?: string;
}

/**
 * v0.9.7 — the role a file can be tagged with. These are the engine's
 * REAL roles (ContentRole), not a second taxonomy:
 * - main_source: the central text (Gemara / Chumash / Mishnah).
 * - verse: a verse / Targum file. Targum Onkelos has no separate engine
 *   role; it maps to 'verse' — the classifier's 'verse-targum' role
 *   pattern (verse present + Onkelos author) recognises it, and the
 *   verse tier flows as the top text in Mikraot Gedolot. Recorded in
 *   MANIFEST.md; never silently relabelled.
 * - primary_comment: first commentary (Rashi — inner flank).
 * - secondary_comment: second commentary (Tosafot — outer flank).
 * - tertiary_comment: third commentary (Ein Mishpat / Masoret HaShas /
 *   a third mefaresh — flows in the tertiary band below the knee).
 * - footnote: footnote band.
 * A generic "Meforshim" option is deliberately NOT offered: it has no
 * engine meaning, and the three commentary tiers already cover it.
 */
export const DOCX_HUB_ROLE_OPTIONS: ReadonlyArray<{ role: ContentRole; labelHe: string; labelEn: string }> =
  Object.freeze([
    { role: 'main_source', labelHe: 'טקסט מקור ראשי (גמרא / חומש)', labelEn: 'Main source text (Gemara / Chumash)' },
    { role: 'verse', labelHe: 'פסוק / תרגום (תרגום אונקלוס)', labelEn: 'Verse / Targum (Targum Onkelos)' },
    { role: 'primary_comment', labelHe: 'פירוש ראשון (רש״י)', labelEn: 'First commentary (Rashi)' },
    { role: 'secondary_comment', labelHe: 'פירוש שני (תוספות)', labelEn: 'Second commentary (Tosafot)' },
    { role: 'tertiary_comment', labelHe: 'פירוש שלישי (עין משפט / מסורת הש״ס)', labelEn: 'Third commentary (Ein Mishpat / Mesorat HaShas)' },
    { role: 'footnote', labelHe: 'הערות שוליים', labelEn: 'Footnotes' },
  ]);

/**
 * v0.9.7 — body roles the user's per-file tag may retag. The user's tag
 * WINS for body units: previously the retag only fired when the importer
 * had classified a unit as main_source, so a file tagged
 * tertiary_comment kept its importer-guessed primary_comment units.
 * Structural roles are never retagged: footnotes (from
 * word/footnotes.xml), headings/chapters/titles keep their structure.
 */
export const DOCX_HUB_RETAGGABLE_ROLES: ReadonlyArray<ContentRole> = Object.freeze([
  'main_source',
  'verse',
  'primary_comment',
  'secondary_comment',
  'tertiary_comment',
  'regular_paragraph',
]);

const TONE: Record<
  DocxImportHubVariant,
  {
    panel: string;
    text: string;
    strong: string;
    muted: string;
    faint: string;
    input: string;
    dropIdle: string;
    rowHover: string;
    ghostBtn: string;
    warnTitle: string;
    warnBox: string;
    sampleBtn: string;
    sampleTitle: string;
    sampleSub: string;
    statusText: string;
    footer: string;
  }
> = {
  light: {
    panel: 'bg-[var(--ui-surface-subtle)] border-[var(--ui-border)]',
    text: 'text-[var(--ui-text-primary)]',
    strong: 'text-[var(--ui-text-primary)]',
    muted: 'text-[var(--ui-text-secondary)]',
    faint: 'text-[var(--ui-text-muted)]',
    input: 'bg-[var(--ui-surface)] border-[var(--ui-border)] text-[var(--ui-text-primary)]',
    dropIdle: 'border-[var(--ui-border-strong)] hover:border-[var(--ui-accent)] bg-[var(--ui-surface-subtle)]/60',
    rowHover: 'hover:bg-[var(--ui-surface-hover)]',
    ghostBtn:
      'bg-[var(--ui-surface-subtle)] hover:bg-[var(--ui-surface-hover)] border border-[var(--ui-border)] text-[var(--ui-text-secondary)]',
    warnTitle: 'text-amber-700',
    warnBox: 'bg-[var(--ui-surface-subtle)] border-[var(--ui-accent)]/40',
    sampleBtn: 'bg-[var(--ui-surface-subtle)] border-[var(--ui-border)] hover:border-[var(--ui-accent)]',
    sampleTitle: 'text-[var(--ui-text-primary)]',
    sampleSub: 'text-[var(--ui-text-secondary)]',
    statusText: 'text-[var(--ui-text-secondary)]',
    footer: 'pt-3 border-t border-[var(--ui-border)] flex items-center justify-between gap-2 flex-wrap text-xs',
  },
};

export const DocxImportHub: React.FC<DocxImportHubProps> = ({
  onImportUnits,
  onClose,
  variant,
  testIdPrefix,
  archetypeId,
  slotsOverride,
  generateLabel,
  hideSamples = false,
  projectTitleOverride,
  onStartEmptyInArchetype,
  startEmptyLabel,
  onFileCountChange,
  onBeforeImport,
}) => {
  const { t, tf, lang, dir } = useLanguage();
  const tone = TONE[variant];
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // v0.9.8 Phase 1 — wizard slots + per-file preview stats. The
  // preview parse result is cached so the real import reuses it instead
  // of parsing the same file twice.
  const archetype = getArchetypeById(archetypeId ?? undefined);
  const idCounterRef = useRef(0);
  const parsedCacheRef = useRef(new Map<string, DocxImportResult>());
  const [extraSlots, setExtraSlots] = useState<WizardSlot[]>([]);
  const [filePreviews, setFilePreviews] = useState<Record<string, DocxPreviewStats>>({});
  // v0.9.9 — the slot matrix is the override when given, else the
  // archetype's own slots (unchanged behaviour for the modal hub).
  const baseSlots: WizardSlot[] = slotsOverride ?? archetype?.slots ?? [];
  const slots: WizardSlot[] = baseSlots.length > 0 ? [...baseSlots, ...extraSlots] : [];

  const [filesList, setFilesList] = useState<UploadedFileEntry[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [dragOverSlotKey, setDragOverSlotKey] = useState<string | null>(null);
  const [autoDiscoverLinks, setAutoDiscoverLinks] = useState(true);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // When the slot matrix changes (a different start card, including a
  // change between two cards that share one archetype, e.g. Yiddish ->
  // Siddur, both 'classic'), drop the extra slots and any file staged
  // into a slot that no longer exists.
  const prevSlotsKeyRef = useRef<string>(slotsOverride ? slotsOverride.map(s => s.key).join('|') : (archetypeId ?? ''));
  useEffect(() => {
    const key = slotsOverride ? slotsOverride.map(s => s.key).join('|') : (archetypeId ?? '');
    if (prevSlotsKeyRef.current !== key) {
      prevSlotsKeyRef.current = key;
      setExtraSlots([]);
      setDragOverSlotKey(null);
      const validKeys = new Set<string>(baseSlots.map(s => s.key));
      setFilesList(prev => prev.filter(f => !f.slotKey || validKeys.has(f.slotKey)));
    }
    // baseSlots is derived from slotsOverride/archetypeId (the deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archetypeId, slotsOverride]);

  useEffect(() => {
    onFileCountChange?.(filesList.length);
  }, [filesList.length, onFileCountChange]);

  const resetAfterImport = () => {
    setFilesList([]);
    setReviewLinks(null);
    setReviewSources([]);
    setLinkingReport(null);
    setPendingImport(null);
    setReviewActions({});
    setReviewReassign({});
    setImportWarnings(null);
    setImportStatus(null);
    setErrorMessage(null);
    // v0.9.8 Phase 1 — wizard state resets with the import.
    setExtraSlots([]);
    setFilePreviews({});
    parsedCacheRef.current.clear();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // v0.3.0 — review queue for uncertain dibur-hamatchil matches.
  // Uncertain links are NEVER applied silently: when any link scores
  // below the confidence threshold, the import is held here until the
  // user accepts, reassigns, or drops each one (or takes confident only).
  const [reviewLinks, setReviewLinks] = useState<RavTextLink[] | null>(null);
  const [reviewSources, setReviewSources] = useState<ContentUnit[]>([]);
  // v0.9.8 Phase 3 — LinkingReport for the run behind the review queue
  // (shown as one summary line above the uncertain links; cleared on reset).
  const [linkingReport, setLinkingReport] = useState<LinkingReport | null>(null);
  const [pendingImport, setPendingImport] = useState<{
    units: ContentUnit[];
    title: string;
    confidentLinks: RavTextLink[];
    /** v0.9.0 Part C — auto-layout decision, carried through the review/warning holds. */
    autoLayout?: AutoLayoutImportInfo;
  } | null>(null);
  const [reviewActions, setReviewActions] = useState<
    Record<string, 'accepted' | 'reassigned' | 'dropped'>
  >({});
  const [reviewReassign, setReviewReassign] = useState<Record<string, string>>({});

  // v0.8.0 Part E — import warnings review (e.g. images dropped from the
  // DOCX). Warnings are NEVER swallowed: the import is held here until
  // the user reads them and explicitly continues.
  const [importWarnings, setImportWarnings] = useState<string[] | null>(null);

  /**
   * v0.8.0 Part E — shared tail of the import: uncertain dibur links go
   * to the review queue, everything else imports immediately. Used both
   * straight from handleProcessImport and after the warnings review.
   *
   * v0.9.0 Part C — auto-layout is computed here (deterministic, offline)
   * for every import and travels with the units through the review holds,
   * so the layout decision is never lost when the import is held.
   */
  const proceedWithLinks = (
    allUnits: ContentUnit[],
    primaryTitle: string,
    discoveredLinks: RavTextLink[]
  ) => {
    const autoLayout = classifyForImport(allUnits, discoveredLinks, {
      fileName: primaryTitle,
      hasFootnotes: allUnits.some(u => u.role === 'footnote'),
    });
    const uncertain = flagUncertainMatches(discoveredLinks);
    if (uncertain.length > 0) {
      const confident = discoveredLinks.filter(l => !uncertain.includes(l));
      setPendingImport({ units: allUnits, title: primaryTitle, confidentLinks: confident, autoLayout });
      setReviewLinks(uncertain);
      setReviewSources(
        allUnits.filter(u => u.role === 'main_source' || u.role === 'chapter')
      );
      setReviewActions({});
      setReviewReassign({});
      setImportStatus(t('נמצאו קישורים לא ודאיים — יש לסקור אותם לפני היבוא.'));
      return;
    }
    onImportUnits(allUnits, primaryTitle, discoveredLinks, autoLayout);
    resetAfterImport();
    onClose?.();
  };

  const continueAfterWarnings = () => {
    if (!pendingImport) return;
    const { units, title, confidentLinks } = pendingImport;
    setImportWarnings(null);
    setPendingImport(null);
    proceedWithLinks(units, title, confidentLinks);
  };

  /**
   * v0.9.8 Phase 1 — per-file preview: parse the file once (cached) and
   * show word count + detected Perek/Daf/Pasuk markers + dibbur count
   * BEFORE "Generate Sefer Layout" is clicked. Best-effort: a preview
   * failure shows nothing and the real import surfaces the error.
   */
  const parsePreviewForEntry = async (entry: UploadedFileEntry) => {
    try {
      const buffer = await entry.file.arrayBuffer();
      const res = await DocxImporter.importDocx(buffer, entry.name);
      parsedCacheRef.current.set(entry.id, res);
      setFilePreviews(prev => ({ ...prev, [entry.id]: analyzeImportedDocx(res.units) }));
    } catch {
      // No preview; the import step will report the failure.
    }
  };

  const handleFilesAdded = (files: FileList | File[], slotKey?: string) => {
    const slot = slotKey ? slots.find(s => s.key === slotKey) : undefined;
    const newEntries: UploadedFileEntry[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.name.toLowerCase().endsWith('.docx')) continue;

      // v0.9.8 Phase 1 — a file dropped into a wizard slot takes the
      // slot's role instantly (no guessing); otherwise the v0.9.7
      // filename auto-detect applies.
      const detectedRole = slot ? slot.role : DocxImporter.autoDetectRole(file.name, '');
      newEntries.push({
        id: `hub-${++idCounterRef.current}`,
        file,
        name: file.name,
        role: detectedRole,
        sizeKb: Math.round(file.size / 1024),
        slotKey,
      });
    }
    if (newEntries.length === 0) return;

    // One file per wizard slot: dropping into an occupied slot replaces it.
    const replaced = slotKey ? filesList.filter(e => e.slotKey === slotKey) : [];
    for (const old of replaced) {
      parsedCacheRef.current.delete(old.id);
      setFilePreviews(prev => {
        const next = { ...prev };
        delete next[old.id];
        return next;
      });
    }

    const toAdd = slotKey ? newEntries.slice(0, 1) : newEntries;
    setFilesList(prev => {
      if (!slotKey) return [...prev, ...newEntries];
      return [...prev.filter(e => e.slotKey !== slotKey), ...toAdd];
    });
    for (const entry of toAdd) void parsePreviewForEntry(entry);
  };

  const handleRemoveFile = (index: number) => {
    setFilesList(prev => {
      const removed = prev[index];
      if (removed) {
        parsedCacheRef.current.delete(removed.id);
        setFilePreviews(p => {
          const next = { ...p };
          delete next[removed.id];
          return next;
        });
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleRoleChange = (index: number, newRole: ContentRole) => {
    setFilesList(prev =>
      prev.map((item, i) => (i === index ? { ...item, role: newRole } : item))
    );
  };

  const handleProcessImport = async () => {
    if (filesList.length === 0) return;

    // v0.9.9 — the parent's onBeforeImport hook runs here (kept for
    // compatibility; Home no longer passes one — the chosen setup
    // travels to App as an explicit argument instead). The old
    // savePendingArchetype fallback is deleted with the seam.
    if (onBeforeImport) {
      onBeforeImport();
    }

    try {
      setIsProcessing(true);
      setImportStatus(t("קורא ומנתח קבצי DOCX..."));

      const allUnits: ContentUnit[] = [];
      let totalOrder = 0;
      const cleanOverride = projectTitleOverride?.trim();
      let primaryTitle = cleanOverride || filesList[0]?.name.replace(/\.docx$/i, '') || t("ספר קודש");
      const allWarnings: string[] = [];

      for (let i = 0; i < filesList.length; i++) {
        const item = filesList[i];
        setImportStatus(tf('מחלץ טקסט מתוך {name}...', { name: item.name }));
        // v0.9.8 Phase 1 — reuse the preview parse when it is cached
        // (same file, same bytes); otherwise parse now.
        const cached = parsedCacheRef.current.get(item.id);
        const res = cached ?? await DocxImporter.importDocx(await item.file.arrayBuffer(), item.name);
        // v0.8.0 Part E: keep every validation warning (dropped images
        // included) for the warnings review step below.
        for (const w of res.validation.warnings) {
          if (!allWarnings.includes(w)) allWarnings.push(w);
        }

        if (!cleanOverride && i === 0 && res.metadata.title) {
          primaryTitle = res.metadata.title;
        }

        // v0.9.7 — the user's per-file tag WINS for body units. The old
        // condition only retagged units the importer had called
        // main_source, so a file tagged tertiary_comment kept its
        // importer-guessed primary_comment units, and a file tagged
        // 'verse' kept its main_source units. Structural roles
        // (footnote / heading / chapter / title) are never retagged.
        for (const u of res.units) {
          totalOrder++;
          u.order = totalOrder;
          if (item.role !== 'main_source' && DOCX_HUB_RETAGGABLE_ROLES.includes(u.role)) {
            u.role = item.role;
            if (!u.textRuns || !u.textRuns.some(r => r.isBold || r.isDibbur)) {
              u.textRuns = DocxImporter.buildRunsFromRawText(u.rawText, u.role, u.dibburHamatchil);
            }
          }
          allUnits.push(u);
        }
      }

      // Separate source and commentary units for link discovery.
      // v0.9.7 — tertiary_comment joins the linking: a third mefaresh
      // gets dibbur-hamatchil links to the source like Rashi/Tosafot.
      let discoveredLinks: RavTextLink[] = [];
      if (autoDiscoverLinks && filesList.length > 1) {
        setImportStatus(t("מזהה קישורים אוטומטיים בין המפרשים לגמרא לפי דיבור המתחיל..."));
        const sources = allUnits.filter(u => u.role === 'main_source' || u.role === 'chapter');
        const commentaries = allUnits.filter(
          u => u.role === 'primary_comment' || u.role === 'secondary_comment' || u.role === 'tertiary_comment'
        );

        discoveredLinks = DocxImporter.autoLinkCommentariesToSource(sources, commentaries);
        // v0.9.8 Phase 3 — run the new CommentaryLinkerEngine over the
        // same units and keep the higher-confidence link per commentary.
        // The new engine consumes the Phase 2 DibburNodes (explicit ד"ה
        // / bold lead / delimiter / source match) and resolves them with
        // a monotonic sliding word window + fuzzy matching; the old
        // linker stays the fallback for anything it leaves unmatched.
        // AnchorLinks are stamped onto the commentary units so the
        // paginator can drive same-page gravity from them.
        try {
          const anchorLinks = linkCommentariesToSource(sources, commentaries);
          const firstSource = sources[0];
          const newRavLinks = anchorLinksToRavTextLinks(anchorLinks, allUnits, firstSource);
          discoveredLinks = mergeLinkSets(newRavLinks, discoveredLinks);
          const anchorByCommentary = new Map(anchorLinks.map(a => [a.commentaryUnitId, a]));
          for (const u of allUnits) {
            const a = anchorByCommentary.get(u.id);
            if (a && a.targetMainNodeId) u.anchorLink = a;
          }
          setLinkingReport(buildLinkingReport(anchorLinks));
        } catch {
          // The new engine must never break an import: on any failure
          // the old linker's output stands as before.
          setLinkingReport(null);
        }
      }

      // v0.3.0 — uncertain matches are NEVER applied silently. If any link
      // scored below the confidence threshold, hold the import in the review
      // queue and let the user accept / reassign / drop each one.
      // v0.8.0 Part E — warnings first: a dropped image (or any other
      // validation warning) holds the import in the warnings review until
      // the user explicitly continues; only then does the link review run.
      if (allWarnings.length > 0) {
        setPendingImport({
          units: allUnits,
          title: primaryTitle,
          confidentLinks: discoveredLinks,
          autoLayout: classifyForImport(allUnits, discoveredLinks, {
            fileName: primaryTitle,
            hasFootnotes: allUnits.some(u => u.role === 'footnote'),
          }),
        });
        setImportWarnings(allWarnings);
        setImportStatus(t('היבוא מוכן, אך יש אזהרות — יש לסקור אותן לפני ההמשך.'));
        return;
      }

      proceedWithLinks(allUnits, primaryTitle, discoveredLinks);
    } catch (err: any) {
      setErrorMessage(t("שגיאה ביבוא קבצי DOCX: ") + (err.message || t("קובץ שגוי")));
    } finally {
      setIsProcessing(false);
      setImportStatus(null);
    }
  };

  /**
   * v0.3.0 — completes an import held in the review queue.
   * - 'confident-only': imports the units + only the confident links;
   *   every uncertain link is dropped, nothing is guessed.
   * - 'reviewed': imports the confident links plus each uncertain link
   *   the user explicitly accepted or reassigned (reassigned links are
   *   user-locked). Undecided or dropped links are never imported.
   */
  const finalizeReviewedImport = (mode: 'reviewed' | 'confident-only') => {
    if (!pendingImport || !reviewLinks) return;
    const finalLinks: RavTextLink[] = [...pendingImport.confidentLinks];
    if (mode === 'reviewed') {
      for (const link of reviewLinks) {
        const action = reviewActions[link.linkId];
        if (action === 'accepted') {
          finalLinks.push({ ...link, isUserLocked: true });
        } else if (action === 'reassigned') {
          const newSrc = reviewSources.find(s => s.id === reviewReassign[link.linkId]);
          if (newSrc) {
            finalLinks.push({
              ...link,
              linkId: `link-${link.commentaryUnitId}-${newSrc.id}`,
              sourceUnitId: newSrc.id,
              sourceSnippet: newSrc.rawText.substring(0, 60),
              isUserLocked: true,
            });
          }
        }
        // 'dropped' and undecided links are never imported.
      }
    }
    onImportUnits(pendingImport.units, pendingImport.title, finalLinks, pendingImport.autoLayout);
    resetAfterImport();
    onClose?.();
  };

  const handleSelectSample = (type: 'berakhot' | 'bereishit' | 'mussar' | 'shulchan_aruch') => {
    // v0.9.0 Part C — samples go through the same auto-layout as a real
    // import, so a sample opens already laid out in its own recipe.
    const sample = (units: ContentUnit[], title: string) => {
      onImportUnits(units, title, [], classifyForImport(units, [], { fileName: title }));
      onClose?.();
    };
    if (type === 'berakhot') {
      sample(DocxImporter.getSampleBerakhot(), t("מסכת ברכות — דף ב ע״א"));
    } else if (type === 'bereishit') {
      sample(DocxImporter.getSampleBereishit(), t("חומש בראשית — פרשת בראשית"));
    } else if (type === 'shulchan_aruch') {
      sample(DocxImporter.getSampleShulchanAruchTwoColumn(), t("שולחן ערוך — אורח חיים סימן א׳"));
    } else {
      sample(DocxImporter.getSampleMussarSingleColumn(), t("מסילת ישרים — פרק ראשון"));
    }
  };

  return (
    <div data-testid={testIdPrefix} className="space-y-4 text-xs">
      {errorMessage && (
        <div className="p-3 rounded-lg bg-rose-950/80 border border-rose-700 text-rose-200 flex items-center justify-between">
          <span>{errorMessage}</span>
          <button onClick={() => setErrorMessage(null)} className="text-rose-400 hover:text-rose-100">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {/* Step 2: Archetype-tailored multi-slot .docx upload matrix */}
      {archetype && (
        <div className="space-y-4" data-testid={`${testIdPrefix}-wizard-slots`}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {slots.map(slot => {
              const assigned = filesList.find(e => e.slotKey === slot.key);
              const preview = assigned ? filePreviews[assigned.id] : undefined;
              const isHovered = dragOverSlotKey === slot.key;
              return (
                <div
                  key={slot.key}
                  className={`rounded-xl border p-3.5 flex flex-col justify-between gap-2.5 transition-colors ${
                    assigned
                      ? 'bg-[var(--ui-surface)] border-[var(--ui-selected-border)]'
                      : 'bg-[var(--ui-surface-subtle)] border-[var(--ui-border)]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-bold text-xs text-[var(--ui-text-primary)] truncate">
                        {wizardSlotLabel(slot, lang)}
                      </div>
                      <div className="text-[11px] text-[var(--ui-text-secondary)] truncate mt-0.5">
                        {wizardSlotHint(slot, lang)}
                      </div>
                    </div>
                    <span
                      className={`text-[11px] font-medium flex items-center gap-1 shrink-0 whitespace-nowrap ${
                        assigned
                          ? preview
                            ? 'text-[var(--ui-success)]'
                            : 'text-[var(--ui-accent)]'
                          : slot.required
                            ? 'text-[var(--ui-warning)]'
                            : 'text-[var(--ui-text-muted)]'
                      }`}
                    >
                      {assigned ? (
                        preview ? (
                          <>
                            <CheckCircle className="w-3.5 h-3.5" />
                            <span>{t("מוכן")}</span>
                          </>
                        ) : (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>{t("מנתח...")}</span>
                          </>
                        )
                      ) : slot.required ? (
                        <span>{t("חובה")}</span>
                      ) : (
                        <span>{t("אופציונלי")}</span>
                      )}
                    </span>
                  </div>

                  {assigned ? (
                    <div className="rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] p-2.5 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <BookOpen className="w-3.5 h-3.5 text-[var(--ui-accent)] shrink-0" />
                          <span className="truncate font-semibold text-xs text-[var(--ui-text-primary)]">
                            {assigned.name}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveFile(filesList.indexOf(assigned))}
                          className="p-1 rounded hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-muted)] hover:text-[var(--ui-danger)] transition-colors shrink-0"
                          title={t("הסר קובץ")}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div
                        className="text-[11px] text-[var(--ui-text-secondary)] tabular-nums leading-relaxed"
                        data-testid={`${testIdPrefix}-preview-${slot.key}`}
                      >
                        {preview
                          ? formatPreviewCounts(preview, t, lang)
                          : t("מנתח את הקובץ…")}
                      </div>
                      <div className="text-[10px] text-[var(--ui-text-muted)] font-mono tabular-nums">
                        {assigned.sizeKb} KB
                      </div>
                    </div>
                  ) : (
                    <label
                      data-testid={`${testIdPrefix}-slot-${slot.key}`}
                      onDragOver={e => {
                        e.preventDefault();
                        setDragOverSlotKey(slot.key);
                      }}
                      onDragLeave={() => setDragOverSlotKey(prev => (prev === slot.key ? null : prev))}
                      onDrop={e => {
                        e.preventDefault();
                        setDragOverSlotKey(null);
                        if (e.dataTransfer.files) handleFilesAdded(e.dataTransfer.files, slot.key);
                      }}
                      className={`border border-dashed rounded-lg px-3 py-5 flex flex-col items-center justify-center text-center cursor-pointer transition-colors ${
                        isHovered
                          ? 'border-[var(--ui-accent)] bg-[var(--ui-selected-bg)]'
                          : 'border-[var(--ui-border-strong)] hover:border-[var(--ui-accent)] bg-[var(--ui-surface)]'
                      }`}
                    >
                      <input
                        type="file"
                        accept=".docx"
                        className="hidden"
                        onChange={e => {
                          if (e.target.files) handleFilesAdded(e.target.files, slot.key);
                          e.target.value = '';
                        }}
                      />
                      <FileUp className="w-4 h-4 text-[var(--ui-accent)] mb-1.5" />
                      <span className="text-[var(--ui-text-secondary)] text-[11px] font-medium">
                        {t("גרור לכאן או לחץ לבחירת קובץ")}
                      </span>
                      <span className="text-[10px] text-[var(--ui-text-muted)] font-mono mt-0.5">
                        .docx
                      </span>
                    </label>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
            <button
              type="button"
              onClick={() =>
                setExtraSlots(prev => [
                  ...prev,
                  { ...archetype.additionalSlot, key: `additional-mefaresh-${prev.length + 1}` },
                ])
              }
              data-testid={`${testIdPrefix}-add-mefaresh`}
              className={`px-3 py-1.5 rounded-lg border ${tone.ghostBtn} flex items-center gap-1.5 font-medium text-xs transition-colors`}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t("הוסף מפרש נוסף")}</span>
            </button>

            {filesList.length > 1 && (
              <label className={`flex items-center gap-2 cursor-pointer ${tone.text}`}>
                <input
                  type="checkbox"
                  checked={autoDiscoverLinks}
                  onChange={e => setAutoDiscoverLinks(e.target.checked)}
                  className="accent-[var(--ui-accent)] rounded"
                />
                <Link2 className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
                <span>{t("מצא וקשר אוטומטית דיבורי המתחיל בין המפרשים לגמרא")}</span>
              </label>
            )}
          </div>
        </div>
      )}

      {/* File Upload Drop Area (generic mode — hidden in wizard slot mode) */}
      {!archetype && (
      <label
        data-testid={`${testIdPrefix}-dropzone`}
        onDragOver={e => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={e => {
          e.preventDefault();
          setDragActive(false);
          if (e.dataTransfer.files) handleFilesAdded(e.dataTransfer.files);
        }}
        className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer transition-all ${
          dragActive
            ? 'border-amber-500 bg-amber-950/20'
            : tone.dropIdle
        }`}
      >
        <input
          type="file"
          multiple
          accept=".docx"
          ref={fileInputRef}
          data-testid={`${testIdPrefix}-file-input`}
          className="hidden"
          onChange={e => {
            if (e.target.files) handleFilesAdded(e.target.files);
          }}
        />
        <Files className="w-8 h-8 text-amber-400/90 mb-2" />
        <span className={`font-semibold ${tone.strong} text-sm mb-1`}>
          {t("בחר או גרור לכאן קובץ אחד או מספר קובצי DOCX")}
        </span>
        <span className={`${tone.muted} text-[11px]`}>
          {t("(לדוגמה: גמרא.docx, רשי.docx, תוספות.docx — המערכת תסווג ותחבר ביניהם)")}
        </span>
        <span className={`${tone.muted} text-[11px] mt-1`}>
          {t("תפקיד הקובץ אומר לתוכנה מה הטקסט הזה בספר: המקור הראשי, פירוש ראשון, פירוש שני או הערת שוליים.")}
        </span>
      </label>
      )}

      {/* Uploaded Files Table (generic mode — slot files render inside their slots) */}
      {!archetype && filesList.length > 0 && (
        <div className="space-y-2">
          <span className={`font-semibold ${tone.text} block`}>
            {t("קבצים שהועלו (")}{filesList.length}):
          </span>
          <div className={`${tone.panel} rounded-lg border overflow-hidden divide-y divide-[var(--ui-border)]`}>
            {filesList.map((entry, idx) => (
              <div key={idx} className="p-3 flex items-center justify-between gap-3 text-xs">
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <BookOpen className="w-4 h-4 text-amber-400 shrink-0" />
                    <span className={`truncate font-medium ${tone.strong}`}>{entry.name}</span>
                    <span className={`text-[10px] ${tone.faint} font-mono`}>({entry.sizeKb} KB)</span>
                  </div>
                  {/* v0.9.8 Phase 1 — per-file preview stats (same counts as the wizard slots). */}
                  {filePreviews[entry.id] && (
                    <span
                      className={`text-[11px] ${tone.muted} mt-0.5`}
                      data-testid={`${testIdPrefix}-preview-${entry.id}`}
                    >
                      {formatPreviewCounts(filePreviews[entry.id], t, lang)}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span className={`${tone.muted} text-[11px]`}>{t("תפקיד הקובץ:")}</span>
                  <select
                    value={entry.role}
                    data-testid={`${testIdPrefix}-role-${idx}`}
                    onChange={e => handleRoleChange(idx, e.target.value as ContentRole)}
                    className={`${tone.input} border rounded px-2 py-1 text-xs focus:outline-none focus:border-amber-500`}
                  >
                    {DOCX_HUB_ROLE_OPTIONS.map(opt => (
                      <option key={opt.role} value={opt.role}>{lang === 'en' ? opt.labelEn : opt.labelHe}</option>
                    ))}
                  </select>

                  <button
                    onClick={() => handleRemoveFile(idx)}
                    className={`p-1 rounded ${tone.rowHover} ${tone.muted} hover:text-rose-400`}
                    title={t("הסר קובץ")}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Auto Link Checkbox */}
          {filesList.length > 1 && (
            <label className={`flex items-center gap-2 cursor-pointer pt-1 ${tone.text}`}>
              <input
                type="checkbox"
                checked={autoDiscoverLinks}
                onChange={e => setAutoDiscoverLinks(e.target.checked)}
                className="accent-amber-500 rounded"
              />
              <Link2 className="w-4 h-4 text-amber-400" />
              <span>{t("מצא וקשר אוטומטית דיבורי המתחיל בין המפרשים לגמרא")}</span>
            </label>
          )}
        </div>
      )}

      {/* v0.8.0 Part E — import warnings review (dropped images, …).
          The import is held here until the user explicitly continues. */}
      {importWarnings && (
        <div className="space-y-2">
          <span className={`font-semibold ${tone.warnTitle} block`}>
            {t("אזהרות יבוא — יש לסקור לפני ההמשך (")}{importWarnings.length}):
          </span>
          <p className={`${tone.muted} text-[11px]`}>
            {t("חלק מהתוכן בקובץ לא יובא. שום דבר לא הושמט בשקט — הרשימה כאן, והיבוא יימשך רק אחרי אישור.")}
          </p>
          <ul className={`${tone.warnBox} border rounded-lg p-3 space-y-1.5 list-disc list-inside`}>
            {importWarnings.map((w, idx) => (
              <li key={idx} className={`${tone.text} leading-relaxed`}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* v0.3.0 — Review queue for uncertain dibur-hamatchil matches */}
      {reviewLinks && (
        <div className="space-y-2">
          <span className={`font-semibold ${tone.warnTitle} block`}>
            {t("סקירת קישורים לא ודאיים (")}{reviewLinks.length}):
          </span>
          {/* v0.9.8 Phase 3 — LinkingReport summary for this run (one
              line, both languages via formatLinkingReportSummary). */}
          {linkingReport && (
            <p className={`${tone.muted} text-[11px]`} data-testid={`${testIdPrefix}-linking-report`}>
              {t("דו״ח קישור דיבורי המתחיל")}: {formatLinkingReportSummary(linkingReport, t, lang)}
            </p>
          )}
          <p className={`${tone.muted} text-[11px]`}>
            {t("קישורים אלו לא יוחלו אוטומטית. יש לאשר, להקצות למקור אחר, או לוותר על כל אחד מהם — קישור שלא הוכרע לא ייובא.")}
          </p>
          {reviewLinks.map(link => {
            const conf = link.matchConfidence ?? describeConfidence(link.confidenceScore);
            const action = reviewActions[link.linkId];
            const reassignedId = reviewReassign[link.linkId] ?? '';
            return (
              <div
                key={link.linkId}
                className={`${tone.warnBox} border rounded-lg p-3 space-y-2`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`font-medium ${tone.text} truncate`}>
                    {t("ד״ה")} {link.dibburHamatchil}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950 border border-amber-700 text-amber-300 shrink-0">
                    {Math.round(conf.score * 100)}% · {lang === 'en' ? (conf.reasonEn ?? conf.reasonHe) : conf.reasonHe}
                  </span>
                </div>
                <p className={`${tone.muted} leading-relaxed`}>
                  <span className={tone.text}>{link.commentarySnippet}</span>
                  {' → '}
                  <span className={tone.text}>{link.sourceSnippet}</span>
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() =>
                      setReviewActions(prev => ({ ...prev, [link.linkId]: 'accepted' }))
                    }
                    className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-colors ${
                      action === 'accepted'
                        ? 'bg-emerald-700 text-white'
                        : `${tone.ghostBtn} border`
                    }`}
                  >
                    {t("אישור")}
                  </button>
                  <select
                    value={reassignedId}
                    onChange={e => {
                      const val = e.target.value;
                      setReviewReassign(prev => ({ ...prev, [link.linkId]: val }));
                      setReviewActions(prev => ({
                        ...prev,
                        [link.linkId]: val ? 'reassigned' : 'accepted',
                      }));
                    }}
                    className={`${tone.input} border rounded px-2 py-1.5 text-[11px] focus:outline-none focus:border-amber-500 max-w-[220px]`}
                    title={t("הקצאה למקור אחר")}
                  >
                    <option value="">{t("הקצה למקור אחר…")}</option>
                    {reviewSources.map(s => (
                      <option key={s.id} value={s.id}>
                        {(s.rawText || '').substring(0, 45)}
                        {(s.rawText || '').length > 45 ? '…' : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() =>
                      setReviewActions(prev => ({ ...prev, [link.linkId]: 'dropped' }))
                    }
                    className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                      action === 'dropped'
                        ? 'bg-rose-800 text-white'
                        : `${tone.ghostBtn} border`
                    }`}
                  >
                    {t("ויתור")}
                  </button>
                  {action && (
                    <span className={`text-[10px] ${tone.faint}`}>
                      {action === 'accepted'
                        ? t("יאושר")
                        : action === 'reassigned'
                          ? t("יוקצה מחדש")
                          : t("לא ייובא")}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Quick Holy-Book Samples (hidden in the streamlined 2-step Home wizard) */}
      {!hideSamples && (
        <div>
          <span className={`${tone.muted} font-medium block mb-2`}>
            {t("או טען מסמך לדוגמה בלחיצה אחת:")}
          </span>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handleSelectSample('berakhot')}
              data-testid={`${testIdPrefix}-sample-berakhot`}
              className={`p-2.5 rounded-lg border flex items-center gap-2 text-start transition-colors ${tone.sampleBtn}`}
            >
              <Scroll className="w-4 h-4 text-amber-400 shrink-0" />
              <div>
                <span className={`font-semibold block ${tone.sampleTitle}`}>{t("ש״ס ברכות — דף ב׳ ע״א")}</span>
                <span className={`text-[10px] ${tone.sampleSub}`}>{t("גמרא, רש״י, תוספות וברכיים")}</span>
              </div>
            </button>

            <button
              onClick={() => handleSelectSample('bereishit')}
              data-testid={`${testIdPrefix}-sample-bereishit`}
              className={`p-2.5 rounded-lg border flex items-center gap-2 text-start transition-colors ${tone.sampleBtn}`}
            >
              <BookOpen className="w-4 h-4 text-emerald-400 shrink-0" />
              <div>
                <span className={`font-semibold block ${tone.sampleTitle}`}>{t("חומש בראשית — פרק א׳")}</span>
                <span className={`text-[10px] ${tone.sampleSub}`}>{t("מקראות גדולות עם טעמי מקרא")}</span>
              </div>
            </button>

            <button
              onClick={() => handleSelectSample('mussar')}
              data-testid={`${testIdPrefix}-sample-mussar`}
              className={`p-2.5 rounded-lg border flex items-center gap-2 text-start transition-colors ${tone.sampleBtn}`}
            >
              <Scroll className="w-4 h-4 text-blue-400 shrink-0" />
              <div>
                <span className={`font-semibold block ${tone.sampleTitle}`}>{t("מסילת ישרים — פרק א׳")}</span>
                <span className={`text-[10px] ${tone.sampleSub}`}>{t("טקסט רץ מלא והערות שוליים")}</span>
              </div>
            </button>

            <button
              onClick={() => handleSelectSample('shulchan_aruch')}
              data-testid={`${testIdPrefix}-sample-shulchan-aruch`}
              className={`p-2.5 rounded-lg border flex items-center gap-2 text-start transition-colors ${tone.sampleBtn}`}
            >
              <BookOpen className="w-4 h-4 text-purple-400 shrink-0" />
              <div>
                <span className={`font-semibold block ${tone.sampleTitle}`}>{t("שולחן ערוך — סימן א׳")}</span>
                <span className={`text-[10px] ${tone.sampleSub}`}>{t("עימוד שני טורים מסורתי")}</span>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Footer / Primary Action */}
      <div className="pt-4 border-t border-[var(--ui-border)] flex items-center justify-between gap-3 flex-wrap text-xs">
        <div className="flex items-center gap-3 flex-wrap min-w-0">
          <span className={tone.statusText}>
            {importStatus ||
              (archetype && filesList.length === 0
                ? t("העלו לפחות את קובץ הטקסט הראשי כדי ליצור ולפתוח את אולפן העימוד.")
                : t("המסמכים ייובאו תוך שימור מלא של טעמים, ניקוד וחלוקת פסקאות."))}
          </span>
          {onStartEmptyInArchetype && archetype && filesList.length === 0 && !importWarnings && !reviewLinks && (
            <button
              type="button"
              onClick={onStartEmptyInArchetype}
              data-testid={`${testIdPrefix}-start-empty`}
              className="text-[var(--ui-accent)] hover:underline font-medium whitespace-nowrap"
            >
              {startEmptyLabel ?? t("או פתח מסמך ריק בתבנית זו")}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${tone.ghostBtn}`}
            >
              {t("ביטול")}
            </button>
          )}
          {importWarnings ? (
            <button
              type="button"
              onClick={continueAfterWarnings}
              data-testid={`${testIdPrefix}-continue-warnings`}
              className="px-5 py-2.5 bg-[var(--ui-accent)] hover:bg-[var(--ui-accent-hover)] text-[var(--ui-accent-fg)] rounded-lg font-semibold flex items-center gap-2 shadow-xs transition-colors whitespace-nowrap"
            >
              <CheckCircle className="w-4 h-4" />
              <span>{t("הבנתי — המשך בייבוא")}</span>
            </button>
          ) : reviewLinks ? (
            <>
              <button
                type="button"
                onClick={() => finalizeReviewedImport('confident-only')}
                data-testid={`${testIdPrefix}-confident-only`}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${tone.ghostBtn} border whitespace-nowrap`}
              >
                {t("קבל רק את הבטוחים")}
              </button>
              <button
                type="button"
                onClick={() => finalizeReviewedImport('reviewed')}
                data-testid={`${testIdPrefix}-apply-review`}
                className="px-5 py-2.5 bg-[var(--ui-accent)] hover:bg-[var(--ui-accent-hover)] text-[var(--ui-accent-fg)] rounded-lg font-semibold flex items-center gap-2 shadow-xs transition-colors whitespace-nowrap"
              >
                <CheckCircle className="w-4 h-4" />
                <span>{t("החל סקירה וייבא")}</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleProcessImport}
              disabled={filesList.length === 0 || isProcessing}
              data-testid={`${testIdPrefix}-import`}
              className="px-6 py-2.5 bg-[var(--ui-accent)] hover:bg-[var(--ui-accent-hover)] disabled:opacity-45 disabled:cursor-not-allowed text-[var(--ui-accent-fg)] rounded-lg font-semibold flex items-center gap-2 shadow-xs transition-colors whitespace-nowrap"
            >
              {isProcessing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : dir === 'rtl' ? (
                <ArrowLeft className="w-4 h-4" />
              ) : (
                <ArrowRight className="w-4 h-4" />
              )}
              <span>
                {isProcessing
                  ? t("מעבד...")
                  : (generateLabel ??
                    tf('ייבא {count} {files} ועמד ספר', {
                      count: filesList.length,
                      files: filesList.length === 1 ? t('קובץ') : t('קבצים'),
                    }))}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
