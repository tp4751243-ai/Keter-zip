/**
 * Keter Typesetter — Commercial AI Jewish Holy-Book Desktop Typesetting System
 * Professional Multi-Page Typesetting Studio for Hebrew RTL, Nikud, Taamim,
 * Multiple Layout Paradigms (Single Column, Two Column, Top/Bottom, Vilna Rav-Text, Mikraot Gedolot),
 * Real-time Dynamic Knee ("Berayim") Reflow, and High-Resolution PDF & IDML Exporters.
 */

import React, { useState, useMemo, useCallback, useRef, useEffect, lazy, Suspense } from 'react';
import {
  EditorialStudioHeader,
  UiThemeMode,
  PrimaryWorkMode,
} from './components/EditorialStudioHeader';
import { FloatingContextToolbar } from './components/FloatingContextToolbar';
import { HomeWorkspaceView } from './components/HomeWorkspaceView';
import { ExportWorkspaceView } from './components/ExportWorkspaceView';
import { PageCanvas } from './components/PageCanvas';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useEditingShortcuts } from './hooks/useEditingShortcuts';
import { DocxImportModal } from './components/DocxImportModal';
import { ContentEditorModal } from './components/ContentEditorModal';
import { AiChatPanel } from './components/AiChatPanel';
import { SearchReplacePanel } from './components/SearchReplacePanel';
import { ProofreadingPanel } from './components/ProofreadingPanel';
import { QaFixList } from './components/QaFixList';
import { SuggestionReviewPanel, Suggestion } from './components/SuggestionReviewPanel';
import { searchUnits, replaceInUnits, replacePreservingNikud } from './engine/hebrew-search';
import type { SearchHit, SearchOptions } from './engine/hebrew-search';
import { applyFix, applyFixes } from './engine/text-proofing';
import type { TextIssue, TextIssueKind } from './engine/text-proofing';
import { applyBreakInstructions, createBreakInstruction, findBreakAnchor } from './engine/break-instructions';
import type { AnchoredBreakInstruction } from './engine/break-instructions';
// v0.9.8 Phase 5 — click-to-re-anchor (pure helpers) + push/pull word math.
import {
  anchorLinksToRavTextLinks,
  mergeLinkSets,
} from './engine/commentary-linker';
import {
  applyReAnchorToUnits,
  reAnchorLink,
  unitGlobalWordIndexAcrossPages,
} from './engine/anchor-overlay';
import { planLayoutSwitch } from './engine/layout-transaction';
// v0.9.0 Part B — Manuscript & Custom Layout Designer: historical layout
// library + .keter-template.json recipes (Part A's engine).
import { getRecipeById, resolveHistoricalRecipe } from './engine/historical-layouts';
import { layoutDisplayLabel } from './engine/layout-presets';
import {
  KETER_TEMPLATE_EXTENSION,
  applyGenreTypography,
  applyRecipeToSettings,
  deserializeRecipe,
  recipeFromSettings,
  serializeRecipe,
  validateRecipe,
} from './engine/layout-recipes';
import type { LayoutRecipe } from './engine/layout-recipes';
import { wholeBookBalancingPass } from './engine/book-balancing';
import type { BookBalancingReport } from './engine/book-balancing';
// v0.9.8 Phase 1 — Developer Mode (default OFF: QA/dev surfaces hidden)
// + the Sefer Wizard's pending-archetype seam (wizard import → App).
import {
  isDeveloperModeEnabled,
  setDeveloperModeEnabled,
} from './engine/developer-mode';
import {
  applyArchetypeToSettings,
  getArchetypeById,
  migratePendingChosenSetup,
  type ChosenSetup,
} from './engine/sefer-wizard';
import { detectLibraryPairs, openAsGemaraPage } from './engine/library-folder';
import type { PrintVersion } from './engine/project-persistence';
import { GeminiKeyModal } from './components/GeminiKeyModal';
import { TypesettingRulesModal } from './components/TypesettingRulesModal';
import { DesignTypesettingPanel, InspectorMainTab } from './components/DesignTypesettingPanel';
import { PageNavigatorSidebar, LeftNavigatorTab } from './components/PageNavigatorSidebar';
import { ControlPanel } from './components/ControlPanel';
import { DockablePanels } from './components/DockablePanels';
import {
  defaultWorkspaceLayout,
  deleteSavedWorkspace,
  loadSavedWorkspaces,
  loadWorkspace,
  normalizeWorkspaceLayout,
  saveWorkspace,
  saveWorkspaceNamed,
  WorkspaceLayout,
} from './engine/workspace-layout';
import { FrameToolsToolbar } from './components/FrameToolsToolbar';
import { StoryEditor } from './components/StoryEditor';
import { FrameContextMenu, FrameContextMenuState } from './components/FrameContextMenu';
import { computeThreadLinks, createFrameBox, FrameToolId, PolygonVariant } from './engine/frame-tools';
import { ShasQaPanel } from './components/ShasQaPanel';
import { reorderPageUnits } from './engine/page-operations';
import {
  applyVilnaShasDefaults,
  fixGeometryFlaws,
  fixShasFlaws,
  folioLatin,
  folioLatinTalmud,
  scanShasFlaws,
  verifyDibburHamatchil,
} from './engine/vilna-shas';
import { titlePageSettingsFromClassification } from './engine/title-page-borders';
import {
  TITLE_PAGE_METADATA_LABELS_HE,
  readTitlePageTemplateState,
  writeTitlePageTemplateState,
} from './engine/title-page-templates';
// v0.9.0 Part C — automatic layout on import + historical recipes.
import {
  applyRecipeToSettingsById,
  getRecipeByIdLocal,
  type AutoLayoutImportInfo,
} from './engine/auto-layout';
import {
  applyYiddishHeadingDefaults,
  reclassifyYiddishUnits,
  verifyYiddishFolios,
} from './engine/yiddish-sefarim';import { WorkspaceStatusBar } from './components/WorkspaceStatusBar';
import { UnsavedChangesModal } from './components/UnsavedChangesModal';
import { NewProjectModal } from './components/NewProjectModal';
import { LayoutRecipePicker, type LayoutRecipeSelection } from './components/LayoutRecipePicker';
import { GuidedStepsBar } from './components/GuidedStepsBar';
import { WelcomeModal, WELCOME_SEEN_KEY } from './components/WelcomeModal';
import { CommandPalette, PaletteCommand } from './components/CommandPalette';
import { DesignSelectionTarget, ProfessionalDesignSettings, SEMANTIC_ROLE_LABELS_EN, SEMANTIC_ROLE_LABELS_HE, SemanticStyleRole } from './types/design-settings';
import { DesignSettingsEngine } from './engine/design-settings-engine';
import { applyCharacterStyleChange, applyParagraphStyleChange } from './engine/text-style-apply';
import { FontAnalyzerEngine } from './engine/font-analyzer';

import {
  AnchorLink,
  BookLayoutType,
  BookTypesetDocument,
  ContentRole,
  ContentUnit,
  KneeCustomSettings,
  PageGeometry,
  PageTypesetResult,
  ProjectSnapshot,
  RavTextLink,
  StructuredDiagnostic,
  TypesetLine,
} from './types/typesetter';
import { PaginationEngine } from './engine/pagination-engine';
import { DocxImporter } from './engine/docx-importer';
import { buildTitlePageResult } from './engine/toc-engine';
import { PdfExporter } from './engine/pdf-exporter';
import { IdmlExporter } from './engine/idml-exporter';
import { QaEngine } from './engine/qa-engine';
import {
  ProjectPersistenceEngine,
  RecentProjectItem,
  UndoRedoHistoryManager,
  UndoRedoSnapshotState,
} from './engine/project-persistence';
import {
  LocalRuleOverride,
  TypesettingRulesConfig,
  TypesettingRulesEngine,
  UserTypesettingRule,
} from './engine/typesetting-rules-engine';
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { useLanguage } from './i18n/LanguageContext';

// v0.3.1 (slim/fast): heavy panels are code-split out of the first-paint
// bundle and load on demand only when the user opens them. The main editor,
// PageCanvas and the core pagination engine stay eager. These three are all
// named exports, hence the `.then(m => ({ default: ... }))` adapter.
const AutomatedTestPanel = lazy(() =>
  import('./components/AutomatedTestPanel').then(m => ({ default: m.AutomatedTestPanel })),
);
const Milestone1ReportModal = lazy(() =>
  import('./components/Milestone1ReportModal').then(m => ({ default: m.Milestone1ReportModal })),
);
const FontScannerPanel = lazy(() =>
  import('./components/FontScannerPanel').then(m => ({ default: m.FontScannerPanel })),
);

type RightDrawerMode = 'design' | 'ai' | null;

const DEFAULT_BERAKHOT_LINKS: RavTextLink[] = [
  {
    linkId: 'link-1',
    sourceUnitId: 'unit-gemara-1',
    commentaryUnitId: 'unit-rashi-1',
    dibburHamatchil: 'מֵאֵימָתַי',
    isUserLocked: true,
    confidenceScore: 1.0,
    sourceSnippet: 'מֵאֵימָתַי קוֹרִין אֶת שְׁמַע',
    commentarySnippet: 'מֵאֵימָתַי: מֵאֵיזֶה זְמַן',
    commentaryType: 'Rashi',
  },
  {
    linkId: 'link-2',
    sourceUnitId: 'unit-gemara-1',
    commentaryUnitId: 'unit-tosafot-1',
    dibburHamatchil: 'מֵאֵימָתַי קוֹרִין',
    isUserLocked: false,
    confidenceScore: 0.95,
    sourceSnippet: 'מֵאֵימָתַי קוֹרִין אֶת שְׁמַע',
    commentarySnippet: 'מֵאֵימָתַי קוֹרִין: תָּנָא הֵיכָא קָאֵי',
    commentaryType: 'Tosafot',
  },
];

interface InitialBootState {
  snapshot: ProjectSnapshot;
  designSettings: ProfessionalDesignSettings;
  recoveredFromAutosave: boolean;
  recoveredFromBackup: boolean;
}

function loadInitialBootState(): InitialBootState {
  const recovery = ProjectPersistenceEngine.loadAutosaveWithRecovery();
  if (recovery.snapshot) {
    const restoredDesign = ProjectPersistenceEngine.buildDesignSettingsFromSnapshot(
      recovery.snapshot
    );
    return {
      snapshot: recovery.snapshot,
      designSettings: restoredDesign,
      recoveredFromAutosave: true,
      recoveredFromBackup: recovery.recoveredFromBackup,
    };
  }

  const defaultDesign = DesignSettingsEngine.createDefaultSettings({
    projectId: 'project-berakhot-1',
    layoutType: 'rav_text',
    sourceFontFamily: 'Frank Ruhl Libre',
    rashiFontFamily: 'Noto Rashi Hebrew',
    tosafotFontFamily: 'Frank Ruhl Libre',
  });

  const defaultSnapshot: ProjectSnapshot = {
    id: 'init-berakhot',
    timestamp: Date.now(),
    label: 'פרויקט התחלתי: מסכת ברכות',
    documentTitle: 'מסכת ברכות — דף ב ע״א',
    layoutType: 'rav_text',
    geometry: defaultDesign.layout.geometry,
    units: DocxImporter.getSampleBerakhot(),
    links: DEFAULT_BERAKHOT_LINKS,
    kneeSettings: defaultDesign.ravText.kneeSettings,
    selectedFont: 'Frank Ruhl Libre',
    selectedRashiFont: 'Noto Rashi Hebrew',
    selectedTosafotFont: 'Frank Ruhl Libre',
    sourceFontSize: defaultDesign.roleStyles.main_source.character.fontSizePt,
    commentaryFontSize: defaultDesign.roleStyles.primary_comment.character.fontSizePt,
    enableOrnaments: true,
    currentPageIndex: 0,
    projectRules: [],
    localOverrides: [],
    designSettings: defaultDesign,
    projectMetadata: {
      projectId: defaultDesign.projectId || 'project-berakhot-1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      appVersion: '2.5.0-stage15',
    },
  };

  return {
    snapshot: defaultSnapshot,
    designSettings: defaultDesign,
    recoveredFromAutosave: false,
    recoveredFromBackup: false,
  };
}

export default function App() {
  const { t, tf, dir, lang, toggleLanguage } = useLanguage();
  const initialBootRef = useRef<InitialBootState | null>(null);
  if (!initialBootRef.current) {
    initialBootRef.current = loadInitialBootState();
  }
  const boot = initialBootRef.current;

  // 1. Document & Layout State (Initialized from recovered autosave or default project)
  const [documentTitle, setDocumentTitle] = useState<string>(boot.snapshot.documentTitle);
  const [layoutType, setLayoutType] = useState<BookLayoutType>(boot.snapshot.layoutType);
  const [selectedFont, setSelectedFont] = useState<string>(boot.snapshot.selectedFont);
  const [selectedRashiFont, setSelectedRashiFont] = useState<string>(
    boot.snapshot.selectedRashiFont
  );
  const [selectedTosafotFont, setSelectedTosafotFont] = useState<string>(
    boot.snapshot.selectedTosafotFont
  );
  const [enableOrnaments, setEnableOrnaments] = useState<boolean>(
    boot.snapshot.enableOrnaments ?? true
  );
  const [contentUnits, setContentUnits] = useState<ContentUnit[]>(boot.snapshot.units);

  // Dynamic Knee Custom Settings
  const [kneeSettings, setKneeSettings] = useState<KneeCustomSettings>(boot.snapshot.kneeSettings);

  // Rav-Text Semantic Links
  const [ravTextLinks, setRavTextLinks] = useState<RavTextLink[]>(boot.snapshot.links);

  // 2. Multi-Page Navigation State
  const [currentPageIndex, setCurrentPageIndex] = useState<number>(
    boot.snapshot.currentPageIndex ?? 0
  );

  // 3. Viewport & Display Settings — Default 1.15x (115%) comfortable reading scale on desktop
  const [zoom, setZoom] = useState<number>(1.15);
  const [showBaselines, setShowBaselines] = useState<boolean>(true);
  const [showAnchors, setShowAnchors] = useState<boolean>(false);
  const [showKneeGuide, setShowKneeGuide] = useState<boolean>(true);
  // v0.9.8 Uniformity Audit — REMOVED: `showLinks` (default true) was
  // dead state: PageCanvas accepted the prop but never read it, and no
  // UI ever toggled it. Rav-text link display is the Phase 5
  // "קישורי ד״ה" overlay (showAnchorLinks) — the one link toggle.
  // v0.9.8 Phase 5 — "Show Anchor Links" overlay (off by default) and
  // the armed commentary unit while a click-to-re-anchor is in progress
  // (null = not armed). The overlay draws Phase 3 AnchorLinks between
  // the real rendered word spans; arming happens with one click on a
  // dibbur word while the overlay is on.
  const [showAnchorLinks, setShowAnchorLinks] = useState<boolean>(false);
  const [reAnchorPendingUnitId, setReAnchorPendingUnitId] = useState<string | null>(null);

  // Stage 18: Three Real Primary Work Modes: 'home' (כניסה), 'edit' (עריכה), 'export' (ייצוא)
  // Starts on 'home' (כניסה) when the user enters the application without opening a project
  const [activeWorkMode, setActiveWorkMode] = useState<PrimaryWorkMode>('home');
  const [recentProjects, setRecentProjects] = useState<RecentProjectItem[]>(() =>
    ProjectPersistenceEngine.getRecentProjects()
  );
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);

  // 3.5 Classic Editorial Day/Night Theme State (Default: 'day' for first-time users, persisted)
  const [uiTheme, setUiTheme] = useState<UiThemeMode>(() => {
    try {
      const saved = localStorage.getItem('keter-ui-theme');
      return saved === 'night' ? 'night' : 'day';
    } catch {
      return 'day';
    }
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', uiTheme);
    try {
      localStorage.setItem('keter-ui-theme', uiTheme);
    } catch {
      // ignore storage errors
    }
  }, [uiTheme]);

  const handleToggleUiTheme = useCallback(() => {
    setUiTheme(prev => (prev === 'day' ? 'night' : 'day'));
  }, []);

  // 4. On-Demand Dismissible Studio Drawers (closed by default so the book page is the hero)
  const [isNavigatorOpen, setIsNavigatorOpen] = useState<boolean>(false);
  const [navigatorTab, setNavigatorTab] = useState<LeftNavigatorTab>('pages');
  // v0.7.0 Part 1 (M1/M2) — dockable workspace layout (persisted).
  // v0.8.0 Part B: a persisted layout is migrated to the current panel
  // set (mock panels dropped, survivors collapsed) on load.
  // v0.9.2 Part B: the PagesPanel toggle is gone — the navigator
  // sidebar below is the only page-navigation surface now (it also
  // carries PagesPanel's reorder/insert/delete), so there is no second
  // panel to toggle between.
  const [workspaceLayout, setWorkspaceLayout] = useState<WorkspaceLayout>(() => {
    const loaded = loadWorkspace();
    return loaded ? normalizeWorkspaceLayout(loaded, 'he') : defaultWorkspaceLayout('he');
  });
  const handleWorkspaceLayoutChange = useCallback((next: WorkspaceLayout) => {
    setWorkspaceLayout(next);
    saveWorkspace(next);
  }, []);
  // v0.8.0 Part B — named-workspace picker (save as / load / delete).
  // `loadSavedWorkspaces` had no callers before this; the picker is its UI.
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
  const [workspaceMenuPos, setWorkspaceMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [savedWorkspacesList, setSavedWorkspacesList] = useState<WorkspaceLayout[]>([]);
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState('');
  const workspaceMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  // v0.7.0 Part 2 (M3/M4) — frame tools, story view, context menu, display performance.
  const [activeTool, setActiveTool] = useState<FrameToolId>('select');
  const [polygonVariant, setPolygonVariant] = useState<PolygonVariant>('l_shape');
  const [storyView, setStoryView] = useState(false);
  // v0.8.0 Part E (#14): the unit a Type-tool drag just created — the
  // Story Editor focuses its textarea on open, then clears on return.
  const [initialEditingUnitId, setInitialEditingUnitId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<FrameContextMenuState | null>(null);
  const [displayPerformanceFast, setDisplayPerformanceFast] = useState(false);
  // v0.7.0 Part 2 (M4): the auto-center handler is defined below the
  // keydown effect, so the shortcut calls it through this ref.
  const autoCenterRef = useRef<() => void>(() => undefined);
  // v0.7.0 Part 3 (M2) — Vilna Shas verification panel.
  const [showShasPanel, setShowShasPanel] = useState(false);
  // v0.9.0 Part C — auto-layout notice: the one clear line shown after a
  // .docx import ("Laid out as Vilna Shas — …") with a "Change layout"
  // action. Dismissed by the user, or replaced by the next import.
  const [autoLayoutNotice, setAutoLayoutNotice] = useState<{
    lineHe: string;
    lineEn: string;
    recipeId: string;
    isFallback: boolean;
  } | null>(null);
  const [autoLayoutChangeTarget, setAutoLayoutChangeTarget] = useState<BookLayoutType | ''>('');
  // v0.9.9 — the banner picker's latest selection (recipe or plain
  // layout), read when the banner's Apply button is pressed.
  const bannerSelectionRef = useRef<LayoutRecipeSelection | null>(null);
  const [navigatorWidth, setNavigatorWidth] = useState<number>(272);

  const [rightDrawerMode, setRightDrawerMode] = useState<RightDrawerMode>(null);
  const [inspectorMainTab, setInspectorMainTab] = useState<InspectorMainTab>('typography');
  const [rightDockWidth, setRightDockWidth] = useState<number>(360);

  // Resizing interaction state
  const resizingSideRef = useRef<'navigator' | 'inspector' | null>(null);
  const resizeStartXRef = useRef<number>(0);
  const resizeStartWidthRef = useRef<number>(0);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizingSideRef.current) return;
      const deltaX = e.clientX - resizeStartXRef.current;
      if (resizingSideRef.current === 'navigator') {
        const nextW = Math.max(210, Math.min(420, resizeStartWidthRef.current - deltaX));
        setNavigatorWidth(nextW);
      } else if (resizingSideRef.current === 'inspector') {
        const nextW = Math.max(310, Math.min(520, resizeStartWidthRef.current + deltaX));
        setRightDockWidth(nextW);
      }
    };
    const handleMouseUp = () => {
      resizingSideRef.current = null;
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // 5. Modal Visibility & Unsaved Changes Lifecycle Guard
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState<boolean>(false);
  // v0.9.2 Part B — which starter the New Project modal opens on: the
  // Home screen's old inline wizard defaulted to 'sample', the header
  // menu to 'blank'. Both now open this one modal (see NewProjectModal
  // initialMode); the opener sets the default before opening it.
  const [newProjectModalInitialMode, setNewProjectModalInitialMode] = useState<'blank' | 'sample'>('blank');
  const [isContentEditorOpen, setIsContentEditorOpen] = useState<boolean>(false);
  const [isRulesModalOpen, setIsRulesModalOpen] = useState<boolean>(false);
  const [isFontScannerOpen, setIsFontScannerOpen] = useState<boolean>(false);
  const [isDocxModalOpen, setIsDocxModalOpen] = useState<boolean>(false);
  const [isTestPanelOpen, setIsTestPanelOpen] = useState<boolean>(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState<boolean>(false);

  // v0.9.8 Phase 1 — Developer Mode, default OFF (persisted in
  // localStorage). OFF = clean editorial studio: the header's developer
  // section, the status-bar QA button, the Automated Test panel, the
  // architecture-report modal and the QA-fix list are all hidden AND
  // unreachable. Toggle: Ctrl+Shift+D or the header-menu switch.
  const [developerMode, setDeveloperMode] = useState<boolean>(() =>
    isDeveloperModeEnabled()
  );
  const handleToggleDeveloperMode = useCallback(() => {
    setDeveloperMode(prev => {
      const next = !prev;
      setDeveloperModeEnabled(next);
      return next;
    });
  }, []);

  // v0.9.8 Phase 1 — Ctrl+Shift+D toggles Developer Mode anywhere.
  // (Separate effect from the Ctrl+Z/S/K shortcuts below so the toggle
  // never interferes with editing shortcuts.)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        handleToggleDeveloperMode();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleToggleDeveloperMode]);

  // v0.2.0: Gemini API key modal + a version counter so AiChatPanel re-checks
  // whether a key is present after the modal saves/clears one.
  const [isGeminiKeyModalOpen, setIsGeminiKeyModalOpen] = useState<boolean>(false);
  const [geminiKeyVersion, setGeminiKeyVersion] = useState<number>(0);

  // v0.3.0: search / proofing / QA-fix / overview / suggestions / break instructions
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const [isProofingOpen, setIsProofingOpen] = useState<boolean>(false);
  const [showQaFixList, setShowQaFixList] = useState<boolean>(false);
  const [showSuggestions, setShowSuggestions] = useState<boolean>(false);
  // v0.5.0 (integrator — simplification): the secondary tool buttons live
  // behind this disclosure so the toolbar shows only the essentials.
  const [showMoreTools, setShowMoreTools] = useState<boolean>(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [breakInstructions, setBreakInstructions] = useState<AnchoredBreakInstruction[]>([]);
  const [balanceNonce, setBalanceNonce] = useState<number>(0);
  const [printVersions, setPrintVersions] = useState<PrintVersion[]>(() =>
    ProjectPersistenceEngine.listPrintVersions()
  );
  const libraryFileInputRef = useRef<HTMLInputElement | null>(null);

  // v0.4.0: guided-flow progress — step 1 is done once the user has
  // actually opened/created/imported a book; step 3 once an export ran.
  const [hasOpenedBook, setHasOpenedBook] = useState<boolean>(false);
  const [hasExported, setHasExported] = useState<boolean>(false);

  // v0.4.0: first-run welcome — shown once, remembered in localStorage,
  // reopenable from the "How to use" button in the header.
  // v0.4.0 — command palette (Ctrl+K, checklist §4).
  const [isPaletteOpen, setIsPaletteOpen] = useState<boolean>(false);

  const [isWelcomeOpen, setIsWelcomeOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(WELCOME_SEEN_KEY) !== '1';
    } catch {
      return true;
    }
  });
  const handleCloseWelcome = useCallback(() => {
    setIsWelcomeOpen(false);
    try {
      localStorage.setItem(WELCOME_SEEN_KEY, '1');
    } catch {
      // ignore storage errors
    }
  }, []);

  // Pending action blocked by unsaved changes dialog
  const [pendingProtectedAction, setPendingProtectedAction] = useState<{
    descriptionHe: string;
    execute: () => void;
  } | null>(null);

  // Hidden file input fallback for importing native .keter.json project files
  const projectFileInputRef = useRef<HTMLInputElement>(null);

  // Stage 13: Authoritative Shared Design & Typesetting Settings State
  const [designSettings, setDesignSettings] = useState<ProfessionalDesignSettings>(
    boot.designSettings
  );
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [selectedWordInfo, setSelectedWordInfo] = useState<{
    unitId: string;
    wordIndex: number;
    wordText: string;
    role: ContentRole;
  } | null>(null);

  // v0.3.1 (slim/fast): the font list is a static catalogue, but there is no
  // reason to build it before first paint — populate it right after mount so
  // startup stays light. Both consumers (toolbar + design panel) tolerate an
  // empty list until it lands a tick later.
  const [availableFonts, setAvailableFonts] = useState<
    ReturnType<typeof FontAnalyzerEngine.getAvailableSystemFonts>
  >([]);
  useEffect(() => {
    const t = window.setTimeout(
      () => setAvailableFonts(FontAnalyzerEngine.getAvailableSystemFonts()),
      0,
    );
    // v0.6.0 Part A (§1): auto-fetch the computer's fonts at startup —
    // Electron scans the system font directories first (no permission
    // involved); otherwise the Local Font Access API runs, unless the user
    // already declined it once (remembered — never nags every launch).
    // Non-blocking and fire-and-forget: the dropdowns subscribe to the
    // font library and fill in when the scan lands.
    void import('./engine/font-library')
      .then(m => m.autoScanFontsAtStartup())
      .catch(() => undefined);
    return () => window.clearTimeout(t);
  }, []);

  const selectedUnit = useMemo(
    () => contentUnits.find(u => u.id === selectedUnitId) ?? null,
    [contentUnits, selectedUnitId]
  );

  // Stage 12 Centralized Typesetting Rules Engine State
  const [globalUserRules, setGlobalUserRules] = useState<UserTypesettingRule[]>(
    () => TypesettingRulesEngine.loadGlobalUserRuleSet().rules
  );
  const [projectRules, setProjectRules] = useState<UserTypesettingRule[]>(
    boot.snapshot.projectRules ?? []
  );
  const [localOverrides, setLocalOverrides] = useState<LocalRuleOverride[]>(
    boot.snapshot.localOverrides ?? []
  );

  const rulesConfig: TypesettingRulesConfig = useMemo(
    () =>
      TypesettingRulesEngine.createConfig({
        userRules: globalUserRules,
        projectRules,
        localOverrides,
      }),
    [globalUserRules, projectRules, localOverrides]
  );

  // Export Progress & Status Notifications
  const [isExportingPdf, setIsExportingPdf] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<{ current: number; total: number } | null>(
    null
  );
  const [notification, setNotification] = useState<{
    message: string;
    type: 'success' | 'error' | 'warning';
  } | null>(null);
  // v0.9.8 uniformity audit — a toast's 4s dismissal timer must belong to
  // THAT toast: the old code scheduled an unconditional clear per call, so
  // an earlier toast's timer killed a later toast early (e.g. the pull-line
  // timer fired ~1s after the re-anchor confirmation appeared). Each new
  // toast cancels the previous timer, so every confirmation gets its full 4s.
  const toastTimerRef = useRef<number | null>(null);

  // Autosave status tracking
  const [lastAutosaveTimestamp, setLastAutosaveTimestamp] = useState<number | null>(
    boot.recoveredFromAutosave ? boot.snapshot.timestamp : null
  );
  const [recoveredFromAutosave] = useState<boolean>(boot.recoveredFromAutosave);

  const [hoveredLinkId, setHoveredLinkId] = useState<string | null>(null);
  // v0.5.0 Part B (Module 4): the section (block) the pointer is hovering
  // on the page — its identity + bounding box, handed up by PageCanvas via
  // onHoverBlock so the state manager (and the status bar) sees the section,
  // not word/token nodes.
  const [hoveredBlock, setHoveredBlock] = useState<NonNullable<DesignSelectionTarget['blockBoundary']> | null>(null);

  // Page Geometry: Controlled by shared designSettings.layout.geometry (default 482 x 680 pt)
  const geometry: PageGeometry = useMemo(
    () =>
      designSettings?.layout?.geometry ??
      boot.snapshot.geometry ?? {
        pageWidth: 482.0,
        pageHeight: 680.0,
        marginTop: 48.0,
        marginBottom: 48.0,
        marginInside: 46.0,
        marginOutside: 42.0,
        isVerso: false,
      },
    [designSettings, boot.snapshot.geometry]
  );

  // v0.6.0 Part A (§5) — geometry for pagination: the plain geometry with
  // the running-header reserve added to the top margin while the header
  // line is on (content reflows down); zero reserve while it is off (the
  // space collapses, no blank gap). The stored margin is untouched.
  const paginationGeometry: PageGeometry = useMemo(
    () => DesignSettingsEngine.paginationGeometryFor(designSettings, geometry),
    [designSettings, geometry]
  );

  // Application-Wide Undo / Redo History Manager & Saved Baseline Tracking
  const [historyVersion, setHistoryVersion] = useState<number>(0);
  const [baselineVersion, setBaselineVersion] = useState<number>(0);
  const isApplyingUndoRedoRef = useRef<boolean>(false);
  const lastActionLabelRef = useRef<{ label: string; key: string; coalesce: boolean }>({
    label: t("שינוי במסמך"),
    key: 'edit',
    coalesce: true,
  });

  const currentSnapshotState: UndoRedoSnapshotState = useMemo(
    () => ({
      documentTitle,
      layoutType,
      geometry,
      contentUnits,
      explicitLinks: ravTextLinks,
      kneeSettings,
      sourceFontSize:
        designSettings?.roleStyles?.main_source?.character?.fontSizePt ??
        (layoutType === 'mikraot_gedolot' ? 16 : 14.5),
      commentaryFontSize:
        designSettings?.roleStyles?.primary_comment?.character?.fontSizePt ?? 10.5,
      selectedFont,
      selectedRashiFont,
      selectedTosafotFont,
      enableOrnaments,
      currentPageIndex,
      projectRules,
      localOverrides,
      designSettings,
      // v0.6.0 (Part B): manual page breaks are snapshot state now — a
      // split is undoable, autosaved and stored in the .keter file.
      breakInstructions,
    }),
    [
      documentTitle,
      layoutType,
      geometry,
      contentUnits,
      ravTextLinks,
      kneeSettings,
      selectedFont,
      selectedRashiFont,
      selectedTosafotFont,
      enableOrnaments,
      currentPageIndex,
      projectRules,
      localOverrides,
      designSettings,
      breakInstructions,
    ]
  );

  const historyManagerRef = useRef<UndoRedoHistoryManager | null>(null);
  if (!historyManagerRef.current) {
    historyManagerRef.current = new UndoRedoHistoryManager(currentSnapshotState);
  }

  // Last saved baseline snapshot for accurate dirty state detection
  const lastSavedBaselineRef = useRef<ProjectSnapshot | null>(null);
  if (!lastSavedBaselineRef.current) {
    lastSavedBaselineRef.current = UndoRedoHistoryManager.toProjectSnapshot(
      currentSnapshotState,
      t("מצב שמור התחלתי")
    );
  }

  const currentProjectSnapshot: ProjectSnapshot = useMemo(
    () =>
      UndoRedoHistoryManager.toProjectSnapshot(
        currentSnapshotState,
        lastActionLabelRef.current.label
      ),
    [currentSnapshotState]
  );

  // Track whether current project has unsaved changes relative to lastSavedBaseline
  const isDirty: boolean = useMemo(() => {
    void baselineVersion;
    return ProjectPersistenceEngine.isSnapshotDirty(
      currentProjectSnapshot,
      lastSavedBaselineRef.current
    );
  }, [currentProjectSnapshot, baselineVersion]);

  // Warn before browser tab/window close when there are unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  // Record meaningful document/layout/formatting/editor changes into UndoRedoHistoryManager
  // AND persist real editable project state to Autosave (with last-known-good backup)
  useEffect(() => {
    const snapshotToAutosave = UndoRedoHistoryManager.toProjectSnapshot(
      currentSnapshotState,
      lastActionLabelRef.current.label
    );
    const savedOk = ProjectPersistenceEngine.saveAutosave(snapshotToAutosave);
    if (savedOk) {
      setLastAutosaveTimestamp(snapshotToAutosave.timestamp);
    }

    if (isApplyingUndoRedoRef.current) {
      isApplyingUndoRedoRef.current = false;
      return;
    }
    const mgr = historyManagerRef.current;
    if (!mgr) return;
    const { label, key, coalesce } = lastActionLabelRef.current;
    const changed = mgr.recordChange(currentSnapshotState, label, key, coalesce);
    if (changed) {
      setHistoryVersion(v => v + 1);
    }
    lastActionLabelRef.current = {
      label: t("עריכת מסמך / עימוד"),
      key: 'edit',
      coalesce: true,
    };
  }, [currentSnapshotState]);

  const applySnapshotState = useCallback((snap: UndoRedoSnapshotState) => {
    isApplyingUndoRedoRef.current = true;
    setDocumentTitle(snap.documentTitle);
    setLayoutType(snap.layoutType);
    setContentUnits(snap.contentUnits);
    if (snap.explicitLinks) {
      setRavTextLinks(snap.explicitLinks);
    }
    setKneeSettings(snap.kneeSettings);
    setSelectedFont(snap.selectedFont);
    setSelectedRashiFont(snap.selectedRashiFont);
    setSelectedTosafotFont(snap.selectedTosafotFont);
    setEnableOrnaments(snap.enableOrnaments ?? true);
    setCurrentPageIndex(snap.currentPageIndex ?? 0);
    setProjectRules(snap.projectRules ?? []);
    setLocalOverrides(snap.localOverrides ?? []);
    // v0.6.0 (Part B): undo/redo restores manual page breaks too.
    setBreakInstructions(snap.breakInstructions ?? []);
    if (snap.designSettings) {
      setDesignSettings({
        ...snap.designSettings,
        layout: {
          ...snap.designSettings.layout,
          layoutType: snap.layoutType,
          geometry: snap.geometry ?? snap.designSettings.layout.geometry,
        },
      });
    }
    setHistoryVersion(v => v + 1);
  }, []);

  // Load a complete ProjectSnapshot as a fresh project session (resetting Undo/Redo baseline)
  const loadProjectSnapshotIntoWorkspace = useCallback(
    (snapshot: ProjectSnapshot, markCleanBaseline: boolean = true) => {
      const restoredDesign = ProjectPersistenceEngine.buildDesignSettingsFromSnapshot(snapshot);
      const nextState: UndoRedoSnapshotState = {
        documentTitle: snapshot.documentTitle,
        layoutType: snapshot.layoutType,
        geometry: restoredDesign.layout.geometry,
        contentUnits: snapshot.units,
        explicitLinks: snapshot.links ?? [],
        kneeSettings: snapshot.kneeSettings,
        sourceFontSize:
          snapshot.sourceFontSize ??
          restoredDesign.roleStyles.main_source.character.fontSizePt,
        commentaryFontSize:
          snapshot.commentaryFontSize ??
          restoredDesign.roleStyles.primary_comment.character.fontSizePt,
        selectedFont: snapshot.selectedFont,
        selectedRashiFont: snapshot.selectedRashiFont,
        selectedTosafotFont: snapshot.selectedTosafotFont,
        enableOrnaments: snapshot.enableOrnaments ?? true,
        currentPageIndex: snapshot.currentPageIndex ?? 0,
        projectRules: snapshot.projectRules ?? [],
        localOverrides: snapshot.localOverrides ?? [],
        // v0.6.0 (Part B): a saved project's manual page breaks come back.
        breakInstructions: snapshot.breakInstructions ?? [],
        designSettings: restoredDesign,
      };

      isApplyingUndoRedoRef.current = true;
      setDocumentTitle(nextState.documentTitle);
      setLayoutType(nextState.layoutType);
      setContentUnits(nextState.contentUnits);
      setRavTextLinks(nextState.explicitLinks ?? []);
      setKneeSettings(nextState.kneeSettings);
      setSelectedFont(nextState.selectedFont);
      setSelectedRashiFont(nextState.selectedRashiFont);
      setSelectedTosafotFont(nextState.selectedTosafotFont);
      setEnableOrnaments(nextState.enableOrnaments);
      setCurrentPageIndex(nextState.currentPageIndex);
      setProjectRules(nextState.projectRules ?? []);
      setLocalOverrides(nextState.localOverrides ?? []);
      setBreakInstructions(nextState.breakInstructions ?? []);
      setDesignSettings(restoredDesign);
      setSelectedUnitId(null);
      setSelectedWordInfo(null);

      historyManagerRef.current?.reset(nextState);
      setHistoryVersion(v => v + 1);
      setHasOpenedBook(true);

      if (markCleanBaseline) {
        lastSavedBaselineRef.current = UndoRedoHistoryManager.toProjectSnapshot(
          nextState,
          snapshot.label || snapshot.documentTitle
        );
        setBaselineVersion(v => v + 1);
      }

      ProjectPersistenceEngine.saveAutosave(
        UndoRedoHistoryManager.toProjectSnapshot(nextState, snapshot.label || snapshot.documentTitle)
      );
    },
    []
  );

  // Unified handler for updating designSettings from either UI panel or AI Chat
  const handleUpdateDesignSettings = useCallback(
    (nextSettings: ProfessionalDesignSettings, summaryHe: string = t("עדכון הגדרות עיצוב")) => {
      lastActionLabelRef.current = {
        label: summaryHe,
        key: `design-settings-${nextSettings.revision}`,
        coalesce: false,
      };
      setDesignSettings(nextSettings);
      if (nextSettings.layout.layoutType !== layoutType) {
        setLayoutType(nextSettings.layout.layoutType);
      }
      if (nextSettings.roleStyles.main_source.character.fontFamily !== selectedFont) {
        setSelectedFont(nextSettings.roleStyles.main_source.character.fontFamily);
      }
      if (nextSettings.roleStyles.primary_comment.character.fontFamily !== selectedRashiFont) {
        setSelectedRashiFont(nextSettings.roleStyles.primary_comment.character.fontFamily);
      }
      if (nextSettings.roleStyles.secondary_comment.character.fontFamily !== selectedTosafotFont) {
        setSelectedTosafotFont(nextSettings.roleStyles.secondary_comment.character.fontFamily);
      }
      if (nextSettings.ravText.kneeSettings) {
        setKneeSettings(nextSettings.ravText.kneeSettings);
      }
      // v0.5.0 (Title Page): navigate straight to page 0 when turning on the
      // title page or switching cover mode so the user immediately sees the
      // cover/title page they are editing; turning it off steps back by 1.
      const wasTitleOn = designSettings?.titlePage?.enabled === true;
      const isTitleOn = nextSettings?.titlePage?.enabled === true;
      const coverModeChanged =
        isTitleOn &&
        nextSettings?.titlePage?.coverMode !== designSettings?.titlePage?.coverMode;
      if (!wasTitleOn && isTitleOn) {
        setCurrentPageIndex(0);
      } else if (wasTitleOn && !isTitleOn) {
        setCurrentPageIndex(prev => Math.max(0, prev - 1));
      } else if (coverModeChanged) {
        setCurrentPageIndex(0);
      }
    },
    [layoutType, selectedFont, selectedRashiFont, selectedTosafotFont, designSettings]
  );

  // v0.6.0 Part C (§2/§6): movable custom-layout boxes in the main
  // preview. The canvas reports the dragged boxes for the ACTIVE folio;
  // they save as that folio's page override, so the rest of the book
  // never moves, and pagination reflows the text live.
  const handleCustomLayoutBoxesChange = useCallback(
    (pageIndex: number, boxes: import('./types/design-settings').CustomLayoutBox[]) => {
      if (!designSettings) return;
      const next = DesignSettingsEngine.setCustomLayoutPageOverride(
        designSettings,
        pageIndex,
        boxes,
        'user'
      );
      handleUpdateDesignSettings(next.settings, tf('התאמת תיבות פריסה לדף {page}', { page: pageIndex + 1 }));
    },
    [designSettings, handleUpdateDesignSettings]
  );

  // v0.6.0 Part C (§6): the running-header title edits in place on the
  // page — it IS the book title, so renaming it here renames the book.
  const handleHeaderTitleChange = useCallback((text: string) => {
    setDocumentTitle(text);
  }, []);

  // v0.6.0 Part C (§8): drag a title-page field to a new position on the
  // title page (PageCanvas overlay). The offsets persist in the project
  // JSON (titlePage.<field>.xOffsetPt / yOffsetPt) and the shared layout
  // helper applies them in the preview, the PDF and the IDML.
  const handleTitlePageFieldPositionChange = useCallback(
    (fieldId: string, xOffsetPt: number, yOffsetPt: number) => {
      if (!designSettings) return;
      const next = DesignSettingsEngine.cloneSettings(designSettings);
      const tp = next.titlePage;
      const patch = {
        xOffsetPt: Math.max(-200, Math.min(200, xOffsetPt)),
        yOffsetPt: Math.max(-200, Math.min(200, yOffsetPt)),
      };
      if (fieldId.startsWith('extra:')) {
        const idx = Number(fieldId.slice('extra:'.length));
        if (!Number.isInteger(idx) || !tp.extraLines[idx]) return;
        tp.extraLines = tp.extraLines.map((l, j) => (j === idx ? { ...l, ...patch } : l));
      } else if (fieldId.startsWith('meta:')) {
        // v0.9.9 — template metadata rows are positioned by the template
        // layout (layoutTemplateMetadataRows), not by per-field offsets,
        // so a drag on a metadata row is accepted and intentionally a
        // no-op for position; the text itself is edited through
        // handleTitlePageFieldChange.
        return;
      } else if (
        fieldId === 'title' || fieldId === 'subtitle' || fieldId === 'author' ||
        fieldId === 'translator' || fieldId === 'publisher' || fieldId === 'volume' ||
        fieldId === 'year'
      ) {
        tp[fieldId] = { ...tp[fieldId], ...patch };
      } else {
        return;
      }
      handleUpdateDesignSettings(next, tf('מיקום שדה בעמוד שער ({field})', { field: fieldId }));
    },
    [designSettings, handleUpdateDesignSettings]
  );

  // v0.5.0 (Title Page / Shaar Blat builder): direct on-page editing of a
  // title-page field (PageCanvas overlay). `fieldId` is one of
  // title/subtitle/author/translator/publisher/volume/year, or
  // `extra:<index>` for an extra line. Same undo path as every other
  // design-settings change (via handleUpdateDesignSettings).
  const handleTitlePageFieldChange = useCallback(
    (fieldId: string, text: string) => {
      if (!designSettings) return;
      const next = DesignSettingsEngine.cloneSettings(designSettings);
      const tp = next.titlePage;
      if (fieldId.startsWith('extra:')) {
        const idx = Number(fieldId.slice('extra:'.length));
        if (!Number.isInteger(idx) || !tp.extraLines[idx]) return;
        tp.extraLines = tp.extraLines.map((l, j) => (j === idx ? { ...l, text } : l));
      } else if (fieldId.startsWith('meta:')) {
        // v0.9.9 — the title-page overlay emits `meta:<key>` for the
        // template metadata rows; write the text into templateMetadata
        // (validated against the known keys + the three template
        // overrides). Unknown keys are refused, never guessed.
        const key = fieldId.slice('meta:'.length);
        const { templateId, metadata } = readTitlePageTemplateState(next.titlePage);
        if (key in TITLE_PAGE_METADATA_LABELS_HE) {
          metadata[key as keyof typeof TITLE_PAGE_METADATA_LABELS_HE] = text;
        } else if (key === 'titleStyle' && (text === 'upright' || text === 'boldItalic')) {
          metadata.titleStyle = text;
        } else if (key === 'backgroundOverride' && (text === 'plain' || text === 'warm' || text === 'textured')) {
          metadata.backgroundOverride = text;
        } else if (key === 'emblemId') {
          metadata.emblemId = text;
        } else {
          return;
        }
        next.titlePage = writeTitlePageTemplateState(next.titlePage, templateId, metadata);
      } else if (
        fieldId === 'title' || fieldId === 'subtitle' || fieldId === 'author' ||
        fieldId === 'translator' || fieldId === 'publisher' || fieldId === 'volume' ||
        fieldId === 'year'
      ) {
        tp[fieldId] = { ...tp[fieldId], text };
      } else {
        return;
      }
      handleUpdateDesignSettings(next, tf('עריכת עמוד שער ({field})', { field: fieldId }));
    },
    [designSettings, handleUpdateDesignSettings]
  );

  // 6. CORE TYPESETTING: Multi-page document calculation consuming shared designSettings
  const bookDoc: BookTypesetDocument = useMemo(() => {
    const body = PaginationEngine.paginateDocument({
      title: documentTitle,
      layoutType,
      units: contentUnits,
      links: ravTextLinks,
      // v0.9.8 Phase 3/4 — AnchorLinks stamped on the units by the
      // importer feed same-page gravity; explicit `links` above still
      // win inside the paginator when both are present.
      anchorLinks: contentUnits
        .map(u => u.anchorLink)
        .filter((a): a is AnchorLink => !!a),
      // v0.6.0 Part A (§5): pagination runs on the geometry with the
      // header reserve applied — when the top header line is on, the
      // text starts lower (a real reflow); when it is off the reserve
      // collapses to zero and the text moves back up. The stored margin
      // never changes; only the geometry handed to the engine does.
      // The title page below keeps the plain geometry (no header on it).
      geometry: paginationGeometry,
      sourceFontSize:
        designSettings?.roleStyles?.main_source?.character?.fontSizePt ??
        (layoutType === 'mikraot_gedolot' ? 16 : 14.5),
      commentaryFontSize:
        designSettings?.roleStyles?.primary_comment?.character?.fontSizePt ?? 10.5,
      kneeSettings,
      sourceFontFamily: selectedFont,
      rashiFontFamily: selectedRashiFont,
      tosafotFontFamily: selectedTosafotFont,
      enableOrnaments,
      rulesConfig,
      projectRules,
      localOverrides,
      designSettings,
    });
    // v0.5.0 (Title Page / Shaar Blat builder): the title page is the
    // book's first page — a synthetic page (no typeset lines) that the
    // renderers draw from `designSettings.titlePage`. The body pages that
    // follow are numbered from 2: rav_text / mikraot already number the
    // first body page 2 (the cover is assumed), and single_column starts
    // at 1, so the shift unifies every layout.
    if (designSettings?.titlePage?.enabled !== true) return body;
    const titlePage = buildTitlePageResult(geometry, layoutType, designSettings, documentTitle);
    const pages: PageTypesetResult[] = [
      titlePage,
      ...body.pages.map((p, i) => ({
        ...p,
        pageIndex: p.pageIndex + 1,
        pageNumber: i + 2,
        pageNumberHebrew: PdfExporter.toHebrewGematria(i + 2),
      })),
    ];
    return { ...body, pages, totalPages: pages.length };
  }, [
    documentTitle,
    layoutType,
    contentUnits,
    ravTextLinks,
    geometry,
    paginationGeometry,
    kneeSettings,
    selectedFont,
    selectedRashiFont,
    selectedTosafotFont,
    enableOrnaments,
    rulesConfig,
    projectRules,
    localOverrides,
    designSettings,
  ]);

  // v0.3.0: whole-book balancing + anchored break instructions as guarded
  // post-passes over the paginated pages (pagination itself is untouched).
  // v0.6.0 (Part B): the order is balancing FIRST, breaks LAST. The other
  // way round, the balancer's widow/orphan fix could pull a line the user
  // just split back onto the previous page — silently undoing the split
  // while the toast claimed success. An explicit manual break wins over
  // automatic balancing; a widow a break creates stays until the user
  // drags again. Exports and the navigator use these pages too, so a
  // split survives save / reload / PDF / IDML.
  const displayPages: PageTypesetResult[] = useMemo(() => {
    try {
      const balanced = wholeBookBalancingPass(bookDoc.pages);
      const withBreaks = applyBreakInstructions(balanced.pages, breakInstructions, contentUnits);
      return withBreaks.pages;
    } catch {
      return bookDoc.pages;
    }
  }, [bookDoc, breakInstructions, contentUnits, balanceNonce]);

  /** The book as shown on screen (post-passes applied) — what exports render. */
  const displayBookDoc: BookTypesetDocument = useMemo(
    () => ({ ...bookDoc, pages: displayPages, totalPages: displayPages.length }),
    [bookDoc, displayPages]
  );

  // v0.4.0 — the balancing pass is pure/deterministic and already runs on
  // every pagination, so "re-run balancing" cannot change the pages by
  // itself. What IS real: the pass's report — how many widows/orphans/
  // columns it fixed on the raw paginated pages, and what it could NOT fix.
  // Handlers below report these real numbers instead of claiming a success
  // they did not produce, and unfixable notes are shown under the toolbar.
  const computeBalanceReport = useCallback((): BookBalancingReport => {
    try {
      // Same order as `displayPages`: balancing first, manual breaks last.
      const balanced = wholeBookBalancingPass(bookDoc.pages);
      return balanced.report;
    } catch {
      return { pagesAdjusted: 0, widowsFixed: 0, orphansFixed: 0, columnsBalanced: 0, notes: [] };
    }
  }, [bookDoc]);
  const balanceReport: BookBalancingReport = useMemo(
    () => computeBalanceReport(),
    [computeBalanceReport]
  );

  // v0.8.0 Part E — layout-health indicator: collision counts were
  // computed per page (`layoutScore.collisionCount`) but never surfaced
  // in the editor, so an overlapping page rendered silently. The strip
  // below shows the total + affected pages and jumps to the first one.
  const collisionReport = useMemo(() => {
    const pages: Array<{ pageIndex: number; pageNumberHebrew: string; count: number }> = [];
    let total = 0;
    displayPages.forEach((p, i) => {
      const c = p.layoutScore?.collisionCount ?? 0;
      if (c > 0) {
        total += c;
        pages.push({ pageIndex: i, pageNumberHebrew: p.pageNumberHebrew, count: c });
      }
    });
    return { total, pages };
  }, [displayPages]);

  // Safe active page clamping
  const totalPages = Math.max(1, displayPages.length);
  const safePageIndex = Math.min(currentPageIndex, totalPages - 1);
  // v0.7.0 Part 2 (M3) — text-threading links for the current page.
  const threadLinks = useMemo(() => computeThreadLinks(displayPages, safePageIndex), [displayPages, safePageIndex]);
  const activePage: PageTypesetResult = displayPages[safePageIndex] || displayPages[0];

  // v0.6.0 Part C (§2/§6): the active folio's effective custom-layout
  // boxes for the main-preview move/resize mode (per-page override when
  // one exists, else the global boxes). Body index: the title page, when
  // on, shifts display indices by one.
  const bodyPageIndexForLayout =
    designSettings?.titlePage?.enabled === true ? safePageIndex - 1 : safePageIndex;
  const customLayoutBoxesForPage: import('./types/design-settings').CustomLayoutBox[] | undefined =
    layoutType === 'custom_layout' && !activePage?.isTitlePage && bodyPageIndexForLayout >= 0
      ? designSettings?.pageLayout.customLayout?.pageOverrides?.[String(bodyPageIndexForLayout)] ??
        designSettings?.pageLayout.customLayout?.boxes ??
        []
      : undefined;

  // 7. Post-Import Integrity Check & Preflight QA
  const validationReport = useMemo(() => {
    return DocxImporter.validateDocumentIntegrity(contentUnits, ravTextLinks);
  }, [contentUnits, ravTextLinks]);

  const qaReport = useMemo(() => {
    // v0.5.0 (Title Page): a title page has no text to QA — report it
    // clean instead of auditing an empty page.
    if (activePage?.isTitlePage) {
      return { issues: [], qualityScore: 100, isPrintReady: true, autoFixesSummary: [], textIssues: [] };
    }
    return QaEngine.runFullQa(activePage);
  }, [activePage]);

  // v0.3.0: full-fidelity text proofreading (raw unit text, not reconstructed).
  const textIssues = useMemo(() => {
    try {
      return QaEngine.runTextProofing(contentUnits, bookDoc.pages, selectedFont);
    } catch {
      return [] as TextIssue[];
    }
  }, [contentUnits, bookDoc, selectedFont]);

  // Show auto-dismissing toast notification
  const showToast = useCallback((message: string, type: 'success' | 'error' | 'warning' = 'success') => {
    setNotification({ message, type });
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setNotification(null), 4000);
  }, []);

  // Show initial recovery notice if recovered from backup
  useEffect(() => {
    if (boot.recoveredFromBackup) {
      showToast(
        t("השמירה האוטומטית האחרונה נפגמה — שוחזרה הגרסה התקינה האחרונה (Last Known Good)"),
        'success'
      );
    }
  }, [boot.recoveredFromBackup, showToast]);

  const handleUndo = useCallback(() => {
    const mgr = historyManagerRef.current;
    if (!mgr || !mgr.canUndo()) return;
    const label = mgr.getLastUndoLabel() || t("פעולה אחרונה");
    const restored = mgr.undo();
    if (restored) {
      applySnapshotState(restored);
      showToast(tf('בוטל: {label} (Ctrl+Z)', { label }), 'success');
    }
  }, [applySnapshotState, showToast]);

  const handleRedo = useCallback(() => {
    const mgr = historyManagerRef.current;
    if (!mgr || !mgr.canRedo()) return;
    const label = mgr.getLastRedoLabel() || t("פעולה אחרונה");
    const restored = mgr.redo();
    if (restored) {
      applySnapshotState(restored);
      showToast(tf('בוצע מחדש: {label} (Ctrl+Y)', { label }), 'success');
    }
  }, [applySnapshotState, showToast]);

  // Save/Export native .keter project file using real desktop file operation
  const handleSaveProjectFile = useCallback(
    async (suggestedName?: string): Promise<boolean> => {
      const snapshot = UndoRedoHistoryManager.toProjectSnapshot(
        currentSnapshotState,
        tf('שמירה יזומה: {title}', { title: documentTitle })
      );
      ProjectPersistenceEngine.saveVersionSnapshot(snapshot);
      ProjectPersistenceEngine.saveAutosave(snapshot);
      const result = await ProjectPersistenceEngine.saveProjectFileDesktop(
        snapshot,
        suggestedName
      );
      if (result.saved) {
        lastSavedBaselineRef.current = snapshot;
        setBaselineVersion(v => v + 1);
        setLastAutosaveTimestamp(snapshot.timestamp);
        setRecentProjects(ProjectPersistenceEngine.getRecentProjects());
        showToast(tf('קובץ הפרויקט ({file}) נשמר בהצלחה!', { file: result.fileName }), 'success');
        return true;
      }
      return false;
    },
    [currentSnapshotState, documentTitle, showToast]
  );
  // v0.7.0 Part 1 (M2) — the custom-layout box holding the selected unit's
  // lines on the current page, for the Control Panel geometry inputs.
  const selectedFrame = useMemo(() => {
    if (!selectedUnitId || !customLayoutBoxesForPage) return null;
    const page = displayPages[Math.min(currentPageIndex, totalPages - 1)];
    if (!page) return null;
    const allLines = [...page.sourceLines, ...page.rashiLines, ...page.tosafotLines, ...(page.column2Lines ?? [])];
    const boxId = allLines.find(l => l.unitId === selectedUnitId)?.customLayoutBoxId;
    if (!boxId) return null;
    const box = customLayoutBoxesForPage.find(b => b.id === boxId);
    if (!box) return null;
    return { box, pageWidthPt: geometry.pageWidth, pageHeightPt: geometry.pageHeight, isVerso: Math.min(currentPageIndex, totalPages - 1) % 2 === 1 };
  }, [selectedUnitId, customLayoutBoxesForPage, displayPages, currentPageIndex, totalPages, geometry.pageWidth, geometry.pageHeight]);

  const handleFrameGeometryChange = useCallback(
    (boxId: string, patch: Partial<import('./types/design-settings').CustomLayoutBox>) => {
      if (!customLayoutBoxesForPage) return;
      handleCustomLayoutBoxesChange(
        bodyPageIndexForLayout,
        customLayoutBoxesForPage.map(b => (b.id === boxId ? { ...b, ...patch } : b))
      );
    },
    [customLayoutBoxesForPage, handleCustomLayoutBoxesChange, bodyPageIndexForLayout]
  );

  // v0.7.0 Part 2 (M3) — add a frame-tool box to the current custom-layout page.
  const handleAddFrame = useCallback(() => {
    if (activeTool === 'select' || activeTool === 'type') return;
    if (layoutType !== 'custom_layout') {
      showToast(t('מסגרות זמינות רק כשסוג העימוד הוא פריסה מותאמת'), 'error');
      return;
    }
    const box = createFrameBox(activeTool, 'main_text', polygonVariant);
    const base = customLayoutBoxesForPage ?? [];
    handleCustomLayoutBoxesChange(bodyPageIndexForLayout, [...base, box]);
    showToast(t('המסגרת נוספה לעמוד'), 'success');
  }, [activeTool, layoutType, polygonVariant, customLayoutBoxesForPage, handleCustomLayoutBoxesChange, bodyPageIndexForLayout, showToast, t]);

  // v0.8.0 Part E (#14) — drag-to-draw: the canvas reports the dragged
  // rect; the parent creates the box at that exact rect and reverts to
  // the select tool. The toolbar's "Add frame" button above stays as
  // the fallback that drops the default-size frame.
  const handleDrawFrame = useCallback((
    rect: { xPct: number; yPct: number; widthPct: number; heightPct: number },
    tool: Exclude<FrameToolId, 'select' | 'type'>
  ) => {
    if (layoutType !== 'custom_layout') {
      showToast(t('מסגרות זמינות רק כשסוג העימוד הוא פריסה מותאמת'), 'error');
      setActiveTool('select');
      return;
    }
    const box = createFrameBox(tool, 'main_text', polygonVariant, rect);
    const base = customLayoutBoxesForPage ?? [];
    handleCustomLayoutBoxesChange(bodyPageIndexForLayout, [...base, box]);
    setActiveTool('select');
    showToast(t('המסגרת נוספה לעמוד'), 'success');
  }, [layoutType, polygonVariant, customLayoutBoxesForPage, handleCustomLayoutBoxesChange, bodyPageIndexForLayout, showToast, t]);

  // v0.8.0 Part E (#14) — Type tool drag: a text frame is drawn empty and
  // a new empty unit is created for it, then the Story Editor opens
  // focused on that unit so the user types the text. No placeholder text
  // is seeded — an empty unit with no lines cannot be typed into on the
  // canvas (buildUnitPageTextMap returns null for lineless units), which
  // is exactly why the Story Editor route is used. Single click on a word
  // already starts editing, so T-click-on-text already worked.
  const handleDrawTextFrame = useCallback((rect: {
    xPct: number;
    yPct: number;
    widthPct: number;
    heightPct: number;
  }) => {
    if (layoutType !== 'custom_layout') {
      showToast(t('מסגרות זמינות רק כשסוג העימוד הוא פריסה מותאמת'), 'error');
      setActiveTool('select');
      return;
    }
    const newUnitId = `u-frame-${Date.now()}`;
    const newUnit: ContentUnit = {
      id: newUnitId,
      role: 'regular_paragraph',
      rawText: '',
      styleName: 'Normal',
      order: contentUnits.length,
      hierarchyLevel: 3,
    };
    const box = createFrameBox('rectangle', 'main_text', polygonVariant, rect);
    setContentUnits(prev => [...prev, { ...newUnit, order: prev.length }]);
    const base = customLayoutBoxesForPage ?? [];
    handleCustomLayoutBoxesChange(bodyPageIndexForLayout, [...base, box]);
    setActiveTool('select');
    setSelectedUnitId(newUnitId);
    setInitialEditingUnitId(newUnitId);
    setStoryView(true);
  }, [layoutType, polygonVariant, contentUnits.length, customLayoutBoxesForPage, handleCustomLayoutBoxesChange, bodyPageIndexForLayout, showToast, t]);


  // Guard helper that prompts UnsavedChangesModal if current project is dirty
  const runWithUnsavedChangesGuard = useCallback(
    (descriptionHe: string, action: () => void) => {
      if (isDirty) {
        setPendingProtectedAction({
          descriptionHe,
          execute: action,
        });
      } else {
        action();
      }
    },
    [isDirty]
  );

  // Load/Import native .keter / .keter.json File object with strict validation & non-destructive error handling
  const loadValidatedProjectFile = useCallback(
    async (file: File) => {
      try {
        const snapshot = await ProjectPersistenceEngine.importKeterProjectFile(file);
        loadProjectSnapshotIntoWorkspace(snapshot, true);
        const updatedRecent = ProjectPersistenceEngine.recordRecentProject(
          snapshot,
          file.name
        );
        setRecentProjects(updatedRecent);
        setEditingUnitId(null);
        setActiveWorkMode('edit');
        showToast(tf('פרויקט "{title}" נטען ושוחזר במלואו!', { title: snapshot.documentTitle }), 'success');
      } catch (err: any) {
        // Never discard or corrupt the currently open project when loading fails
        showToast(err.message || t("שגיאה בטעינת קובץ פרויקט (.keter)"), 'error');
      }
    },
    [loadProjectSnapshotIntoWorkspace, showToast]
  );

  const handleImportProjectFileInput = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      await loadValidatedProjectFile(file);
    },
    [loadValidatedProjectFile]
  );

  // Trigger Open Project File (guarded for unsaved changes)
  const handleRequestOpenProjectFile = useCallback(() => {
    runWithUnsavedChangesGuard(t("פתיחת קובץ פרויקט אחר (.keter)"), async () => {
      if (typeof (window as any).showOpenFilePicker === 'function') {
        const file = await ProjectPersistenceEngine.openProjectFilePickerDesktop();
        if (file) {
          await loadValidatedProjectFile(file);
        }
      } else {
        projectFileInputRef.current?.click();
      }
    });
  }, [runWithUnsavedChangesGuard, loadValidatedProjectFile]);

  // Trigger New Project Modal (guarded for unsaved changes).
  // v0.9.2 Part B — the mode arg preserves the two entry points'
  // old defaults now that both open this one modal: 'blank' from the
  // header menu / palette / keyboard, 'sample' from the Home screen
  // (whose inline wizard used to default to sample). v0.9.4 — Home's
  // inline form is back and defaults to 'sample' itself, so no caller
  // passes 'sample' any more; the arg stays for any opener that wants
  // it, and both entry points still end in handleCreateNewProject.
  const handleRequestNewProject = useCallback((mode: 'blank' | 'sample' = 'blank') => {
    runWithUnsavedChangesGuard(t("יצירת פרויקט חדש"), () => {
      setNewProjectModalInitialMode(mode);
      setIsNewProjectModalOpen(true);
    });
  }, [runWithUnsavedChangesGuard]);

  // Trigger DOCX Import Modal (guarded for unsaved changes)
  const handleRequestOpenDocx = useCallback(() => {
    runWithUnsavedChangesGuard(t("ייבוא קובץ Word (DOCX) חדש"), () => {
      setIsDocxModalOpen(true);
    });
  }, [runWithUnsavedChangesGuard]);

  /**
   * v0.9.7 — THE one DOCX import handler, shared by the modal AND the
   * inline Home hub (both render the same DocxImportHub). The hub
   * already classified the document and picked the best-matching
   * historical recipe; the snapshot is created in THAT layout, and the
   * recipe's preset + typographic rules are applied on top of the
   * snapshot's restored settings (computed from the restored design,
   * not from stale state). Low confidence already fell back to a
   * stated default in the decision.
   */
  const handleImportUnits = useCallback(
    (units: ContentUnit[], title: string, links?: RavTextLink[], autoLayout?: AutoLayoutImportInfo, setup?: ChosenSetup) => {
      const decision = autoLayout?.decision;
      // v0.9.9 — ONE explicit chosen setup, passed in by the caller
      // (Home / New Project). Only when no setup is passed does the
      // one-time migration run, honouring a choice stored before this
      // release, then deleting it. No localStorage is read or written
      // anywhere else in the creation flow any more.
      const chosen: ChosenSetup | null = setup ?? migratePendingChosenSetup();
      const pendingCustom = chosen?.customLayout ?? null;
      const pendingArchetype = chosen?.archetypeId ?? null;
      const pendingRecipeId = chosen?.recipeId ?? null;
      // A plain base-layout choice (no recipe / archetype / custom
      // boxes) is the explicit layout.
      const pendingExplicitLayout = chosen && !chosen.recipeId && !chosen.archetypeId && !chosen.customLayout
        ? chosen.baseLayout
        : null;

      const archetypeObj = pendingArchetype ? getArchetypeById(pendingArchetype) : undefined;
      const pendingRecipeObj = pendingRecipeId ? getRecipeById(pendingRecipeId) : undefined;
      const effectiveRecipeId = archetypeObj?.recipeId ?? pendingRecipeId ?? null;

      const nextLayout: BookLayoutType = pendingCustom
        ? 'custom_layout'
        : archetypeObj?.baseLayout ??
          pendingRecipeObj?.baseLayout ??
          pendingExplicitLayout ??
          decision?.layoutType ??
          layoutType;

      const importedSnapshot = ProjectPersistenceEngine.createNewProjectSnapshot({
        documentTitle: title,
        layoutType: nextLayout,
        units,
        links: links ?? [],
        selectedFont,
        selectedRashiFont,
        selectedTosafotFont,
        geometry,
        customLayout: pendingCustom ?? undefined,
      });
      loadProjectSnapshotIntoWorkspace(importedSnapshot, true);

      const baseSettings = ProjectPersistenceEngine.buildDesignSettingsFromSnapshot(importedSnapshot);
      const tp = autoLayout?.classification.titlePage;

      if (pendingCustom) {
        let nextSettings = tp
          ? titlePageSettingsFromClassification(baseSettings, tp)
          : baseSettings;
        handleUpdateDesignSettings(nextSettings, t('הוחלה תבנית עימוד מותאמת אישית'));
        setAutoLayoutNotice(null);
        setAutoLayoutChangeTarget('custom_layout');
      } else if (pendingArchetype) {
        let nextSettings = applyArchetypeToSettings(pendingArchetype, baseSettings);
        if (tp) nextSettings = titlePageSettingsFromClassification(nextSettings, tp);
        handleUpdateDesignSettings(nextSettings, t('הוחלה תבנית עימוד אוטומטית'));
        if (decision) {
          setAutoLayoutNotice({
            lineHe: decision.lineHe,
            lineEn: decision.lineEn,
            recipeId: effectiveRecipeId ?? decision.recipeId,
            isFallback: decision.isFallback,
          });
        }
        setAutoLayoutChangeTarget(nextLayout);
      } else if (pendingRecipeId) {
        let nextSettings = applyRecipeToSettingsById(pendingRecipeId, baseSettings);
        if (tp) nextSettings = titlePageSettingsFromClassification(nextSettings, tp);
        handleUpdateDesignSettings(nextSettings, t('הוחלה תבנית עימוד אוטומטית'));
        if (decision) {
          setAutoLayoutNotice({
            lineHe: decision.lineHe,
            lineEn: decision.lineEn,
            recipeId: pendingRecipeId,
            isFallback: false,
          });
        }
        setAutoLayoutChangeTarget(nextSettings.layoutType);
      } else if (pendingExplicitLayout) {
        // Explicit base layout from Step 1: refine with matching classifier recipe
        // only when it matches the user's chosen layout; never revert layoutType.
        let nextSettings =
          decision && decision.layoutType === pendingExplicitLayout
            ? applyRecipeToSettingsById(decision.recipeId, baseSettings)
            : baseSettings;
        if (tp) nextSettings = titlePageSettingsFromClassification(nextSettings, tp);
        handleUpdateDesignSettings(nextSettings, t('הוחלה תבנית עימוד אוטומטית'));
        if (decision && decision.layoutType === pendingExplicitLayout) {
          setAutoLayoutNotice({
            lineHe: decision.lineHe,
            lineEn: decision.lineEn,
            recipeId: decision.recipeId,
            isFallback: decision.isFallback,
          });
        } else {
          setAutoLayoutNotice(null);
        }
        setAutoLayoutChangeTarget(nextLayout);
      } else if (decision) {
        let nextSettings = applyRecipeToSettingsById(decision.recipeId, baseSettings);
        if (tp) nextSettings = titlePageSettingsFromClassification(nextSettings, tp);
        handleUpdateDesignSettings(nextSettings, t('הוחלה תבנית עימוד אוטומטית'));
        setAutoLayoutNotice({
          lineHe: decision.lineHe,
          lineEn: decision.lineEn,
          recipeId: decision.recipeId,
          isFallback: decision.isFallback,
        });
        setAutoLayoutChangeTarget(nextLayout);
      }

      setEditingUnitId(null);
      setActiveWorkMode('edit');
      showToast(t("קובץ DOCX יובא בהצלחה ועומד לספר!"), 'success');
    },
    [
      geometry,
      handleUpdateDesignSettings,
      layoutType,
      loadProjectSnapshotIntoWorkspace,
      selectedFont,
      selectedRashiFont,
      selectedTosafotFont,
      showToast,
      t,
    ]
  );

  // Create New Project from NewProjectModal or Home Mode
  const handleCreateNewProject = useCallback(
    (title: string, nextLayoutType: BookLayoutType, mode: 'blank' | 'sample', setup?: ChosenSetup) => {
      let units: ContentUnit[] = [];
      let links: RavTextLink[] = [];
      // v0.9.9 — the chosen setup arrives as an explicit argument
      // (Home / New Project form); the migration is only the fallback
      // for a choice stored before this release.
      const chosen: ChosenSetup | null = setup ?? migratePendingChosenSetup();
      const chosenLayout: BookLayoutType = chosen?.baseLayout ?? nextLayoutType;
      nextLayoutType = chosenLayout;

      if (mode === 'sample') {
        if (nextLayoutType === 'single_column') {
          units = DocxImporter.getSampleMussarSingleColumn();
        } else if (nextLayoutType === 'two_column') {
          units = DocxImporter.getSampleShulchanAruchTwoColumn();
        } else if (nextLayoutType === 'source_top_commentary_bottom') {
          units = DocxImporter.getSampleMishnahBerurahTopBottom();
        } else if (nextLayoutType === 'mikraot_gedolot') {
          units = DocxImporter.getSampleBereishit();
        } else if (nextLayoutType === 'yiddish_sefer') {
          // v0.8.0 Part D — Tzenerene-style Yiddish sample.
          units = DocxImporter.getSampleYiddishSefer();
        } else {
          units = DocxImporter.getSampleBerakhot();
          links = DEFAULT_BERAKHOT_LINKS;
        }
      }

      const newSnapshot = ProjectPersistenceEngine.createNewProjectSnapshot({
        documentTitle: title,
        layoutType: nextLayoutType,
        units,
        links,
        ...(chosen?.customLayout ? { customLayout: chosen.customLayout } : {}),
      });

      // v0.9.9 — a recipe / archetype in the chosen setup is applied
      // to the fresh project before it opens, through the SAME single
      // id-based applier the import path uses (applyRecipeToSettingsById
      // in auto-layout.ts) — so a wizard book and a Design-panel book
      // land identically, including the per-genre typography. The old
      // applySettledDefaultsOff step (header / folio / labels forced
      // OFF for wizard books only) is gone.
      const chosenRecipeId = chosen?.archetypeId
        ? getArchetypeById(chosen.archetypeId)?.recipeId
        : chosen?.recipeId;
      if (chosenRecipeId && newSnapshot.designSettings) {
        const switched = DesignSettingsEngine.updateLayoutSettings(
          newSnapshot.designSettings,
          { layoutType: 'custom_layout' },
          'user'
        );
        newSnapshot.designSettings = applyRecipeToSettingsById(chosenRecipeId, switched);
        // Layout training T2.3 — the recipe decides the layout type
        // (Vilna-family recipes land on the rav_text knee engine).
        newSnapshot.layoutType = newSnapshot.designSettings.layout.layoutType;
        newSnapshot.geometry = {
          ...newSnapshot.designSettings.pageLayout.geometry,
        };
      }

      setIsNewProjectModalOpen(false);
      loadProjectSnapshotIntoWorkspace(newSnapshot, true);
      setRecentProjects(ProjectPersistenceEngine.recordRecentProject(newSnapshot));
      setEditingUnitId(null);
      setActiveWorkMode('edit');
      showToast(tf('פרויקט חדש "{title}" נוצר בהצלחה!', { title }), 'success');
    },
    [loadProjectSnapshotIntoWorkspace, showToast]
  );

  // Recover Autosaved Work (Takes user into 'edit' on success)
  const handleRecoverAutosave = useCallback(() => {
    const recovery = ProjectPersistenceEngine.loadAutosaveWithRecovery();
    if (recovery.snapshot) {
      loadProjectSnapshotIntoWorkspace(recovery.snapshot, true);
      setRecentProjects(ProjectPersistenceEngine.recordRecentProject(recovery.snapshot));
      setEditingUnitId(null);
      setActiveWorkMode('edit');
      showToast(
        recovery.recoveredFromBackup
          ? t("הפרויקט שוחזר בהצלחה מגיבוי השמירה האוטומטית!")
          : t("הפרויקט שוחזר בהצלחה מתוך השמירה האוטומטית!"),
        'success'
      );
    } else {
      showToast(t("לא נמצאה שמירה אוטומטית תקפה לשחזור במכשיר זה."), 'error');
    }
  }, [loadProjectSnapshotIntoWorkspace, showToast]);

  // In-Place Canvas Text Edit Commit Handler (preserves unit ID, role, links, footnotes, and undo/redo history)
  const handleCommitInPlaceUnitEdit = useCallback(
    (
      unitId: string,
      newRawText: string,
      options?: {
        pageWordStartIndex?: number;
        pageWordEndIndexExclusive?: number;
        coalesceHistory?: boolean;
        silent?: boolean;
      }
    ) => {
      const targetUnit = contentUnits.find(u => u.id === unitId);
      if (!targetUnit) {
        return;
      }
      const { units: updatedUnits, links: updatedLinks, updatedUnit } =
        ProjectPersistenceEngine.updateContentUnitText(
          contentUnits,
          ravTextLinks,
          unitId,
          newRawText,
          options
        );
      if (!updatedUnit || updatedUnit.rawText === targetUnit.rawText) {
        return;
      }
      lastActionLabelRef.current = {
        label: `עריכת טקסט במקום (${unitId})`,
        key: `inline-edit-${unitId}`,
        coalesce: options?.coalesceHistory ?? true,
      };
      setContentUnits(updatedUnits);
      setRavTextLinks(updatedLinks);
      if (!options?.silent) {
        showToast(t("הטקסט עודכן במקום והעמוד עומד מחדש!"), 'success');
      }
    },
    [contentUnits, ravTextLinks, showToast]
  );

  // Global keyboard shortcuts for Undo, Redo, Save, New Project, and Page Up/Down navigation
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTextInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      const isCtrlOrMeta = e.ctrlKey || e.metaKey;
      if (isCtrlOrMeta) {
        const key = e.key.toLowerCase();
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault();
          handleUndo();
          return;
        } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
          e.preventDefault();
          handleRedo();
          return;
        } else if (key === 's') {
          e.preventDefault();
          void handleSaveProjectFile();
          return;
        } else if (key === 'k') {
          // v0.4.0 — command palette (checklist §4).
          e.preventDefault();
          setIsPaletteOpen(v => !v);
          return;
        }
        // v0.7.0 Part 2 (M4) — InDesign shortcuts (before the text-input guard
        // so Ctrl+Tab works everywhere; font-size/auto-center skip inputs).
        if (key === 'tab') {
          e.preventDefault();
          setStoryView(v => !v);
          return;
        }
        if (!isTextInput) {
          if ((key === '>' || key === '<') && e.shiftKey && selectedUnit) {
            e.preventDefault();
            // v0.8.0 Part E: per-unit override, not a whole-role update —
            // the old code resized every paragraph of the role, not just
            // the selected unit. Current size resolves unit-effective
            // (role + any existing local override).
            // v0.9.2 Part B: through the ONE shared text-style handler
            // (same as the floating toolbar + Design panel).
            const cur = DesignSettingsEngine.resolveRoleAndUnitStyle(designSettings, selectedUnit.role, selectedUnit.id).character.fontSizePt;
            const next = Math.max(6, Math.min(72, cur + (key === '>' ? 1 : -1)));
            const nextSettings = applyCharacterStyleChange(
              designSettings,
              { role: selectedUnit.role, unitId: selectedUnit.id },
              { fontSizePt: next }
            );
            handleUpdateDesignSettings(nextSettings, t('שינוי גודל גופן בקיצור מקלדת'));
            return;
          }
          if (key === 'c' && e.altKey && e.shiftKey) {
            e.preventDefault();
            autoCenterRef.current();
            return;
          }
        }
        if (isTextInput) return;
        if (key === 'n') {
          e.preventDefault();
          handleRequestNewProject();
        } else if (key === 'o') {
          e.preventDefault();
          handleRequestOpenDocx();
        }
        return;
      }

      if (isTextInput) return;

      // v0.7.0 Part 2 (M4) — V selection tool. T arms the text-frame
      // tool (v0.8.0 merge, task §3): no 'type' button in the toolbar
      // (Part B), but the T shortcut sets the internal 'type' tool so a
      // drag on empty page space draws a text frame via Part E's
      // handleDrawTextFrame flow; if a unit is selected, T also starts
      // editing it, as before.
      if (e.key === 'v' || e.key === 'V') {
        setActiveTool('select');
        return;
      }
      if (e.key === 't' || e.key === 'T') {
        setActiveTool('type');
        if (selectedUnitId) setEditingUnitId(selectedUnitId);
        return;
      }

      if (e.key === 'PageDown') {
        e.preventDefault();
        setCurrentPageIndex(prev => Math.min(totalPages - 1, prev + 1));
      } else if (e.key === 'PageUp') {
        e.preventDefault();
        setCurrentPageIndex(prev => Math.max(0, prev - 1));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    handleUndo,
    handleRedo,
    handleSaveProjectFile,
    handleRequestNewProject,
    handleRequestOpenDocx,
    totalPages,
    // v0.7.0 Part 2 (M4) — InDesign shortcuts read these live.
    selectedUnit,
    selectedUnitId,
    designSettings,
    handleUpdateDesignSettings,
  ]);

  const canUndo = useMemo(() => {
    void historyVersion;
    return historyManagerRef.current?.canUndo() ?? false;
  }, [historyVersion]);

  const canRedo = useMemo(() => {
    void historyVersion;
    return historyManagerRef.current?.canRedo() ?? false;
  }, [historyVersion]);

  // v0.5.0 Part C (Module 8): in-page editing shortcuts — Ctrl+F find/replace,
  // Ctrl+B/I inside the edited block, Ctrl+A select-all in the active block,
  // Esc blur-to-commit. Ctrl+Z/Y stay with App's global handler above (same
  // 500-step history); this hook does NOT take them over (takeOverUndoRedo
  // left false), so no undo happens twice. Placed after canUndo/canRedo
  // because the hook reads them on every render.
  useEditingShortcuts({
    enabled: activeWorkMode === 'edit',
    canUndo,
    canRedo,
    onUndo: handleUndo,
    onRedo: handleRedo,
    onOpenFindReplace: () => setIsSearchOpen(true),
    getActiveEditableElement: () =>
      document.querySelector<HTMLElement>('[data-keter-inline-editor]'),
  });

  const undoLabel = useMemo(() => {
    void historyVersion;
    return historyManagerRef.current?.getLastUndoLabel();
  }, [historyVersion]);

  const redoLabel = useMemo(() => {
    void historyVersion;
    return historyManagerRef.current?.getLastRedoLabel();
  }, [historyVersion]);

  // Handle Layout Switcher (Strictly non-destructive to user's source content and title)
  const handleLayoutTypeChange = (newLayout: BookLayoutType) => {
    lastActionLabelRef.current = {
      label: `שינוי תבנית עימוד (${newLayout})`,
      key: 'layout-type',
      coalesce: false,
    };
    // v0.8.0 Part C (§8): preset switch is a transaction — reset
    // per-mode state (Shas keep-together overrides, drag-split break
    // instructions, per-page custom-layout overrides, selection) before
    // the new layout is applied; force-breaks carry over (valid in every
    // layout). Pagination re-derives from the new layout, so no stale
    // frame geometry survives.
    const plan = planLayoutSwitch({
      prevLayout: layoutType,
      nextLayout: newLayout,
      localOverrides,
      breakInstructions,
      hasCustomPageOverrides:
        Object.keys(designSettings.pageLayout.customLayout?.pageOverrides ?? {}).length > 0,
      selectedUnitId,
      editingUnitId,
    });
    setLocalOverrides(plan.nextLocalOverrides);
    setBreakInstructions(plan.nextBreakInstructions);
    setLayoutType(newLayout);
    setDesignSettings(prev => {
      const updated = DesignSettingsEngine.updateLayoutSettings(
        prev,
        { layoutType: newLayout },
        'user'
      );
      return plan.clearCustomPageOverrides
        ? DesignSettingsEngine.clearAllCustomLayoutPageOverrides(updated, 'user').settings
        : updated;
    });
    if (plan.clearSelection) {
      setSelectedUnitId(null);
      setEditingUnitId(null);
    }
    setCurrentPageIndex(0);
    // v0.8.0 merge decision (Part C §8 wins over Part E #66): a preset
    // switch is a TRANSACTION. planLayoutSwitch already dropped the
    // Shas keep-together overrides, break instructions and per-page
    // custom-layout overrides above and carried the force-breaks; user
    // CONTENT (units, layout-independent boxes) is preserved, but no
    // mode-specific geometry/breaks/overrides survive the switch.
    if (plan.report.length > 0) {
      showToast(`${t('מעבר תבנית')}: ${(lang === 'en' ? plan.reportEn : plan.report).join(' · ')}`, 'success');
    }
  };

  // ── v0.9.0 Part B — Manuscript & Custom Layout Designer ──────────────
  // Historical layout library + .keter-template.json import/export.
  // PART B'S REGION ONLY — Part C also edits App.tsx; keep Part B's
  // handlers inside this delimited block. Every apply runs the same
  // transactional preset switch as handleLayoutTypeChange (per-mode state
  // is reset, force-breaks carry over); the recipe is then layered on
  // top with applyRecipeToSettings.
  // ─────────────────────────────────────────────────────────────────────

  /** Shared transactional apply for one recipe (library or imported). */
  const applyRecipeTransactionally = (recipe: LayoutRecipe, summaryHe: string) => {
    // Merge note: Part A's engine always applies a recipe as a custom
    // layout (the recipe's regions become the boxes; baseLayout is only
    // the fallback solver for pages without boxes), so the transaction
    // targets 'custom_layout' — never the recipe's baseLayout alone.
    const targetLayout: BookLayoutType = 'custom_layout';
    lastActionLabelRef.current = {
      label: `${t('החלת תבנית')} (${recipe.metadata.id})`,
      key: 'apply-layout-recipe',
      coalesce: false,
    };
    const plan = planLayoutSwitch({
      prevLayout: layoutType,
      nextLayout: targetLayout,
      localOverrides,
      breakInstructions,
      hasCustomPageOverrides:
        Object.keys(designSettings.pageLayout.customLayout?.pageOverrides ?? {}).length > 0,
      selectedUnitId,
      editingUnitId,
    });
    setLocalOverrides(plan.nextLocalOverrides);
    setBreakInstructions(plan.nextBreakInstructions);
    setLayoutType(targetLayout);
    setDesignSettings(prev => {
      const switched = DesignSettingsEngine.updateLayoutSettings(
        prev,
        { layoutType: targetLayout },
        'user'
      );
      const appliedBase = applyRecipeToSettings(recipe, switched);
      // v0.9.9 — one recipe, one result: a LIBRARY recipe applied here
      // (header / panel picker) gets the same per-genre typography as
      // the same recipe applied by id at import. An imported
      // .keter-template (not a library recipe) skips the genre layer.
      const applied = resolveHistoricalRecipe(recipe.metadata.id)
        ? applyGenreTypography(recipe.metadata.id, appliedBase)
        : appliedBase;
      // Per-page custom-layout overrides belong to the old pagination;
      // the transaction drops them (a recipe's own frames arrive with
      // empty pageOverrides, so this is a no-op for framed recipes).
      return plan.clearCustomPageOverrides
        ? DesignSettingsEngine.clearAllCustomLayoutPageOverrides(applied, 'user').settings
        : applied;
    });
    if (plan.clearSelection) {
      setSelectedUnitId(null);
      setEditingUnitId(null);
    }
    setCurrentPageIndex(0);
    showToast([summaryHe, ...(lang === 'en' ? plan.reportEn : plan.report)].join(' · '), 'success');
  };

  /** Apply one historical library recipe by id (header / panel pickers). */
  const handleApplyHistoricalRecipe = (recipeId: string) => {
    const recipe = getRecipeById(recipeId);
    if (!recipe) {
      showToast(t('התבנית ההיסטורית לא נמצאה.'), 'error');
      return;
    }
    applyRecipeTransactionally(
      recipe,
      `${t('הוחלה תבנית היסטורית')}: ${lang === 'en' ? recipe.metadata.name : (recipe.metadata.nameHe ?? recipe.metadata.name)}`
    );
  };

  /** Apply an already-parsed recipe (template import path). */
  const handleApplyTemplateRecipe = (recipe: LayoutRecipe) => {
    const errors = validateRecipe(recipe);
    if (errors.length > 0) {
      showToast(`${t('התבנית אינה תקינה:')} ${errors.join(' ')}`, 'error');
      return;
    }
    applyRecipeTransactionally(recipe, `${t('התבנית הוחלה')}: ${lang === 'en' ? recipe.metadata.name : (recipe.metadata.nameHe ?? recipe.metadata.name)}`);
  };

  /** Export the current book as a `.keter-template.json` file (same
   *  anchor-download mechanism as the PDF/IDML exports). */
  const handleExportTemplateRecipe = () => {
    const title = documentTitle.trim() || 'Custom template';
    const recipe = recipeFromSettings(designSettings, {
      id: 'custom-template',
      name: title,
      nameHe: documentTitle.trim() || undefined,
      description: 'Custom layout exported from Keter Typesetter.',
      genre: ['custom'],
      origin: 'Keter Typesetter',
    });
    const blob = new Blob([serializeRecipe(recipe)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(documentTitle.trim() || 'keter_template').replace(/[\\/:*?"<>|]/g, '_')}${KETER_TEMPLATE_EXTENSION}`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(t('התבנית יוצאה כקובץ keter-template.json.'), 'success');
  };

  /** Import a `.keter-template.json` file: validate first (an invalid
   *  file changes nothing — its errors are the toast), then apply. */
  const handleImportTemplateFile = async (file: File) => {
    let text: string;
    try {
      text = await file.text();
    } catch {
      showToast(t('לא הצלחנו לקרוא את הקובץ — נסו שוב.'), 'error');
      return;
    }
    let recipe: LayoutRecipe;
    try {
      recipe = deserializeRecipe(text);
    } catch (e) {
      showToast(`${t('הקובץ אינו תבנית תקינה:')} ${e instanceof Error ? e.message : String(e)}`, 'error');
      return;
    }
    handleApplyTemplateRecipe(recipe);
  };

  // ── end v0.9.0 Part B ─────────────────────────────────────────────────

  // Handle Save from Content Editor
  const handleSaveCustomContent = (
    newUnits: ContentUnit[],
    newTitle: string,
    suggestedLayout?: BookLayoutType
  ) => {
    lastActionLabelRef.current = {
      label: `עריכת תוכן: ${newTitle}`,
      key: 'content-editor-save',
      coalesce: false,
    };
    setContentUnits(newUnits);
    setDocumentTitle(newTitle);
    if (suggestedLayout && suggestedLayout !== layoutType) {
      setLayoutType(suggestedLayout);
      setDesignSettings(prev =>
        DesignSettingsEngine.updateLayoutSettings(prev, { layoutType: suggestedLayout }, 'user')
      );
    }
    // Prune links whose units were explicitly deleted, while preserving all valid links
    const validIds = new Set(newUnits.map(u => u.id));
    setRavTextLinks(prev =>
      prev.filter(l => validIds.has(l.sourceUnitId) && validIds.has(l.commentaryUnitId))
    );
    setCurrentPageIndex(0);
    showToast(t("התוכן עודכן והספר עומד מחדש בהצלחה!"), 'success');
  };

  // Export PDF. First try the local Chromium service (Vite dev server
  // only — the /__keter/chromium-pdf endpoint does not exist in the
  // installed Electron app, which loads dist/index.html from disk with no
  // web server). When it is unavailable, fall back to the built-in offline
  // jsPDF exporter (print-ready: bleed + crop marks, cover/TOC options are
  // honoured there via ExportWorkspaceView's print PDF). Returns true only
  // when a file was actually downloaded, so the export view does not show
  // a success notice after a failure.
  const handleExportPdf = async (allPages: boolean = true, customFileName?: string): Promise<boolean> => {
    setIsExportingPdf(true);
    // v0.6.0 (Part B): export what is on screen — manual page breaks
    // included. The old code exported `bookDoc.pages`, so a split never
    // reached the PDF even though the canvas showed it.
    const pagesToExport = allPages ? displayPages : [activePage];
    setExportProgress({ current: 1, total: pagesToExport.length });
    const filename = customFileName
      ? (customFileName.toLowerCase().endsWith('.pdf') ? customFileName : `${customFileName}.pdf`)
      : allPages
        ? `${documentTitle.replace(/\s+/g, '_')}_ספר_מלא_${totalPages}_עמודים.pdf`
        : `${documentTitle.replace(/\s+/g, '_')}_דף_${activePage?.pageNumberHebrew ?? '1'}.pdf`;
    const downloadBlob = (blob: Blob, name: string) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    // v0.9.9 — the Chromium endpoint is Vite-dev-server only: it does
    // not exist in the installed Electron app, so every installed-app
    // export used to try a dead fetch first. Gate it to dev and go
    // straight to the built-in jsPDF exporter in the built app.
    const chromiumAvailable = import.meta.env.DEV;
    try {
      if (chromiumAvailable) try {
        const response = await fetch('/__keter/chromium-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pages: pagesToExport.map(page => ({
              geometry: page.geometry,
              plan: PdfExporter.buildPageRenderPlan(page),
            })),
          }),
        });
        if (response.ok) {
          downloadBlob(await response.blob(), filename);
          showToast(
            tf('קובץ PDF הופק באמצעות Chromium ({pages})!', { pages: allPages ? tf('{count} עמודים', { count: totalPages }) : t('עמוד 1') }),
            'success'
          );
          setHasExported(true);
          return true;
        }
        // Non-OK (e.g. 404): fall through to the built-in exporter
        // instead of failing the export.
      } catch {
        // Dev server unreachable: fall through.
      }

      const blob = await PdfExporter.generateMultiPagePdf(
        displayBookDoc,
        (current, total) => setExportProgress({ current, total }),
        {
          purpose: 'print',
          pageRange: allPages ? null : { from: safePageIndex + 1, to: safePageIndex + 1 },
        }
      );
      downloadBlob(blob, filename);
      showToast(
        t("קובץ PDF הופק באמצעות המייצא המובנה (שרת Chromium לא זמין באפליקציה המותקנת)"),
        'success'
      );
      setHasExported(true);
      return true;
    } catch (err: any) {
      showToast(t("שגיאה בהפקת PDF: ") + (err.message || err), 'error');
      return false;
    } finally {
      setIsExportingPdf(false);
      setExportProgress(null);
    }
  };

  // Export IDML Trigger
  const handleExportIdml = async (
    stage:
      | 'test_a_minimal'
      | 'test_b_styled_lines'
      | 'test_c_rav_text'
      | 'test_d_multi_page'
      | 'test_e_full'
      | 'test_f_true_rav_text_flow' = 'test_f_true_rav_text_flow',
    customFileName?: string
  ) => {
    try {
      const blob =
        stage === 'test_e_full' || stage === 'test_f_true_rav_text_flow'
          ? await IdmlExporter.generateMultiPageIdml(displayBookDoc)
          : await IdmlExporter.generateIncrementalStageIdml(displayBookDoc, stage);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const suffix =
        stage === 'test_a_minimal'
          ? 'TEST_A_Minimal_Berakhot'
          : stage === 'test_f_true_rav_text_flow'
          // v0.8.0 Part E: this is the production export path (the
          // default), so its filename must not leak the internal test
          // stage name — TEST_* suffixes stay only on explicit test
          // stages A–E.
          ? 'InDesign'
          : `${stage}_InDesign`;
      a.download = customFileName
        ? (customFileName.toLowerCase().endsWith('.idml') ? customFileName : `${customFileName}.idml`)
        : `${documentTitle.replace(/\s+/g, '_')}_${suffix}.idml`;
      a.click();
      URL.revokeObjectURL(url);

      showToast(
        stage === 'test_a_minimal'
          ? t("קובץ IDML מינימלי ידוע-כתקין (TEST A — מסכת ברכות) הופק בהצלחה!")
          : totalPages === 1
            ? tf('קובץ IDML זרימת רב-טקסט אמיתית ל-Adobe InDesign ({count} עמוד) הופק בהצלחה!', { count: totalPages })
            : tf('קובץ IDML זרימת רב-טקסט אמיתית ל-Adobe InDesign ({count} עמודים) הופק בהצלחה!', { count: totalPages }),
        'success'
      );
      setHasExported(true);
    } catch (err: any) {
      showToast(t("שגיאה בהפקת IDML: ") + (err.message || err), 'error');
    }
  };

  // Handle AI Adjustment Approval
  // v0.3.0: Hebrew search / replace / proofing handlers (go through
  // setContentUnits so fixes join the normal undo history).
  const handleSearch = useCallback(
    (q: string, o: SearchOptions) => searchUnits(contentUnits, q, o),
    [contentUnits]
  );

  const handleJumpToHit = useCallback(
    (hit: SearchHit) => {
      if (!hit.unitId) return;
      // v0.6.0 (Part B): jump within the displayed pages — after a manual
      // split the unit may sit on a different page than in `bookDoc`.
      const pageIdx = displayPages.findIndex(pg =>
        [
          ...pg.sourceLines,
          ...pg.rashiLines,
          ...pg.tosafotLines,
          ...pg.footnoteLines,
          ...(pg.column2Lines ?? []),
          ...(pg.sideNoteLines ?? []),
          // v0.8.0 Part C (§1): tertiary-band lines are searchable too.
          ...(pg.tertiaryLines ?? []),
        ].some(
          l => l.unitId === hit.unitId || l.words.some(w => w.unitId === hit.unitId)
        )
      );
      if (pageIdx >= 0) setCurrentPageIndex(pageIdx);
    },
    [displayPages]
  );

  const handleReplaceAll = useCallback(
    (q: string, r: string, o: SearchOptions) => {
      const { units, totalReplaced } = replaceInUnits(contentUnits, q, r, o);
      if (totalReplaced > 0) setContentUnits(units);
      return totalReplaced;
    },
    [contentUnits]
  );

  const handleReplaceOne = useCallback(
    (hit: SearchHit, r: string, o: SearchOptions) => {
      if (!hit.unitId || hit.unitIndex === undefined) return;
      const unit = contentUnits[hit.unitIndex];
      if (!unit || unit.id !== hit.unitId) return;
      // The panel does not pass the query back; recover the matched word
      // from the hit offsets so nikud is preserved on the replacement.
      const matched = unit.rawText.slice(hit.start, hit.end) || unit.rawText.slice(hit.coreStart ?? hit.start, hit.end);
      const { text } = replacePreservingNikud(unit.rawText, matched, r, o);
      setContentUnits(contentUnits.map(u => (u.id === hit.unitId ? { ...u, rawText: text } : u)));
    },
    [contentUnits]
  );

  const handleFixIssue = useCallback((issue: TextIssue) => {
    if (!issue.unitId) return;
    setContentUnits(units =>
      units.map(u => (u.id === issue.unitId ? { ...u, rawText: applyFix(u.rawText, issue) } : u))
    );
  }, []);

  const handleFixGroup = useCallback(
    (kind: TextIssueKind) => {
      const byUnit = new Map<string, TextIssue[]>();
      for (const i of textIssues.filter(x => x.kind === kind && x.unitId)) {
        const arr = byUnit.get(i.unitId!) ?? [];
        arr.push(i);
        byUnit.set(i.unitId!, arr);
      }
      setContentUnits(units =>
        units.map(u => {
          const list = byUnit.get(u.id);
          return list ? { ...u, rawText: applyFixes(u.rawText, list) } : u;
        })
      );
      showToast(t("תיקוני ההגהה הוחלו"), 'success');
    },
    [textIssues, showToast]
  );

  // v0.3.0: QA fix list — widow/balance issues are handled by the
  // whole-book balancing post-pass (re-run it); the rest need a manual fix.
  const handleApplyQaFix = useCallback(
    (issue: { category: string; autoFixable?: boolean }) => {
      // v0.4.0 — the balancing pass already runs on every pagination and is
      // deterministic, so "re-running" it cannot fix anything new. Report
      // what it actually did on the current pages instead of claiming a fix.
      // Other QA categories (collision, clipping, footnote placement, …)
      // have no automatic layout fix in the app: saying "applied" would be
      // a lie, so they now say so plainly.
      if (issue.category === 'widow_orphan' || issue.category === 'balance' || issue.category === 'whitespace') {
        const report = computeBalanceReport();
        const fixed = report.widowsFixed + report.orphansFixed + report.columnsBalanced;
        if (fixed > 0) {
          showToast(
            `${t('האיזון תיקן:')} ${report.widowsFixed} ${report.widowsFixed === 1 ? t('אלמנה') : t('אלמנות')}, ${report.orphansFixed} ${report.orphansFixed === 1 ? t('יתום') : t('יתומים')}, ${report.columnsBalanced} ${report.columnsBalanced === 1 ? t('טור אוזן') : t('טורים אוזנו')}`,
            'success'
          );
        } else {
          showToast(t('האיזון כבר הוחל — לא נמצאה בעיית איזון שניתן לתקן אוטומטית'), 'success');
        }
      } else {
        showToast(t('לתיקון זה אין תיקון אוטומטי — נדרש תיקון ידני בטקסט או בעיצוב'), 'error');
      }
    },
    [computeBalanceReport, showToast]
  );

  // v0.3.0: drag page split — record a break instruction anchored to the
  // first word of the line that should move.
  // v0.6.0 (Part B): the canvas now reports the EXACT unit-global word
  // index of the dragged line (from the unit page text map), so the break
  // lands on that line even for a unit spanning pages. The old
  // `lineIndex * 8` guess is only a fallback when the map is unavailable.
  // The anchor is checked eagerly against the paginated book BEFORE the
  // instruction is added: the old code toasted success even when the
  // anchor could not be found and the engine silently skipped the break —
  // which is exactly why the tool looked unresponsive. A repeat drag of
  // the same line replaces the previous instruction instead of stacking
  // duplicates. The instruction joins the snapshot state, so the split is
  // undoable, autosaved and stored in the .keter file.
  const handlePageSplitRequest = useCallback(
    (pageIndex: number, unitId: string, lineIndex: number, wordIndex?: number) => {
      const anchorWordIndex =
        wordIndex !== undefined ? Math.max(0, wordIndex) : Math.max(0, lineIndex * 8);
      const anchor = findBreakAnchor(bookDoc.pages, unitId, anchorWordIndex);
      if (!anchor) {
        showToast(
          t("לא נמצאה השורה לחלוקה — המעבר לא נוסף. נסו לגרור שוב משורה אחרת."),
          'error'
        );
        return;
      }
      const instr = createBreakInstruction(unitId, 'pageEndsBefore', {
        wordIndex: anchorWordIndex,
        note: `גרירת חלוקת עמוד ${pageIndex + 1}`,
      });
      lastActionLabelRef.current = {
        label: t("חלוקת עמוד ידנית"),
        key: `page-split-${instr.id}`,
        coalesce: false,
      };
      setBreakInstructions(prev => [
        ...prev.filter(
          p =>
            !(
              p.anchorUnitId === unitId &&
              p.kind === 'pageEndsBefore' &&
              p.wordIndex === anchorWordIndex
            )
        ),
        instr,
      ]);
      showToast(
        `${t('מעבר עמוד ידני נוסף — התוכן משורה')} ${lineIndex + 1} ${t('יעבור לעמוד הבא')}`,
        'success'
      );
    },
    [showToast, bookDoc]
  );

  // ── v0.9.8 Phase 5: click-to-re-anchor ──────────────────────────────────
  // Flow: overlay ON → click a dibbur word (arms that commentary unit) →
  // click a Main Text word (the new anchor). The link is rebuilt by the
  // pure `reAnchorLink` helper (exact, confidence 1.0 — a user-picked
  // anchor is exact by definition), stamped back onto the units (the
  // commentary carries the new `anchorLink`, the source gains the
  // commentary id for same-page gravity), and merged into the
  // paginator's RavTextLink list the same way the import merge does
  // (higher confidence wins). Re-pagination is the existing `bookDoc`
  // useMemo over `contentUnits` — a FULL re-pagination: the engine has
  // no forward-only re-pagination API (Phase 4's async chunked
  // pagination is preview-only and still re-paginates its chunks), so
  // this is recorded honestly as the smallest correct re-pagination.
  const handleReAnchorDibburPick = useCallback(
    (commentaryUnitId: string) => {
      setReAnchorPendingUnitId(commentaryUnitId);
      showToast(t("בחרו ביטוי במקור כדי לקשר את הדיבור"), 'success');
    },
    [showToast]
  );

  const handleReAnchorCancel = useCallback(() => {
    setReAnchorPendingUnitId(null);
    showToast(t("קישור מחדש בוטל"), 'success');
  }, [showToast]);

  const handleReAnchorTargetPick = useCallback(
    (
      commentaryUnitId: string,
      targetMainNodeId: string,
      targetCharOffset: number
    ) => {
      const commentary = contentUnits.find(u => u.id === commentaryUnitId);
      if (!commentary) return;
      const dibburText =
        commentary.dibburNode?.rawText ?? commentary.dibburHamatchil ?? '';
      const existingLinks = contentUnits
        .map(u => u.anchorLink)
        .filter((a): a is AnchorLink => !!a);
      const nextLinks = reAnchorLink(
        existingLinks,
        commentaryUnitId,
        targetMainNodeId,
        targetCharOffset,
        dibburText
      );
      const link = nextLinks.find(l => l.commentaryUnitId === commentaryUnitId);
      if (!link) return;
      lastActionLabelRef.current = {
        label: t("קישור מחדש של דיבור המתחיל"),
        key: `reanchor-${commentaryUnitId}`,
        coalesce: false,
      };
      setContentUnits(prev => applyReAnchorToUnits(prev, link));
      const converted = anchorLinksToRavTextLinks([link], contentUnits);
      setRavTextLinks(prev => mergeLinkSets(converted, prev));
      setReAnchorPendingUnitId(null);
      showToast(t("הקישור עודכן — הדיבור מקושר כעת לביטוי שבחרתם"), 'success');
    },
    [contentUnits, showToast]
  );

  // ── v0.9.8 Phase 5: push / pull line micro-adjustments ─────────────────
  // Both are one-click anchored break instructions (same mechanism as the
  // drag-to-split handle, so one undo step covers them and they survive
  // save / reload / PDF / IDML). Push uses the existing `oneLineLess`
  // kind; pull uses the new `oneLineMore` kind. The anchor word only
  // has to resolve to the right page — `oneLineLess` moves the page's
  // last line regardless of which word of the page the anchor points
  // to, and `oneLineMore` moves the anchor page's first line onto the
  // previous page — so the anchor is the unit's first word on that
  // page (its page-slice start index, 0 when the map cannot see it).
  const pushPullStreamKeys = [
    'sourceLines',
    'rashiLines',
    'tosafotLines',
    'column2Lines',
    'footnoteLines',
    'sideNoteLines',
  ] as const;

  const handlePushLineToNextPage = useCallback(() => {
    const page = displayPages[safePageIndex];
    if (!page) {
      showToast(t("העמוד ריק"), 'error');
      return;
    }
    // Last line of the last non-empty stream — the same line the
    // engine's `oneLineLess` branch moves. Its anchor is its own first
    // word (unit-global index, so the instruction resolves to THIS
    // page even when the unit started pages earlier).
    let lastLine: TypesetLine | null = null;
    let lastStream = '';
    for (const key of pushPullStreamKeys) {
      const lines = page[key];
      if (lines && lines.length > 0) {
        lastLine = lines[lines.length - 1];
        lastStream = key;
      }
    }
    if (!lastLine) {
      showToast(t("העמוד ריק"), 'error');
      return;
    }
    const anchorWordIndex = unitGlobalWordIndexAcrossPages(
      displayPages,
      safePageIndex,
      lastLine.unitId,
      lastStream,
      lastLine.lineIndex,
      0
    );
    if (anchorWordIndex === null) {
      showToast(t("לא נמצאה השורה לחלוקה — נסו שורה אחרת."), 'error');
      return;
    }
    const unitId = lastLine.unitId;
    const instr = createBreakInstruction(unitId, 'oneLineLess', {
      wordIndex: anchorWordIndex,
      note: `דחיפת שורה מעמוד ${page.pageNumber}`,
    });
    lastActionLabelRef.current = {
      label: t("דחוף שורה לעמוד הבא"),
      key: `push-line-${instr.id}`,
      coalesce: false,
    };
    setBreakInstructions(prev => [
      ...prev.filter(
        p =>
          !(
            p.anchorUnitId === unitId &&
            p.kind === 'oneLineLess' &&
            p.wordIndex === anchorWordIndex
          )
      ),
      instr,
    ]);
    showToast(t("השורה נדחפה לעמוד הבא"), 'success');
  }, [displayPages, safePageIndex, showToast]);

  const handlePullLineToThisPage = useCallback(() => {
    const page = displayPages[safePageIndex];
    const nextPage = displayPages[safePageIndex + 1];
    if (!page || !nextPage) {
      showToast(t("אין עמוד הבא"), 'error');
      return;
    }
    let firstLine: TypesetLine | null = null;
    let firstStream = '';
    for (const key of pushPullStreamKeys) {
      const lines = nextPage[key];
      if (lines && lines.length > 0) {
        firstLine = lines[0];
        firstStream = key;
        break;
      }
    }
    if (!firstLine) {
      showToast(t("העמוד ריק"), 'error');
      return;
    }
    const anchorWordIndex = unitGlobalWordIndexAcrossPages(
      displayPages,
      safePageIndex + 1,
      firstLine.unitId,
      firstStream,
      firstLine.lineIndex,
      0
    );
    if (anchorWordIndex === null) {
      showToast(t("לא נמצאה השורה למשיכה — נסו שורה אחרת."), 'error');
      return;
    }
    // Room check up front (same arithmetic the engine's `oneLineMore`
    // branch uses): refuse with a toast when the page cannot take the
    // line, instead of creating an instruction the engine would skip.
    const contentHeight =
      page.geometry.pageHeight - page.geometry.marginTop - page.geometry.marginBottom;
    let deepestBottom = 0;
    for (const key of pushPullStreamKeys) {
      const lines = page[key];
      if (!lines || lines.length === 0) continue;
      const last = lines[lines.length - 1];
      const bottom = last.yBottom ?? last.yBaseline + (last.descent ?? 0);
      if (bottom > deepestBottom) deepestBottom = bottom;
    }
    const pulledHeight =
      (firstLine.height ?? 0) +
      (firstLine.spaceBeforePt ?? 0) +
      (firstLine.spaceAfterPt ?? 0);
    if (deepestBottom + pulledHeight > contentHeight) {
      showToast(t("אין מקום לשורה נוספת בעמוד זה"), 'error');
      return;
    }
    const unitId = firstLine.unitId;
    const instr = createBreakInstruction(unitId, 'oneLineMore', {
      wordIndex: anchorWordIndex,
      note: `משיכת שורה לעמוד ${page.pageNumber}`,
    });
    lastActionLabelRef.current = {
      label: t("משוך שורה לעמוד זה"),
      key: `pull-line-${instr.id}`,
      coalesce: false,
    };
    setBreakInstructions(prev => [
      ...prev.filter(
        p =>
          !(
            p.anchorUnitId === unitId &&
            p.kind === 'oneLineMore' &&
            p.wordIndex === anchorWordIndex
          )
      ),
      instr,
    ]);
    showToast(t("השורה נמשכה לעמוד זה"), 'success');
  }, [displayPages, safePageIndex, showToast]);

  // v0.6.0 (Part B): GENUINE Auto-Center for the selected block — the block
  // ends up alone on its page, centred horizontally (equal side indents)
  // and vertically (half the free space above and below it). Why this shape:
  // v0.5.0's Auto-Center only averaged the current indents and spacing,
  // and in rav_text / mikraot_gedolot the spacing half never renders —
  // the dynamic-knee solver stacks fixed line heights and never consumes
  // `spaceBeforePt`. So vertical centring needs the block ISOLATED on its
  // own page (`startsNextPage` before it and before the next unit) plus a
  // `spaceBeforePt` push of half the free space, which the break post-pass
  // DOES honour when it re-stacks the moved lines. When the block spans
  // pages or is taller than the text frame, vertical centring is impossible
  // and the handler says so, falling back to horizontal-only centring —
  // never a fake. Settings + break instructions change together, so one
  // undo step covers both.
  const handleAutoCenterSelectedBlock = useCallback(() => {
    const unit = selectedUnit;
    if (!unit || !designSettings) {
      showToast(t("בחרו פסקה בעמוד כדי למרכז אותה"), 'error');
      return;
    }
    // The unit's lines across the whole book (all streams, all pages).
    const streamKeys = [
      'sourceLines',
      'rashiLines',
      'tosafotLines',
      'column2Lines',
      'footnoteLines',
      'sideNoteLines',
      // v0.8.0 Part C (§1): tertiary band.
      'tertiaryLines',
    ] as const;
    const pagesWithUnit: Array<{ pageIndex: number; heightPt: number }> = [];
    for (let p = 0; p < bookDoc.pages.length; p++) {
      const page = bookDoc.pages[p];
      let heightPt = 0;
      let found = false;
      for (const key of streamKeys) {
        const lines = page[key] ?? [];
        for (const line of lines) {
          if (line.unitId === unit.id) {
            found = true;
            heightPt += line.height ?? 0;
          }
        }
      }
      if (found) pagesWithUnit.push({ pageIndex: p, heightPt });
    }
    if (pagesWithUnit.length === 0) {
      showToast(t("הפסקה הנבחרת לא נמצאה בעמודים"), 'error');
      return;
    }
    const horizontalOnly = () => {
      const next = DesignSettingsEngine.autoCenterBlock(
        designSettings,
        { unitId: unit.id },
        'user'
      );
      handleUpdateDesignSettings(next, t("מרכוז הפסקה"));
    };
    if (pagesWithUnit.length > 1) {
      horizontalOnly();
      showToast(t("הפסקה ארוכה מעמוד אחד — מורכזה אופקית בלבד"), 'success');
      return;
    }
    const blockHeightPt = pagesWithUnit[0].heightPt;
    const contentHeightPt =
      geometry.pageHeight - geometry.marginTop - geometry.marginBottom;
    if (blockHeightPt >= contentHeightPt) {
      horizontalOnly();
      showToast(t("הפסקה גבוהה ממסגרת הטקסט — מורכזה אופקית בלבד"), 'success');
      return;
    }
    const { settings, fitsVertically } = DesignSettingsEngine.autoCenterBlockOnPage(
      designSettings,
      { unitId: unit.id, blockHeightPt, contentHeightPt },
      'user'
    );
    // Isolate the block on its own page: it starts a fresh page, and the
    // next unit in the book starts the page after it. Older centring breaks
    // for the same anchors are replaced, not stacked.
    const unitOrderIdx = contentUnits.findIndex(u => u.id === unit.id);
    const nextUnit = unitOrderIdx >= 0 ? contentUnits[unitOrderIdx + 1] : undefined;
    const newInstrs = [
      createBreakInstruction(unit.id, 'startsNextPage', {
        note: 'מרכוז פסקה במרכז העמוד',
      }),
      ...(nextUnit
        ? [
            createBreakInstruction(nextUnit.id, 'startsNextPage', {
              note: 'מרכוז פסקה במרכז העמוד',
            }),
          ]
        : []),
    ];
    setBreakInstructions(prev => [
      ...prev.filter(
        p =>
          !(
            p.kind === 'startsNextPage' &&
            (p.anchorUnitId === unit.id ||
              (nextUnit !== undefined && p.anchorUnitId === nextUnit.id))
          )
      ),
      ...newInstrs,
    ]);
    handleUpdateDesignSettings(settings, t("מרכוז פסקה במרכז העמוד"));
    showToast(
      fitsVertically
        ? t("הפסקה מורכזה במרכז העמוד")
        : t("הפסקה מורכזה אופקית בלבד"),
      'success'
    );
  }, [
    selectedUnit,
    designSettings,
    bookDoc,
    geometry,
    contentUnits,
    handleUpdateDesignSettings,
    showToast,
  ]);

  useEffect(() => {
    autoCenterRef.current = handleAutoCenterSelectedBlock;
  }, [handleAutoCenterSelectedBlock]);

  // v0.3.0: freeze a labelled print version from the current state.
  const handleFreezePrintVersion = useCallback(() => {
    try {
      const label = `גרסת דפוס ${printVersions.length + 1} — ${documentTitle}`;
      const snapshot = UndoRedoHistoryManager.toProjectSnapshot(currentSnapshotState, label);
      ProjectPersistenceEngine.freezePrintVersion(snapshot, label);
      setPrintVersions(ProjectPersistenceEngine.listPrintVersions());
      showToast(t("גרסת הדפוס נשמרה — ניתן להוריד ממנה PDF גם אחרי שינויים"), 'success');
    } catch {
      showToast(t("שמירת גרסת הדפוס נכשלה"), 'error');
    }
  }, [currentSnapshotState, documentTitle, printVersions.length, showToast]);

  // v0.4.0 — the Suggestions button was dead: nothing ever populated
  // `suggestions`, so the panel was permanently empty. It is now fed by
  // the real proofreading findings: one suggestion per unit, fixing all
  // of that unit's auto-fixable issues at once (per-issue suggestions
  // would each carry a stale full-text `after` and overwrite each other
  // on approve). Approved/rejected decisions are kept; pending entries
  // for units with no fixable issues left are dropped.
  useEffect(() => {
    const byUnit = new Map<string, TextIssue[]>();
    for (const issue of textIssues.filter(x => x.unitId && x.autoFixable)) {
      const arr = byUnit.get(issue.unitId!) ?? [];
      arr.push(issue);
      byUnit.set(issue.unitId!, arr);
    }
    if (byUnit.size === 0) return;
    setSuggestions(prev => {
      const seen = new Set(prev.map(x => x.id));
      const next = [...prev];
      for (const [unitId, list] of byUnit) {
        const id = `proof-${unitId}`;
        if (seen.has(id)) continue;
        const unit = contentUnits.find(u => u.id === unitId);
        if (!unit) continue;
        next.push({
          id,
          author: 'הגהה אוטומטית',
          kind: 'text',
          targetUnitId: unitId,
          targetLabel: list.map(x => x.messageHe).slice(0, 2).join('; '),
          before: unit.rawText,
          after: applyFixes(unit.rawText, list),
          status: 'pending',
          createdAt: Date.now(),
        });
      }
      return next.length === prev.length ? prev : next;
    });
  }, [textIssues, contentUnits]);

  // v0.3.0: suggest/approve — proofreader suggestions live in memory and
  // are applied through the normal content-update path (undoable).
  const handleApproveSuggestion = useCallback(
    (id: string) => {
      const sug = suggestions.find(x => x.id === id);
      if (sug && sug.kind === 'text' && sug.targetUnitId) {
        setContentUnits(units =>
          units.map(u => (u.id === sug.targetUnitId ? { ...u, rawText: sug.after } : u))
        );
      }
      setSuggestions(prev => prev.map(x => (x.id === id ? { ...x, status: 'approved' } : x)));
    },
    [suggestions]
  );
  const handleRejectSuggestion = useCallback((id: string) => {
    setSuggestions(prev => prev.map(x => (x.id === id ? { ...x, status: 'rejected' } : x)));
  }, []);

  // v0.3.0: local library folder — user drops their own .docx files;
  // Masechet+Rashi/Tosafot pairs open as a Gemara page (no Otzaria).
  const handleLibraryFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      try {
        const { pairs, unpaired } = detectLibraryPairs(files);
        if (pairs.length === 0) {
          showToast(t("לא נמצאו זוגות מסכת+מפרשים בקבצים שנבחרו"), 'error');
          return;
        }
        const desc = openAsGemaraPage(pairs[0]);
        const allUnits: ContentUnit[] = [];
        const allWarnings: string[] = [];
        for (const f of desc.files) {
          const res = await DocxImporter.importDocx(await f.arrayBuffer(), f.name);
          allUnits.push(...res.units);
          // v0.8.0 Part E: keep validation warnings (dropped images, …).
          for (const w of res.validation.warnings) {
            if (!allWarnings.includes(w)) allWarnings.push(w);
          }
        }
        const links = DocxImporter.autoLinkCommentariesToSource(
          allUnits.filter(u => u.role === 'main_source'),
          allUnits.filter(u => u.role !== 'main_source')
        );
        const snapshot = ProjectPersistenceEngine.createNewProjectSnapshot({
          documentTitle: `מסכת ${desc.masechet} — דף גמרא`,
          layoutType: 'rav_text',
          units: allUnits,
          links,
          selectedFont,
          selectedRashiFont,
          selectedTosafotFont,
          geometry,
        });
        loadProjectSnapshotIntoWorkspace(snapshot, true);
        showToast(
          pairs.length > 1
            ? tf('נפתחו {count} זוגות מהספרייה — הראשון מוצג', { count: pairs.length })
            : t("המסכת נפתחה כדף גמרא"),
          'success'
        );
        // v0.8.0 Part E: surface import warnings (e.g. dropped images).
        if (allWarnings.length > 0) {
          const extra = allWarnings.length > 1 ? ` (+${allWarnings.length - 1})` : '';
          const warningText = `${t("אזהרות יבוא: ")}${allWarnings[0]}${extra}`;
          window.setTimeout(() => showToast(warningText, 'warning'), 4500);
        }
        void unpaired;
      } catch {
        showToast(t("פתיחת הספרייה נכשלה"), 'error');
      }
    },
    [selectedFont, selectedRashiFont, selectedTosafotFont, geometry, showToast]
  );


  // v0.7.0 Part 1 (M2) — Pages Panel operations. Pages are derived from the
  // content units, so reorder/insert/delete all operate on units and then
  // re-paginate; nothing here is a display-only sort.
  const pageUnitIds = useCallback((pageIndex: number): string[] => {
    const page = displayPages[pageIndex];
    if (!page) return [];
    const seen: string[] = [];
    // v0.8.0 Part C (§1): tertiary-band lines belong to their units too.
    for (const l of [...page.sourceLines, ...page.rashiLines, ...page.tosafotLines, ...(page.footnoteLines ?? []), ...(page.column2Lines ?? []), ...(page.tertiaryLines ?? [])]) {
      if (l.unitId && !seen.includes(l.unitId)) seen.push(l.unitId);
    }
    return seen;
  }, [displayPages]);

  const handleReorderPage = useCallback((fromIndex: number, toIndex: number) => {
    const movingIds = pageUnitIds(fromIndex);
    if (movingIds.length === 0 || fromIndex === toIndex) return;
    const targetIds = pageUnitIds(toIndex);
    setContentUnits(prev => reorderPageUnits(prev, movingIds, targetIds, fromIndex, toIndex));
    showToast(t('העמוד הועבר והספר עומד מחדש'), 'success');
  }, [pageUnitIds, showToast, t]);

  const handleInsertPage = useCallback((afterIndex: number) => {
    const afterIds = pageUnitIds(afterIndex);
    const newUnitId = `u-page-${Date.now()}`;
    const newUnit: ContentUnit = {
      id: newUnitId,
      role: 'chapter',
      rawText: 'עמוד חדש',
      styleName: 'Heading 1',
      order: 0,
      hierarchyLevel: 1,
      chapterTitle: 'עמוד חדש',
    };
    setContentUnits(prev => {
      const next = [...prev];
      const anchorIdx = afterIds.length ? next.findIndex(u => u.id === afterIds[afterIds.length - 1]) : next.length - 1;
      next.splice(anchorIdx + 1, 0, { ...newUnit, order: anchorIdx + 1 });
      return next.map((u, i) => ({ ...u, order: i }));
    });
    // Force a real page break before the new heading via the existing local-override mechanism.
    const override: LocalRuleOverride = {
      id: `pb-${newUnitId}`,
      ruleId: 'paragraph.allowContinuationAcrossPages',
      category: 'paragraph',
      enabled: true,
      priority: 'HARD_USER_RULE',
      isHardConstraint: true,
      value: false,
      source: 'local',
      scope: { unitId: newUnitId },
      forcePageBreakBeforeUnitId: newUnitId,
      description: 'עמוד חדש מהלוחות — מעבר עמוד כפוי',
    };
    setLocalOverrides(prev => [...prev, override]);
    setCurrentPageIndex(afterIndex + 1);
    showToast(t('נוסף עמוד חדש'), 'success');
  }, [pageUnitIds, showToast, t]);

  const handleDeletePage = useCallback((pageIndex: number) => {
    const ids = pageUnitIds(pageIndex);
    if (ids.length === 0) return;
    // Only delete units that live entirely on this page; a unit continued
    // from/to another page is kept (deleting it would eat the other page).
    const pagesByUnit = new Map<string, Set<number>>();
    displayPages.forEach((pg, i) => {
      for (const l of [...pg.sourceLines, ...pg.rashiLines, ...pg.tosafotLines, ...(pg.footnoteLines ?? []), ...(pg.column2Lines ?? [])]) {
        if (!l.unitId) continue;
        if (!pagesByUnit.has(l.unitId)) pagesByUnit.set(l.unitId, new Set());
        pagesByUnit.get(l.unitId)!.add(i);
      }
    });
    const deletable = ids.filter(id => (pagesByUnit.get(id)?.size ?? 0) === 1);
    const kept = ids.length - deletable.length;
    if (deletable.length === 0) {
      showToast(t('לא ניתן למחוק עמוד זה — כל היחידות בו ממשיכות לעמודים אחרים'), 'error');
      return;
    }
    setContentUnits(prev => prev.filter(u => !deletable.includes(u.id)));
    if (kept > 0) showToast(tf('העמוד נמחק; {count} יחידות ממשיכות נשמרו', { count: kept }), 'success');
    else showToast(t('העמוד נמחק'), 'success');
  }, [pageUnitIds, displayPages, showToast, t]);
  // v0.7.0 Part 3 (M2) — one-click Shas fixes (re-links + keep-together overrides).
  const handleApplyShasFixes = useCallback(() => {
    const flaws = scanShasFlaws(displayPages, contentUnits, ravTextLinks);
    // v0.8.0 Part C (§3): pass the pages so single-line units are skipped
    // (a one-line unit cannot be a widow/orphan) and only re-links
    // actually performed are counted.
    const result = fixShasFlaws(flaws, contentUnits, ravTextLinks, displayPages);
    if (result.links !== ravTextLinks) setRavTextLinks(result.links);
    if (result.overrides.length > 0) setLocalOverrides(prev => [...prev, ...result.overrides]);
    showToast(
      result.fixedCount > 0
        ? tf('תוקנו {fixed} פגמי ש״ס', { fixed: result.fixedCount }) + (result.skippedCount > 0 ? tf('; {skipped} דורשים טיפול ידני', { skipped: result.skippedCount }) : '')
        : t('לא נמצאו פגמים הניתנים לתיקון אוטומטי'),
      result.fixedCount > 0 ? 'success' : 'error'
    );
  }, [displayPages, contentUnits, ravTextLinks, showToast, t]);

  const handleApplyVilnaDefaults = useCallback(() => {
    handleUpdateDesignSettings(applyVilnaShasDefaults(designSettings), t('הוחלו כללי וילנא'));
    showToast(t('הוחלו כללי וילנא: כותרת פרק ממורכזת, הזחה בשורה השנייה, דיבור מודגש'), 'success');
  }, [designSettings, handleUpdateDesignSettings, showToast, t]);
  // v0.8.0 Part D — Yiddish defaults (centred parsha headings, justified
  // Yiddish body, no first-line indent).
  const handleApplyYiddishDefaults = useCallback(() => {
    handleUpdateDesignSettings(applyYiddishHeadingDefaults(designSettings), t('הוחלו כללי יידיש'));
    showToast(t('הוחלו כללי יידיש: כותרת פרשה ממורכזת, גוף מיושר ללא הזחה בפתח'), 'success');
  }, [designSettings, handleUpdateDesignSettings, showToast, t]);
  const handleApplyAiAdjustment = (action: string, data: any) => {
    // v0.7.0 Part 3 (M2) — Vilna Shas actions.
    if (action === 'verify_dibbur') {
      const v = verifyDibburHamatchil(contentUnits, ravTextLinks);
      const failed = v.filter(x => !x.ok);
      showToast(
        failed.length === 0
          ? tf('כל {count} דיבורי המתחיל תואמים את הגמרא', { count: v.length })
          : tf('{failed} מתוך {total} דיבורים אינם תואמים — ראה פירוט בלוח בדיקת ש״ס', { failed: failed.length, total: v.length }),
        failed.length === 0 ? 'success' : 'error'
      );
      if (failed.length > 0) setShowShasPanel(true);
      return;
    } else if (action === 'fix_shas_flaws') {
      handleApplyShasFixes();
      return;
    } else if (action === 'apply_vilna_defaults') {
      handleApplyVilnaDefaults();
      return;
    } else if (action === 'move_rashi') {
      const cur = kneeSettings.gutterWidth ?? designSettings.ravText.gutterWidthPt ?? 12;
      const next = Math.max(6, Math.min(36, cur + (data?.closer === false ? 6 : -6)));
      const nextKnee: KneeCustomSettings = { ...kneeSettings, gutterWidth: next };
      setKneeSettings(nextKnee);
      setDesignSettings(prev =>
        DesignSettingsEngine.updateRavTextSettings(prev, { kneeSettings: nextKnee, gutterWidthPt: next }, 'ai')
      );
      showToast(t('רש״י הוזז ביחס לעמודת הגמרא'), 'success');
      return;
    } else if (action === 'expand_tosafot' && typeof data?.widthPct === 'number') {
      const widthPct = Math.max(20, Math.min(40, data.widthPct));
      // v0.8.0 Part C (§2): route through updateTierConfig so the edit
      // syncs forward to the ravText shortcuts and project role styles
      // (a direct tier mutation would be clobbered by the heal step and
      // would not move the knee solver). The tier widths now drive the
      // knee flank split and the bottom-commentary split, so the widening
      // is visible in the render.
      let base = designSettings;
      let tiers = base.pageLayout.tiers ?? [];
      if (
        !tiers.some(tier => tier.role === 'secondary_comment') ||
        !tiers.some(tier => tier.role === 'main_source')
      ) {
        const seeded = DesignSettingsEngine.cloneSettings(base);
        seeded.pageLayout.tiers = DesignSettingsEngine.defaultTiersForLayout(base.layoutType);
        base = seeded;
        tiers = base.pageLayout.tiers ?? [];
      }
      const tos = tiers.find(tier => tier.role === 'secondary_comment');
      const main = tiers.find(tier => tier.role === 'main_source');
      if (!tos || !main || tos.widthPct === undefined || main.widthPct === undefined) {
        showToast(t('לא נמצאו טורי וילנא בעיצוב הנוכחי'), 'error');
        return;
      }
      const delta = widthPct - tos.widthPct;
      const mainWidth = Math.max(30, main.widthPct - delta);
      const afterTos = DesignSettingsEngine.updateTierConfig(base, tos.tierIndex, { widthPct }, 'ai');
      const afterMain = DesignSettingsEngine.updateTierConfig(
        afterTos.settings,
        main.tierIndex,
        { widthPct: mainWidth },
        'ai'
      );
      handleUpdateDesignSettings(afterMain.settings, t('הורחב טור תוספות'));
      showToast(t('טור תוספות הורחב'), 'success');
      return;
    } else if (action === 'verify_folio_sequence') {
      const bad = displayPages.find((pg, i) => i > 0 && pg.pageNumber !== displayPages[i - 1].pageNumber + 1);
      const sample = displayPages.slice(0, 3).map(pg => `${pg.pageNumberHebrew} (${layoutType === 'rav_text' ? folioLatinTalmud(pg.pageNumber) : folioLatin(pg.pageNumber)})`).join(', ');
      showToast(bad ? tf('רצף הדפים שבור בעמוד {page}', { page: bad.pageNumber }) : tf('רצף הדפים תקין: {sample}', { sample }), bad ? 'error' : 'success');
      return;
    } else if (action === 'check_footer_alignment') {
      let misaligned = 0;
      for (const pg of displayPages) {
        const xs = new Set(pg.footnoteLines.map(l => l.xStart));
        if (xs.size > 1) misaligned += 1;
      }
      showToast(
        misaligned === 0 ? t('הערות השוליים מיושרות בכל הדפים') : tf('{count} עמודים עם הערות שוליים לא מיושרות', { count: misaligned }),
        misaligned === 0 ? 'success' : 'error'
      );
      return;
    } else if (action === 'toggle_michtav') {
      // v0.8.0 Part C (§7): show/hide the decorative Michtav box above
      // the Gemara text on the first Vilna page.
      const enabled = data?.enabled !== false;
      const next = DesignSettingsEngine.updateRavTextSettings(
        designSettings,
        {
          michtavEnabled: enabled,
          ...(typeof data?.text === 'string' ? { michtavText: data.text } : {}),
        },
        'ai'
      );
      handleUpdateDesignSettings(next, enabled ? t('תיבת מכתב הוצגה') : t('תיבת מכתב הוסתרה'));
      showToast(
        enabled ? t('תיבת מכתב מוצגת בראש העמוד הראשון') : t('תיבת מכתב הוסתרה'),
        'success'
      );
      return;
    } else if (action === 'apply_yiddish_defaults') {
      // v0.8.0 Part D — Yiddish sefarim actions.
      handleApplyYiddishDefaults();
      return;
    } else if (action === 'verify_yiddish_folio') {
      const check = verifyYiddishFolios(displayPages);
      showToast(
        check.ok
          ? tf('רצף הדפים היידיש תקין: {count} עמודים', { count: check.checked })
          : tf('רצף הדפים היידיש שבור בעמודים: {pages}', { pages: check.badPages.join(', ') }),
        check.ok ? 'success' : 'error'
      );
      return;
    } else if (action === 'classify_yiddish_tiers') {
      const result = reclassifyYiddishUnits(contentUnits);
      if (result.changed > 0) {
        lastActionLabelRef.current = {
          label: 'סיווג יחידות יידיש',
          key: 'classify-yiddish',
          coalesce: false,
        };
        setContentUnits(result.units);
        setCurrentPageIndex(0);
      }
      showToast(
        result.changed === 0
          ? t('לא נמצאו יחידות יידיש חדשות לסיווג')
          : tf('{count} יחידות סווגו כיידיש', { count: result.changed }),
        result.changed === 0 ? 'error' : 'success'
      );
      return;
    } else if (action === 'applyHistoricalLayout' || action === 'applyRecipe') {
      // v0.9.0 Part C — historical layout recipes (approval card in the
      // AI panel). A templateId names a loaded .keter-template (Part A's
      // engine); no template store exists in this tree yet, so an unknown
      // templateId is refused, never guessed.
      if (typeof data?.templateId === 'string' && typeof data?.recipeId !== 'string') {
        showToast(tf('התבנית {id} אינה טעונה — טעינת תבניות .keter-template עדיין אינה זמינה בגרסה זו', { id: data.templateId }), 'error');
        return;
      }
      const recipe = typeof data?.recipeId === 'string' ? getRecipeByIdLocal(data.recipeId) : undefined;
      if (!recipe) {
        showToast(t('לא נמצאה תבנית עימוד בשם הזה'), 'error');
        return;
      }
      // A recipe change is a preset switch: run the same transaction as
      // the layout switcher (drop per-mode overrides/breaks), then apply
      // the recipe's preset + typographic rules on top.
      const plan = planLayoutSwitch({
        prevLayout: layoutType,
        // v0.9.9 — the transaction target is 'custom_layout' (the
        // recipe lands as boxes); recipe.layoutType is now the recipe's
        // REAL base layout (the fallback solver), not the target.
        nextLayout: 'custom_layout',
        localOverrides,
        breakInstructions,
        hasCustomPageOverrides:
          Object.keys(designSettings.pageLayout.customLayout?.pageOverrides ?? {}).length > 0,
        selectedUnitId,
        editingUnitId,
      });
      setLocalOverrides(plan.nextLocalOverrides);
      setBreakInstructions(plan.nextBreakInstructions);
      let nextSettings = applyRecipeToSettingsById(recipe.id, designSettings);
      if (plan.clearCustomPageOverrides) {
        nextSettings = DesignSettingsEngine.clearAllCustomLayoutPageOverrides(nextSettings, 'ai').settings;
      }
      if (plan.clearSelection) {
        setSelectedUnitId(null);
        setEditingUnitId(null);
      }
      setCurrentPageIndex(0);
      handleUpdateDesignSettings(nextSettings, tf('הוחלה תבנית {name}', { name: lang === 'en' ? recipe.nameEn : recipe.nameHe }));
      setAutoLayoutNotice({
        lineHe: `עומד כ${recipe.nameHe} — ${recipe.summaryHe}`,
        lineEn: `Laid out as ${recipe.nameEn} — ${recipe.summaryEn}`,
        recipeId: recipe.id,
        isFallback: false,
      });
      showToast(tf('הוחלה תבנית {name}', { name: lang === 'en' ? recipe.nameEn : recipe.nameHe }), 'success');
      return;
    } else if (action === 'explainRecipe') {
      // v0.9.0 Part C — explain a recipe (or the current layout when no
      // recipe is named). Text-only reply; nothing is changed.
      const recipe =
        (typeof data?.recipeId === 'string' ? getRecipeByIdLocal(data.recipeId) : undefined) ??
        getRecipeByIdLocal(
          layoutType === 'rav_text' ? 'vilna-shas'
            : layoutType === 'mikraot_gedolot' ? 'mikraot-gedolot'
            : layoutType === 'two_column' ? 'shulchan-aruch'
            : layoutType === 'yiddish_sefer' ? 'yiddish-sefer'
            : layoutType === 'source_top_commentary_bottom' ? 'machon-edition'
            : 'single-column'
        );
      showToast(
        recipe ? tf('תבנית {name}: {summary} כללים: {rules}', { name: lang === 'en' ? recipe.nameEn : recipe.nameHe, summary: lang === 'en' ? recipe.summaryEn : recipe.summaryHe, rules: recipe.rules.join('; ') }) : t('לא נמצאה תבנית להסבר'),
        recipe ? 'success' : 'error'
      );
      return;
    } else if (action === 'changeLayout') {
      // v0.9.0 Part C — open the layout picker: re-show the auto-layout
      // banner with the layout selector (the header switcher changes the
      // layout directly; the banner lets the user pick + apply).
      setAutoLayoutChangeTarget(layoutType);
      setAutoLayoutNotice({
        lineHe: t('בחרו תבנית עימוד אחרת למסמך זה:'),
        lineEn: 'Choose another layout for this document:',
        recipeId: '',
        isFallback: false,
      });
      return;
    } else if (action === 'fix_geometry_flaws') {
      // v0.9.0 Part C — corrective geometry shifts from the extended flaw
      // scan: widen the gutter for text overlaps, shift the knee junction
      // for misaligned knees. Shifts are summed and capped in
      // fixGeometryFlaws; pagination errors are reported, not shifted.
      const { flaws, shifts } = QaEngine.scanGeometryFlaws(displayPages, contentUnits, ravTextLinks);
      if (flaws.length === 0) {
        showToast(t('לא נמצאו פגמי גאומטריה (חפיפות, ברכיים, עימוד)'), 'success');
        return;
      }
      if (shifts.fixedCount === 0 || (shifts.gutterDeltaPt === 0 && shifts.kneeJunctionDeltaPct === 0)) {
        showToast(
          tf('{count} פגמי גאומטריה נמצאו, אך אף אחד מהם אינו ניתן לתיקון אוטומטי — יש לטפל בהם ידנית', { count: flaws.length }),
          'error'
        );
        return;
      }
      const next = DesignSettingsEngine.updateRavTextSettings(
        designSettings,
        {
          ...(shifts.gutterDeltaPt !== 0
            ? { gutterWidthPt: Math.max(6, Math.min(36, (designSettings.ravText.gutterWidthPt ?? 12) + shifts.gutterDeltaPt)) }
            : {}),
          ...(shifts.kneeJunctionDeltaPct !== 0
            ? { kneeJunctionPercent: Math.max(20, Math.min(80, (designSettings.ravText.kneeJunctionPercent ?? 50) + shifts.kneeJunctionDeltaPct)) }
            : {}),
        },
        'ai'
      );
      handleUpdateDesignSettings(next, t('תוקנו פגמי גאומטריה'));
      showToast(
        tf('תוקנו {count} פגמי גאומטריה', { count: shifts.fixedCount }) +
          (shifts.skippedCount > 0 ? tf('; {skipped} דורשים טיפול ידני', { skipped: shifts.skippedCount }) : ''),
        'success'
      );
      return;
    }
    if (action === 'balance_book') {
      // v0.4.0: the balancing post-pass already runs on every pagination
      // and is deterministic — bumping balanceNonce recomputed identical
      // pages and the old toast claimed a success it did not produce.
      // Report the pass's real numbers on the current pages instead.
      const report = computeBalanceReport();
      const fixed = report.widowsFixed + report.orphansFixed + report.columnsBalanced;
      if (fixed > 0) {
        showToast(
          `${t('האיזון תיקן:')} ${report.widowsFixed} ${report.widowsFixed === 1 ? t('אלמנה') : t('אלמנות')}, ${report.orphansFixed} ${report.orphansFixed === 1 ? t('יתום') : t('יתומים')}, ${report.columnsBalanced} ${report.columnsBalanced === 1 ? t('טור אוזן') : t('טורים אוזנו')}`,
          'success'
        );
      } else {
        showToast(t('הספר כבר מאוזן — לא נמצאו יתומים, אלמנות או טורים לא מאוזנים'), 'success');
      }
    } else if (action === 'request_export') {
      // v0.4.0: AI export never writes a file directly — it opens the
      // export step, where the user picks the format and confirms the
      // download (cover / TOC are options there).
      const format = typeof data?.format === 'string' ? data.format.toUpperCase() : 'PDF';
      setActiveWorkMode('export');
      showToast(`${t('נפתח שלב הייצוא — בחר את הפורמט ואשר את ההורדה שם')} (${format})`, 'success');
    } else if (action === 'undo_last_change') {
      // v0.4.0: undo through the existing history manager.
      handleUndo();
    } else if (action === 'adjust_knee' && data?.kneeJunctionY) {
      const nextKnee: KneeCustomSettings = {
        ...kneeSettings,
        mode: 'manual',
        junctionPercent: Math.round((data.kneeJunctionY / geometry.pageHeight) * 100),
      };
      setKneeSettings(nextKnee);
      setDesignSettings(prev =>
        DesignSettingsEngine.updateRavTextSettings(prev, { kneeSettings: nextKnee }, 'ai')
      );
      setShowKneeGuide(true);
      showToast(t("התאמת הברך הוחלה בהצלחה לפי המלצת AI"), 'success');
    } else if (action === 'search_replace' && data?.find) {
      // v0.3.0: AI-proposed find/replace, approved on the card, undoable.
      const { units, totalReplaced } = replaceInUnits(contentUnits, data.find, data.replace ?? '', {});
      if (totalReplaced > 0) {
        setContentUnits(units);
        showToast(tf('הוחלפו {count} מופעים', { count: totalReplaced }), 'success');
      } else {
        showToast(t("לא נמצאו מופעים להחלפה"), 'error');
      }
    } else if (action === 'fix_marked_pages' || action === 'fix_qa') {
      // v0.3.0: apply every auto-fixable text-proofing issue in the book.
      // v0.4.0: fix_qa (Gemini/local generic "fix" proposal) runs the same
      // safe fixes — it previously had no App branch and did nothing.
      const byUnit = new Map<string, TextIssue[]>();
      for (const i of textIssues.filter(x => x.unitId)) {
        const arr = byUnit.get(i.unitId!) ?? [];
        arr.push(i);
        byUnit.set(i.unitId!, arr);
      }
      // v0.4.0 — count the fixes that will actually be applied BEFORE the
      // state update (applyFixes skips non-auto-fixable issues and
      // overlapping spans, and a setState updater must stay side-effect
      // free — the old code counted inside the updater, which React may
      // run twice and which made the toast number unreliable).
      let fixed = 0;
      for (const list of byUnit.values()) {
        const fixable = list
          .filter(x => x.autoFixable)
          .sort((a, b) => b.offset - a.offset || b.length - a.length);
        const spans: Array<[number, number]> = [];
        for (const issue of fixable) {
          const end = issue.offset + issue.length;
          if (spans.some(([s0, e0]) => issue.offset < e0 && end > s0)) continue;
          spans.push([issue.offset, end]);
          fixed += 1;
        }
      }
      setContentUnits(units =>
        units.map(u => {
          const list = byUnit.get(u.id);
          if (!list) return u;
          return { ...u, rawText: applyFixes(u.rawText, list) };
        })
      );
      if (fixed > 0) {
        showToast(tf('תוקנו {count} ממצאי הגהה', { count: fixed }), 'success');
      } else {
        showToast(t('לא נמצאו ממצאי הגהה שניתן לתקן אוטומטית'), 'error');
      }
    } else if (action === 'adjust_spacing' && data?.gutter) {
      const nextKnee: KneeCustomSettings = {
        ...kneeSettings,
        gutterWidth: data.gutter,
      };
      setKneeSettings(nextKnee);
      setDesignSettings(prev =>
        DesignSettingsEngine.updateRavTextSettings(
          prev,
          { kneeSettings: nextKnee, gutterWidthPt: data.gutter },
          'ai'
        )
      );
      showToast(t("מרווח העמודות (Gutter) עודכן בהצלחה"), 'success');
    }
  };

  // v0.4.0 — command palette entries (checklist §4): every entry calls
  // a real App handler; there are no placeholder entries.
  const paletteCommands: PaletteCommand[] = useMemo(
    () => [
      { id: 'new', label: t('פרויקט חדש…'), hint: 'Ctrl+N', run: handleRequestNewProject },
      { id: 'docx', label: t('ייבוא קובץ Word (DOCX)…'), hint: 'Ctrl+O', run: handleRequestOpenDocx },
      { id: 'open-keter', label: t('פתיחת קובץ פרויקט (.keter)…'), run: handleRequestOpenProjectFile },
      { id: 'save', label: t('שמירת הפרויקט'), hint: 'Ctrl+S', run: () => void handleSaveProjectFile() },
      { id: 'search', label: t('חיפוש והחלפה'), run: () => { setActiveWorkMode('edit'); setIsSearchOpen(true); } },
      { id: 'proof', label: t('הגהה'), run: () => { setActiveWorkMode('edit'); setIsProofingOpen(true); } },
      { id: 'pages', label: t('דפים'), hint: t('מעבר לעמוד'), run: () => { setActiveWorkMode('edit'); setIsNavigatorOpen(true); setNavigatorTab('pages'); } },
      { id: 'export', label: t('מעבר לשלב הייצוא'), run: () => setActiveWorkMode('export') },
      { id: 'design', label: t('פתיחת חלונית העיצוב'), run: () => { setActiveWorkMode('edit'); setRightDrawerMode('design'); } },
      { id: 'ai', label: t('פתיחת עוזר ה-AI'), run: () => { setActiveWorkMode('edit'); setRightDrawerMode('ai'); } },
      { id: 'undo', label: t('ביטול השינוי האחרון'), hint: 'Ctrl+Z', run: handleUndo },
      { id: 'redo', label: t('ביצוע מחדש'), hint: 'Ctrl+Y', run: handleRedo },
      { id: 'home', label: t('מעבר לדף הבית'), run: () => setActiveWorkMode('home') },
      { id: 'welcome', label: t('איך משתמשים — מדריך פתיחה'), run: () => setIsWelcomeOpen(true) },
    ],
    [handleRequestNewProject, handleRequestOpenDocx, handleRequestOpenProjectFile, handleSaveProjectFile, handleUndo, handleRedo, lang]
  );

  // Helper to toggle on-demand right drawer ('design' | 'ai')
  const toggleRightDrawer = (mode: 'design' | 'ai', tab?: InspectorMainTab) => {
    if (tab) {
      setInspectorMainTab(tab);
    }
    if (rightDrawerMode === mode && !tab) {
      setRightDrawerMode(null);
    } else {
      setRightDrawerMode(mode);
    }
  };

  const handleDiagnosticAction = useCallback((diag: StructuredDiagnostic) => {
    const action = diag.fixAction;
    if (!action) return;
    setActiveWorkMode('edit');
    setShowShasPanel(false);
    const payload = action.payload ?? {};
    if (typeof payload.pageIndex === 'number') {
      setCurrentPageIndex(Math.max(0, Math.min(displayPages.length - 1, payload.pageIndex)));
    } else if (typeof diag.pageNumber === 'number') {
      setCurrentPageIndex(Math.max(0, Math.min(displayPages.length - 1, diag.pageNumber - 1)));
    }
    const targetUnitId = (typeof payload.unitId === 'string' ? payload.unitId : diag.unitId) ?? null;
    if (targetUnitId) {
      setSelectedUnitId(targetUnitId);
      const foundPageIdx = displayPages.findIndex(pg =>
        [...pg.sourceLines, ...pg.rashiLines, ...pg.tosafotLines, ...(pg.footnoteLines ?? [])]
          .some(l => l.unitId === targetUnitId)
      );
      if (foundPageIdx >= 0) setCurrentPageIndex(foundPageIdx);
    }
    if (action.kind === 'adjust_knee' || action.kind === 'enable_manual_boundary' || action.kind === 'toggle_peripheral') {
      toggleRightDrawer('design', 'rav_text');
    } else if (action.kind === 'widen_column') {
      toggleRightDrawer('design', 'page_geometry');
    }
  }, [displayPages, setInspectorMainTab, setRightDrawerMode, rightDrawerMode]);

  // v0.8.0 Part B — REAL style panels. The v0.7.0 bodies were read-only
  // lists with swapped contents whose clicks only opened the design
  // drawer. A click now applies that role's effective attributes to the
  // selected unit as a local override (DesignSettingsEngine
  // .setLocalUnitOverride — the same path on-page editing uses), which
  // re-paginates through handleUpdateDesignSettings, so the change is
  // visible on the page and undoable (Ctrl+Z). There is deliberately no
  // create/rename/delete here: role styles are the fixed
  // SemanticStyleRole set in the style engine — there is no named-custom-
  // style store to create into. Editing a role's style itself lives in
  // the design drawer (the footer button below).
  const roleLabel = (roleKey: SemanticStyleRole): string =>
    lang === 'en'
      ? (SEMANTIC_ROLE_LABELS_EN[roleKey] ?? roleKey)
      : (SEMANTIC_ROLE_LABELS_HE[roleKey] ?? roleKey);

  const handleApplyRoleStyleToSelectedUnit = (
    roleKey: SemanticStyleRole,
    kind: 'paragraph' | 'character'
  ) => {
    if (!selectedUnit) {
      showToast(t('בחרו תחילה יחידת טקסט בעמוד'), 'error');
      return;
    }
    const resolved = DesignSettingsEngine.resolveRoleAndUnitStyle(designSettings, roleKey);
    // v0.9.2 Part B — through the ONE shared text-style handler (same
    // as the floating toolbar, the Design panel and the keyboard
    // shortcut); the target is this unit, the source values are the
    // picked role's resolved attributes.
    const target = { role: roleKey, unitId: selectedUnit.id };
    const next =
      kind === 'paragraph'
        ? applyParagraphStyleChange(designSettings, target, {
            alignment: resolved.paragraph.alignment,
            leadingPt: resolved.paragraph.leadingPt,
            leftIndentPt: resolved.paragraph.leftIndentPt,
            rightIndentPt: resolved.paragraph.rightIndentPt,
            spaceBeforePt: resolved.paragraph.spaceBeforePt,
            spaceAfterPt: resolved.paragraph.spaceAfterPt,
            firstLineIndentPt: resolved.paragraph.firstLineIndentPt,
          })
        : applyCharacterStyleChange(designSettings, target, {
            fontFamily: resolved.character.fontFamily,
            fontSizePt: resolved.character.fontSizePt,
            fontWeight: resolved.character.fontWeight,
            isBold: resolved.character.isBold,
                isItalic: resolved.character.isItalic,
                trackingEm: resolved.character.trackingEm,
                baselineShiftPt: resolved.character.baselineShiftPt,
              });
    handleUpdateDesignSettings(next, t('החלת סגנון על היחידה הנבחרת'));
    showToast(t('הסגנון הוחל על היחידה הנבחרת'), 'success');
  };

  // v0.8.0 Part B — the context menu's "assign style" items used to
  // just open the design drawer. They now reveal the real style panel
  // (uncollapse + scroll into view) so the user picks a style there.
  const handleRevealStylesPanel = useCallback(
    (panelId: 'paragraph_styles' | 'character_styles') => {
      const next: WorkspaceLayout = {
        ...workspaceLayout,
        panels: workspaceLayout.panels.map(p => (p.id === panelId ? { ...p, collapsed: false } : p)),
      };
      handleWorkspaceLayoutChange(next);
      requestAnimationFrame(() => {
        document.querySelector(`[data-panel-id="${panelId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    },
    [workspaceLayout, handleWorkspaceLayoutChange]
  );

  // v0.8.0 Part B — named-workspace picker handlers (save as / load /
  // delete). `loadSavedWorkspaces` had no callers before this.
  const openWorkspaceMenu = () => {
    const rect = workspaceMenuButtonRef.current?.getBoundingClientRect();
    setWorkspaceMenuPos({ x: rect?.left ?? 100, y: (rect?.bottom ?? 60) + 4 });
    setWorkspaceNameDraft(workspaceLayout.name);
    setSavedWorkspacesList(loadSavedWorkspaces());
    setIsWorkspaceMenuOpen(true);
  };
  const handleSaveWorkspaceAs = () => {
    const name = workspaceNameDraft.trim() || workspaceLayout.name;
    const next: WorkspaceLayout = { ...workspaceLayout, name };
    saveWorkspaceNamed(next);
    setWorkspaceLayout(next);
    saveWorkspace(next);
    setSavedWorkspacesList(loadSavedWorkspaces());
    showToast(t('סביבת העבודה נשמרה'), 'success');
  };
  const handleLoadNamedWorkspace = (saved: WorkspaceLayout) => {
    handleWorkspaceLayoutChange(normalizeWorkspaceLayout(saved, lang === 'en' ? 'en' : 'he'));
    setIsWorkspaceMenuOpen(false);
    showToast(t('הסביבה נטענה'), 'success');
  };
  const handleDeleteNamedWorkspace = (name: string) => {
    deleteSavedWorkspace(name);
    setSavedWorkspacesList(loadSavedWorkspaces());
    showToast(t('הסביבה נמחקה'), 'success');
  };

  // v0.7.0 Part 1 (M1) — dockable panel bodies (shared by both dock strips).
  // v0.8.0 Part B: page_design / layers / glyphs are REMOVED (fake bodies —
  // see PART-B-NOTES.md). The survivors are all real: the two style panels
  // apply a role's attributes to the selected unit; Links jumps to a real
  // rav-text link. Style assignment is also reachable from the design
  // drawer (footer button) and the right-click context menu.
  const dockPanelBodies: Partial<Record<import('./engine/workspace-layout').PanelId, React.ReactNode>> = {
    paragraph_styles: (
      <div className="text-xs space-y-1">
        <div className="text-[var(--ui-muted)] px-1 pb-1">
          {selectedUnit
            ? t('לחצו על סגנון כדי להחיל אותו על היחידה הנבחרת')
            : t('בחרו יחידת טקסט בעמוד כדי להחיל סגנון')}
        </div>
        {(Object.keys(designSettings.roleStyles) as SemanticStyleRole[]).map(roleKey => {
          const resolved = DesignSettingsEngine.resolveRoleAndUnitStyle(designSettings, roleKey);
          const isOwnRole = selectedUnit?.role === roleKey;
          return (
            <button
              key={roleKey}
              type="button"
              disabled={!selectedUnit}
              onClick={() => handleApplyRoleStyleToSelectedUnit(roleKey, 'paragraph')}
              title={selectedUnit ? t('החל סגנון פסקה זה על היחידה הנבחרת') : t('בחרו יחידת טקסט בעמוד כדי להחיל סגנון')}
              className={`block w-full text-start px-1.5 py-1 rounded hover:bg-[var(--ui-hover)] disabled:opacity-50 ${isOwnRole ? 'bg-[var(--ui-selected-bg)]' : ''}`}
            >
              <span className="block font-semibold truncate">{roleLabel(roleKey)}{isOwnRole ? ` · ${t('סגנון היחידה')}` : ''}</span>
              <span className="block text-[var(--ui-muted)] truncate">
                {resolved.paragraph.alignment} · Leading {Math.round(resolved.paragraph.leadingPt * 10) / 10}pt
              </span>
            </button>
          );
        })}
        <button type="button" className="px-2 py-1 rounded border border-[var(--ui-border)] hover:bg-[var(--ui-hover)]" onClick={() => toggleRightDrawer('design')}>{t('עריכת סגנונות בעיצוב')}</button>
      </div>
    ),
    character_styles: (
      <div className="text-xs space-y-1">
        <div className="text-[var(--ui-muted)] px-1 pb-1">
          {selectedUnit
            ? t('לחצו על סגנון כדי להחיל אותו על היחידה הנבחרת')
            : t('בחרו יחידת טקסט בעמוד כדי להחיל סגנון')}
        </div>
        {(Object.keys(designSettings.roleStyles) as SemanticStyleRole[]).map(roleKey => {
          const resolved = DesignSettingsEngine.resolveRoleAndUnitStyle(designSettings, roleKey);
          const isOwnRole = selectedUnit?.role === roleKey;
          return (
            <button
              key={roleKey}
              type="button"
              disabled={!selectedUnit}
              onClick={() => handleApplyRoleStyleToSelectedUnit(roleKey, 'character')}
              title={selectedUnit ? t('החל סגנון תו זה על היחידה הנבחרת') : t('בחרו יחידת טקסט בעמוד כדי להחיל סגנון')}
              className={`block w-full text-start px-1.5 py-1 rounded hover:bg-[var(--ui-hover)] disabled:opacity-50 ${isOwnRole ? 'bg-[var(--ui-selected-bg)]' : ''}`}
            >
              <span className="block font-semibold truncate">{roleLabel(roleKey)}{isOwnRole ? ` · ${t('סגנון היחידה')}` : ''}</span>
              <span className="block text-[var(--ui-muted)] truncate">
                {resolved.character.fontFamily} {Math.round(resolved.character.fontSizePt * 10) / 10}pt{resolved.character.isBold ? ' · B' : ''}
              </span>
            </button>
          );
        })}
        <button type="button" className="px-2 py-1 rounded border border-[var(--ui-border)] hover:bg-[var(--ui-hover)]" onClick={() => toggleRightDrawer('design')}>{t('עריכת סגנונות בעיצוב')}</button>
      </div>
    ),
    links: (
      <div className="text-xs space-y-1">
        {ravTextLinks.slice(0, 20).map(l => (
          <button key={l.linkId} type="button" onClick={() => { if (l.sourceUnitId) setSelectedUnitId(l.sourceUnitId); }} className="block w-full text-start px-1.5 py-0.5 rounded hover:bg-[var(--ui-hover)] truncate" title={l.commentaryUnitId}>
            {t('קישור')}: {l.dibburHamatchil || l.sourceUnitId}
          </button>
        ))}
        {ravTextLinks.length === 0 && <div className="text-[var(--ui-muted)]">{t('אין קישורי רש״י/תוספות עדיין')}</div>}
      </div>
    ),
  };

  return (
    <div
      data-theme={uiTheme}
      className="h-screen w-screen flex flex-col bg-[var(--ui-app-bg)] text-[var(--ui-text-primary)] overflow-hidden font-sans select-none transition-colors duration-150"
    >
      {/* Hidden input fallback for loading .keter / .keter.json project files */}
      <input
        ref={projectFileInputRef}
        type="file"
        accept=".keter,.keter.json,.json"
        onChange={handleImportProjectFileInput}
        className="hidden"
      />

      {/* 1. Compact Editorial Studio Header (One Top Bar with 3 Real Work Modes: כניסה | עריכה | ייצוא) */}
      <EditorialStudioHeader
        activeWorkMode={activeWorkMode}
        onWorkModeChange={mode => {
          setEditingUnitId(null);
          setActiveWorkMode(mode);
        }}
        documentTitle={documentTitle}
        isModified={isDirty}
        layoutType={layoutType}
        onLayoutTypeChange={handleLayoutTypeChange}
        layoutDisplayName={layoutDisplayLabel(designSettings, lang)}
        currentPage={safePageIndex + 1}
        totalPages={totalPages}
        // v0.8.1 — white-screen fix: activePage can no longer be undefined
        // (the engine now guarantees ≥1 page), but the header must never
        // throw even if it ever is — a throw here blanks the whole window.
        currentPageHebrew={activePage?.pageNumberHebrew ?? 'א׳'}
        isNavigatorOpen={isNavigatorOpen}
        onToggleNavigator={() => setIsNavigatorOpen(!isNavigatorOpen)}
        isInspectorOpen={rightDrawerMode === 'design'}
        onToggleInspector={() => toggleRightDrawer('design')}
        isAiDrawerOpen={rightDrawerMode === 'ai'}
        onToggleAiDrawer={() => toggleRightDrawer('ai')}
        onNewProject={handleRequestNewProject}
        onOpenDocx={handleRequestOpenDocx}
        onOpenContentEditor={() => setIsContentEditorOpen(true)}
        onSaveProjectFile={() => void handleSaveProjectFile()}
        onLoadProjectFile={handleRequestOpenProjectFile}
        // v0.9.2 Part B — the header no longer has a one-click PDF export
        // or a knee-guide toggle: export lives in the Export workspace,
        // the knee guide lives in the floating toolbar + Design panel.
        // v0.6.0 Part A (§10): Layout & Design group — Custom Layout
        // switches to the custom layout and opens the design panel (the
        // box designer itself lives on the setup screens, Part C); Shaar
        // Blatt opens the title-page tab in the design panel.
        onOpenCustomLayout={() => {
          setEditingUnitId(null);
          handleLayoutTypeChange('custom_layout');
          setActiveWorkMode('edit');
          setRightDrawerMode('design');
        }}
        onOpenTitlePage={() => {
          setEditingUnitId(null);
          setActiveWorkMode('edit');
          setInspectorMainTab('title_page');
          setRightDrawerMode('design');
          if (designSettings?.titlePage?.enabled) {
            setCurrentPageIndex(0);
          }
        }}
        isExportingPdf={isExportingPdf}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={canUndo}
        canRedo={canRedo}
        undoLabel={undoLabel}
        redoLabel={redoLabel}
        onOpenFontScanner={() => setIsFontScannerOpen(true)}
        onOpenRulesModal={() => setIsRulesModalOpen(true)}
        onOpenTests={() => setIsTestPanelOpen(true)}
        onOpenReport={() => setIsReportModalOpen(true)}
        developerMode={developerMode}
        onToggleDeveloperMode={handleToggleDeveloperMode}
        onOpenWelcome={() => setIsWelcomeOpen(true)}
        showBaselines={showBaselines}
        onToggleBaselines={() => setShowBaselines(!showBaselines)}
        uiTheme={uiTheme}
        onToggleUiTheme={handleToggleUiTheme}
        uiLang={lang}
        onToggleUiLang={toggleLanguage}
        onOpenGeminiKey={() => setIsGeminiKeyModalOpen(true)}
        // v0.5.0 Part C (Module 7): secondary .docx import — the header owns
        // the modal; the merge only sets state, so edits, formatting and
        // unsaved state survive.
        secondaryImportUnits={contentUnits}
        secondaryImportLinks={ravTextLinks}
        onMergeSecondaryImport={(units, links) => {
          lastActionLabelRef.current = {
            label: 'ייבוא מסמך משני',
            key: 'secondary-import',
            coalesce: false,
          };
          setContentUnits(units);
          setRavTextLinks(links);
          showToast(t('המסמך המשני מוזג לספר!'), 'success');
        }}
      />

      {/* 1b. v0.4.0 Guided flow — the 3-step journey, always visible */}
      <GuidedStepsBar
        activeWorkMode={activeWorkMode}
        hasOpenedBook={hasOpenedBook}
        hasExported={hasExported}
        onStepClick={mode => {
          setEditingUnitId(null);
          setActiveWorkMode(mode);
        }}
      />

      {/* 2. Primary Workspace Content Switched by Active Work Mode */}
      {/* v0.8.1 — white-screen fix: the whole workspace (Home / Edit /
          Export) sits inside an ErrorBoundary, so a render crash shows a
          friendly fallback with Reload / Back to Home / New project
          instead of a blank white window. The error is logged to
          localStorage (keter-last-error) for diagnosis. */}
      <ErrorBoundary
        key={activeWorkMode}
        label="workspace"
        onReset={() => setActiveWorkMode('home')}
        onNewProject={handleRequestNewProject}
      >
      <div key={activeWorkMode} className="flex-1 flex flex-col overflow-hidden min-h-0 keter-view-enter">
      {activeWorkMode === 'home' && (
        <HomeWorkspaceView
          currentTitle={documentTitle}
          currentLayoutType={layoutType}
          totalPages={totalPages}
          totalUnits={contentUnits.length}
          isDirty={isDirty}
          lastAutosaveTimestamp={lastAutosaveTimestamp}
          recoveredFromAutosave={recoveredFromAutosave}
          recentProjects={recentProjects}
          hasAutosaveToRecover={Boolean(recoveredFromAutosave || lastAutosaveTimestamp)}
          onOpenWelcome={() => setIsWelcomeOpen(true)}
          onRecoverAutosave={handleRecoverAutosave}
          onContinueActiveProject={() => setActiveWorkMode('edit')}
          onRenameActiveProject={(newTitle) => {
            lastActionLabelRef.current = {
              label: `שינוי שם ספר: ${newTitle}`,
              key: 'rename-project',
              coalesce: false,
            };
            setDocumentTitle(newTitle);
          }}
          // v0.9.4 — Home's inline "start a book" section is back: it
          // calls the SAME handleCreateNewProject the modal calls,
          // wrapped in the same unsaved-changes guard the modal path
          // runs when the modal is opened (there is no "open" step for
          // an inline form, so the guard runs at create time instead).
          // 'sample' is this screen's old inline-wizard default, kept
          // as the form's initialMode.
          onCreateNewProject={(title, nextLayout, mode) => {
            runWithUnsavedChangesGuard(t("יצירת פרויקט חדש"), () => {
              handleCreateNewProject(title, nextLayout, mode);
            });
          }}
          onOpenDocxImport={handleRequestOpenDocx}
          // v0.9.7 — the inline Home DOCX hub imports through the SAME
          // handleImportUnits the modal uses. The unsaved-changes guard
          // runs here at import time (the modal path guards at open
          // time instead); both end in the same handler.
          onImportUnits={(units, title, links, autoLayout) => {
            runWithUnsavedChangesGuard(t("ייבוא קובץ Word (DOCX) חדש"), () => {
              handleImportUnits(units, title, links, autoLayout);
            });
          }}
          onOpenProjectFileDialog={handleRequestOpenProjectFile}
          onLoadProjectFileDirect={file => {
            runWithUnsavedChangesGuard(t("פתיחת קובץ פרויקט (.keter)"), () => {
              void loadValidatedProjectFile(file);
            });
          }}
          onLoadRecentProject={snap => {
            runWithUnsavedChangesGuard(`פתיחת פרויקט "${snap.documentTitle}"`, () => {
              loadProjectSnapshotIntoWorkspace(snap, true);
              setRecentProjects(ProjectPersistenceEngine.recordRecentProject(snap));
              setEditingUnitId(null);
              setActiveWorkMode('edit');
              showToast(tf('הפרויקט "{title}" נטען בהצלחה!', { title: snap.documentTitle }), 'success');
            });
          }}
          onRemoveRecentProject={projectId => {
            setRecentProjects(ProjectPersistenceEngine.removeRecentProject(projectId));
          }}
          onSaveActiveProject={() => void handleSaveProjectFile()}
        />
      )}

      {activeWorkMode === 'export' && (
        <ExportWorkspaceView
          bookDoc={displayBookDoc}
          activePage={activePage}
          currentPageIndex={safePageIndex}
          onSelectPage={idx => setCurrentPageIndex(idx)}
          validationReport={validationReport}
          qaScore={qaReport.qualityScore}
          qaIssues={qaReport.issues}
          isDirty={isDirty}
          isExportingPdf={isExportingPdf}
          exportProgress={exportProgress}
          onExportPdf={handleExportPdf}
          onExportIdml={customName => handleExportIdml('test_f_true_rav_text_flow', customName)}
          onSaveProjectFile={suggestedName => void handleSaveProjectFile(suggestedName)}
          onReturnToEdit={() => setActiveWorkMode('edit')}
          onOpenRulesModal={() => setIsRulesModalOpen(true)}
          // v0.5.0 (Title Page): the cover controls in the export view now
          // edit the project's title-page settings (one cover system).
          designSettings={designSettings}
          onUpdateDesignSettings={handleUpdateDesignSettings}
          onEditTitlePage={() => {
            setActiveWorkMode('edit');
            toggleRightDrawer('design', 'title_page');
          }}
          onDiagnosticAction={handleDiagnosticAction}
        />
      )}

      {activeWorkMode === 'edit' && (
        <div dir={dir} className="flex-1 flex overflow-hidden min-h-0 relative bg-[var(--ui-workspace-bg)]">
          {/* 2A. Navigation drawer (v0.9.2 Part B — the ONLY page-navigation
              surface: the InDesign-style PagesPanel and the ThumbnailOverview
              modal are gone; this sidebar's Pages tab carries the page
              list plus PagesPanel's reorder/insert/delete, and the
              overview button below opens this tab instead of a modal). */}
          <PageNavigatorSidebar
            pages={displayPages}
            currentPageIndex={safePageIndex}
            onSelectPage={idx => setCurrentPageIndex(idx)}
            units={contentUnits}
            links={ravTextLinks}
            validation={validationReport}
            selectedUnitId={selectedUnitId}
            onSelectUnit={unitId => setSelectedUnitId(unitId)}
            layoutType={layoutType}
            isOpen={isNavigatorOpen}
            onToggleOpen={() => setIsNavigatorOpen(false)}
            activeTab={navigatorTab}
            onTabChange={setNavigatorTab}
            widthPx={navigatorWidth}
            onReorderPage={handleReorderPage}
            onInsertPage={handleInsertPage}
            onDeletePage={handleDeletePage}
          />

          {isNavigatorOpen && (
            <div
              onMouseDown={e => {
                resizingSideRef.current = 'navigator';
                resizeStartXRef.current = e.clientX;
                resizeStartWidthRef.current = navigatorWidth;
              }}
              className="w-1 bg-[var(--ui-border)] hover:bg-[var(--ui-accent)] cursor-col-resize transition-colors shrink-0 z-30"
              title={t("גרור לשינוי רוחב מגירת הניווט")}
            />
          )}

          <DockablePanels layout={workspaceLayout} side={dir === 'rtl' ? 'right' : 'left'} onLayoutChange={handleWorkspaceLayoutChange} renderFloating={false}>
            {dockPanelBodies}
          </DockablePanels>
          {/* 2B. Primary Book Canvas with Floating Contextual Toolbar */}
          <div
            className="flex-1 flex flex-col overflow-hidden min-h-0 relative bg-[var(--ui-workspace-bg)]"
            onContextMenu={e => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, unitId: selectedUnitId, onFrame: layoutType === 'custom_layout' });
            }}
          >
            {/* v0.7.0 Part 2 (M3) — frame tools toolbar. */}
            <FrameToolsToolbar
              activeTool={activeTool}
              onToolChange={setActiveTool}
              polygonVariant={polygonVariant}
              onPolygonVariantChange={setPolygonVariant}
              onAddFrame={handleAddFrame}
              canAddFrame={layoutType === 'custom_layout'}
            />
            {/* v0.9.0 Part C — auto-layout notice: ONE clear line stating
                what layout was chosen and why, with an obvious "Change
                layout" action (a layout picker + Apply). The banner stays
                until the user applies another layout or dismisses it. */}
            {autoLayoutNotice && (
              <div className="mx-3 mt-2 shrink-0 rounded-lg border border-amber-700/60 bg-amber-950/40 px-3 py-2 text-xs flex items-center gap-2 flex-wrap">
                <span className="text-stone-200 font-medium">{lang === 'en' ? autoLayoutNotice.lineEn : autoLayoutNotice.lineHe}</span>
                {/* v0.9.9 — the ONE shared layout/recipe picker: the same
                    registry (27 recipes + 7 base layouts) and the same
                    recipe path as everywhere else. A recipe choice applies
                    through handleApplyHistoricalRecipe (single id-based
                    applier); a plain layout through handleLayoutTypeChange. */}
                <LayoutRecipePicker
                  key={`${autoLayoutNotice.recipeId}|${autoLayoutChangeTarget}`}
                  initialRecipeId={autoLayoutNotice.recipeId || undefined}
                  initialLayout={autoLayoutChangeTarget}
                  lang={lang}
                  title={t("בחר תבנית עימוד אחרת")}
                  onSelectionChange={sel => { bannerSelectionRef.current = sel; }}
                />
                <button
                  type="button"
                  onClick={() => {
                    const sel = bannerSelectionRef.current;
                    if (sel?.kind === 'recipe') {
                      handleApplyHistoricalRecipe(sel.recipeId);
                    } else if (sel?.kind === 'layout') {
                      handleLayoutTypeChange(sel.layoutType);
                    } else if (autoLayoutChangeTarget) {
                      handleLayoutTypeChange(autoLayoutChangeTarget);
                    }
                    bannerSelectionRef.current = null;
                    setAutoLayoutNotice(null);
                  }}
                  className="px-3 py-1 rounded-md bg-amber-700 hover:bg-amber-600 text-white font-semibold"
                >
                  {t("שנה תבנית")}
                </button>
                <button
                  type="button"
                  onClick={() => setAutoLayoutNotice(null)}
                  className="px-2 py-1 rounded-md bg-stone-800 hover:bg-stone-700 text-stone-300"
                >
                  {t("סגור")}
                </button>
              </div>
            )}
            {/* Floating Contextual Formatting Toolbar near the active page.
                v0.9.2 Part C: the wrapper keeps its selected-state height
                (min-h) even with nothing selected. The toolbar and the
                Control Panel below both grow when a unit is selected; if
                the bars grew in-flow, the whole page canvas would jump
                down ~45px on every word click — and the second click of
                a double-click would land on empty sheet where the word
                was, blurring the editor shut. Reserving the height keeps
                the page still, so a double-click lands on the word. */}
            <div className="pt-3.5 pb-1 flex justify-center shrink-0 z-20 bg-[var(--ui-workspace-bg)] transition-colors duration-150 min-h-[71px]">
              <FloatingContextToolbar
                designSettings={designSettings}
                onUpdateDesignSettings={handleUpdateDesignSettings}
                availableFonts={availableFonts}
                selectedUnit={selectedUnit}
                selectedWordInfo={selectedWordInfo}
                onClearSelection={() => {
                  setSelectedUnitId(null);
                  setSelectedWordInfo(null);
                }}
                currentPageIndex={safePageIndex}
                layoutType={layoutType}
                showKneeGuide={showKneeGuide}
                onToggleKneeGuide={() => setShowKneeGuide(!showKneeGuide)}
                onOpenInspectorTab={tab => toggleRightDrawer('design', tab)}
                onEditSelectedUnit={unitId => setEditingUnitId(unitId)}
                onAutoCenterBlock={handleAutoCenterSelectedBlock}
                // v0.9.8 Phase 5: push / pull line micro-adjustments.
                onPushLineToNextPage={handlePushLineToNextPage}
                onPullLineToThisPage={handlePullLineToThisPage}
                canPushLine={
                  (activePage?.sourceLines?.length ?? 0) +
                    (activePage?.rashiLines?.length ?? 0) +
                    (activePage?.tosafotLines?.length ?? 0) >
                  0
                }
                canPullLine={
                  safePageIndex + 1 < displayPages.length &&
                  ((displayPages[safePageIndex + 1]?.sourceLines?.length ?? 0) +
                    (displayPages[safePageIndex + 1]?.rashiLines?.length ?? 0) +
                    (displayPages[safePageIndex + 1]?.tosafotLines?.length ?? 0) >
                    0)
                }
              />
            </div>

            {/* v0.7.0 Part 1 (M2) — InDesign-style context-aware Control Panel.
                v0.9.2 Part B: frame geometry only — the text controls that
                used to live here now live in the floating toolbar + Design
                panel, through the one shared text-style handler. */}
            <ControlPanel
              frame={selectedFrame}
              onFrameGeometryChange={handleFrameGeometryChange}
              onAutoCenterFrame={handleAutoCenterSelectedBlock}
            />
            {/* v0.3.0: quick access to search, proofing, QA fixes, overview,
                suggestions, print versions and the local library folder. */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 shrink-0 overflow-x-auto bg-[var(--ui-surface)] border-b border-[var(--ui-border)] text-xs">
              <input
                ref={libraryFileInputRef}
                type="file"
                multiple
                accept=".docx,.txt,.md"
                className="hidden"
                onChange={e => {
                  void handleLibraryFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <button type="button" onClick={() => setIsSearchOpen(v => !v)} title={t("חפשו מילה בספר והחליפו אותה")} className="px-2.5 py-1 rounded-md border border-[var(--ui-border)] hover:bg-[var(--ui-hover)] whitespace-nowrap">{t("חיפוש והחלפה")}</button>
              <button type="button" onClick={() => setIsProofingOpen(v => !v)} title={t("בדקו שגיאות כתיב וניקוד בספר")} className="px-2.5 py-1 rounded-md border border-[var(--ui-border)] hover:bg-[var(--ui-hover)] whitespace-nowrap">{t("הגהה")} ({textIssues.length})</button>
              <button type="button" onClick={() => { setActiveWorkMode('edit'); setIsNavigatorOpen(true); setNavigatorTab('pages'); }} title={t("ראו את כל העמודים בבת אחת")} className="px-2.5 py-1 rounded-md border border-[var(--ui-border)] hover:bg-[var(--ui-hover)] whitespace-nowrap">{t("דפים")}</button>
              <button type="button" onClick={() => setIsPaletteOpen(true)} title={t("כל הפעולות במקום אחד (Ctrl+K)")} className="px-2.5 py-1 rounded-md border border-[var(--ui-border)] hover:bg-[var(--ui-hover)] whitespace-nowrap">⌘K {t("פקודות")}</button>
              <button ref={workspaceMenuButtonRef} type="button" onClick={openWorkspaceMenu} title={t("שמור את סידור הלוחות הנוכחי כסביבת עבודה, או טען סביבה שמורה")} className="px-2.5 py-1 rounded-md border border-[var(--ui-border)] hover:bg-[var(--ui-hover)] whitespace-nowrap">{t("סביבות עבודה")}</button>
              <button type="button" onClick={() => setShowShasPanel(v => !v)} title={t("אימות דיבור המתחיל, רצף דפים ופגמי עימוד ש״ס")} className="px-2.5 py-1 rounded-md border border-[var(--ui-border)] hover:bg-[var(--ui-hover)] whitespace-nowrap">{t("בדיקת ש״ס")}</button>              {/* v0.5.0 (integrator — simplification): the secondary tools
                  (page fixes, suggestions, print version, local library,
                  anchors) sit behind this disclosure instead of crowding
                  the toolbar — nothing was removed, only tucked away. */}
              <button type="button" onClick={() => setShowMoreTools(v => !v)} title={t("כלים נוספים: תיקוני עמוד, הצעות, גרסת דפוס, ספרייה מקומית, סימני ניקוד")} aria-expanded={showMoreTools} className="px-2.5 py-1 rounded-md border border-[var(--ui-border)] hover:bg-[var(--ui-hover)] whitespace-nowrap">{t("אפשרויות נוספות")} {showMoreTools ? '▴' : '▾'}</button>
              {showMoreTools && (
                <>
              {/* v0.9.8 Phase 1 — Developer Mode OFF hides the QA-audit
                  "page fixes" button (the QaFixList panel below is gated
                  the same way, so no reachable path remains). */}
              {developerMode && (
              <button type="button" onClick={() => setShowQaFixList(v => !v)} title={t("בדקו שהעמוד נראה טוב לדפוס")} className="px-2.5 py-1 rounded-md border border-[var(--ui-border)] hover:bg-[var(--ui-hover)] whitespace-nowrap">{t("תיקוני עמוד")}</button>
              )}
              <button type="button" onClick={() => setShowSuggestions(v => !v)} title={t("הצעות לשיפור מהמערכת")} className="px-2.5 py-1 rounded-md border border-[var(--ui-border)] hover:bg-[var(--ui-hover)] whitespace-nowrap">{t("הצעות")} ({suggestions.filter(x => x.status === 'pending').length})</button>
              <button type="button" onClick={handleFreezePrintVersion} title={t("שמרו גרסה קפואה להדפסה, שלא תשתנה")} className="px-2.5 py-1 rounded-md border border-[var(--ui-border)] hover:bg-[var(--ui-hover)] whitespace-nowrap">{t("גרסת דפוס")} ({printVersions.length})</button>
              <button type="button" onClick={() => libraryFileInputRef.current?.click()} title={t("פתחו קבצי Word מהספרייה שלכם")} className="px-2.5 py-1 rounded-md border border-[var(--ui-border)] hover:bg-[var(--ui-hover)] whitespace-nowrap">{t("ספרייה מקומית")}</button>
              {/* v0.9.8 Uniformity Audit — renamed "עוגנים" → "סימני
                  ניקוד": the old label read as dibbur-anchor links next
                  to the "קישורי ד״ה" button. These are the small marks
                  that show where nikud/taamim attach on the page. */}
              <button
                type="button"
                onClick={() => setShowAnchors(v => !v)}
                title={t("הצג סימני ניקוד וטעמים על העמוד")}
                className={`px-2.5 py-1 rounded-md border whitespace-nowrap ${showAnchors ? 'border-[var(--ui-accent)] bg-[var(--ui-selected-bg)] text-[var(--ui-accent)]' : 'border-[var(--ui-border)] hover:bg-[var(--ui-hover)]'}`}
              >
                {t("סימני ניקוד")}
              </button>
              {/* v0.9.8 Phase 5 — "Show Anchor Links": draws the Phase 3
                  AnchorLinks as connector lines between the real rendered
                  dibbur word and its target phrase; a click on a dibbur
                  word while it is on arms click-to-re-anchor. */}
              <button
                type="button"
                data-testid="toggle-anchor-links"
                onClick={() => {
                  setShowAnchorLinks(v => !v);
                  setReAnchorPendingUnitId(null);
                }}
                title={t("הצג קישורי דיבור המתחיל על העמוד")}
                className={`px-2.5 py-1 rounded-md border whitespace-nowrap ${showAnchorLinks ? 'border-[var(--ui-accent)] bg-[var(--ui-selected-bg)] text-[var(--ui-accent)]' : 'border-[var(--ui-border)] hover:bg-[var(--ui-hover)]'}`}
              >
                {t("קישורי ד״ה")}
              </button>
                </>
              )}
            </div>
            {/* v0.4.0 — the balancing pass's unfixable notes were computed
                and then thrown away; show them so a page that needs
                repagination is visible instead of silently "balanced". */}
            {balanceReport.notes.length > 0 && (
              <div className="px-3 py-1 shrink-0 bg-[var(--ui-surface)] border-b border-[var(--ui-border)] text-[11px] text-[var(--ui-text-secondary)]" title={balanceReport.notes.join('\n')}>
                {t('איזון: יש עמודים שלא ניתן לאזן אוטומטית — רחפו כאן לפרטים')} ({balanceReport.notes.length})
              </div>
            )}
            {/* v0.8.0 Part E — layout health: overlap counts, visible in
                the editor instead of only inside the score object. Click
                jumps to the first affected page; hover lists every page. */}
            {collisionReport.total > 0 && (
              <button
                type="button"
                onClick={() => setCurrentPageIndex(collisionReport.pages[0].pageIndex)}
                className="px-3 py-1 shrink-0 bg-[var(--ui-warning-bg)] border-b border-[var(--ui-warning)]/35 text-[11px] text-[var(--ui-warning)] text-start"
                title={collisionReport.pages
                  .map(p => `${t('דף')} ${p.pageNumberHebrew}: ${p.count} ${t('חפיפות')}`)
                  .join('\n')}
              >
                {t('חפיפות טקסט:')} {collisionReport.total} {t('חפיפות')} · {collisionReport.pages.length} {t('עמודים')} — {t('לחצו למעבר לעמוד הראשון')}
              </button>
            )}

            {/* v0.8.1 — white-screen fix: a blank project used to show a
                bare empty page with no explanation (and, before the engine
                fix, a blank white window). An empty book now gets a clear
                empty state with the two ways to fill it. */}
            {contentUnits.length === 0 && (
              <div className="shrink-0 mx-4 mt-3 p-4 rounded-xl border border-dashed border-[var(--ui-border)] bg-[var(--ui-surface)] text-center space-y-2">
                <p className="text-sm font-semibold text-[var(--ui-text-primary)]">
                  {t('הספר ריק — אין עדיין תוכן')}
                </p>
                <p className="text-xs text-[var(--ui-text-secondary)]">
                  {t('ייבאו קובץ Word כדי להתחיל, או טענו ספר לדוגמה.')}
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleRequestOpenDocx}
                    className="px-3 py-1.5 rounded-lg bg-[var(--ui-accent)] text-white text-xs font-semibold hover:opacity-90"
                  >
                    {t('ייבוא קובץ Word')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCreateNewProject(documentTitle, layoutType, 'sample')}
                    className="px-3 py-1.5 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] text-xs hover:bg-[var(--ui-hover)]"
                  >
                    {t('ספר לדוגמה')}
                  </button>
                </div>
              </div>
            )}

            {storyView ? (
              <StoryEditor
                units={contentUnits}
                onCommitUnit={(unitId, newText) => handleCommitInPlaceUnitEdit(unitId, newText)}
                onBackToLayout={() => { setStoryView(false); setInitialEditingUnitId(null); }}
                initialEditingId={initialEditingUnitId}
              />
            ) : (
            // v0.9.0 Part B — BASE FIX (pre-existing v0.9.0 staging typo,
            // not Part B code): these two lines were written as a JSX
            // comment {/* … */} inside a parenthesised JS expression,
            // where `{` opens a JS block and breaks the whole file's
            // parse (tsc: ErrorBoundary unclosed + 10 cascade errors).
            // Restored to the v0.8.1 line-comment form, which parses.
            // v0.8.1 — white-screen fix: a crash inside the canvas must
            // show the fallback, never blank the whole window.
            // (v0.9.0 Part C note: this MUST stay a // comment — a JSX
            // {/* */} comment here is parsed as an empty object literal
            // inside the ternary parens, which breaks tsc/esbuild for the
            // whole file. The v0.9.0 base tree had it as {/* */} and did
            // not compile; restored to the v0.8.1 form.)
            <ErrorBoundary label="page-canvas" onReset={() => setActiveWorkMode('home')}>
            <PageCanvas
              typesetResult={activePage}
              zoom={zoom}
              // v0.6.0 Part A (§5): the page index resolves per-folio
              // running-header overrides (falls back to pageNumber - 1).
              currentPageIndex={safePageIndex}
              showBaselines={showBaselines}
              showAnchors={showAnchors}
              showKneeGuide={showKneeGuide && !displayPerformanceFast}
              // v0.9.8 Phase 5: anchor-link overlay + click-to-re-anchor.
              anchorLinks={contentUnits
                .map(u => u.anchorLink)
                .filter((a): a is AnchorLink => !!a)}
              showAnchorLinks={showAnchorLinks}
              reAnchorPendingUnitId={reAnchorPendingUnitId}
              onReAnchorDibburPick={handleReAnchorDibburPick}
              onReAnchorTargetPick={handleReAnchorTargetPick}
              onReAnchorCancel={handleReAnchorCancel}
              threadLinks={threadLinks}
              hoveredLinkId={hoveredLinkId}
              onHoverLink={setHoveredLinkId}
              onZoomChange={setZoom}
              selectedFont={selectedFont}
              selectedRashiFont={selectedRashiFont}
              selectedTosafotFont={selectedTosafotFont}
              selectedUnitId={selectedUnitId}
              onSelectUnit={unitId => setSelectedUnitId(unitId)}
              onSelectWord={(unitId, wordIndex, wordText, role) =>
                setSelectedWordInfo({ unitId, wordIndex, wordText, role })
              }
              units={contentUnits}
              editingUnitId={editingUnitId}
              onStartEditUnit={unitId => setEditingUnitId(unitId)}
              onCancelEditUnit={() => setEditingUnitId(null)}
              onCommitEditUnit={handleCommitInPlaceUnitEdit}
              onPageSplitRequest={handlePageSplitRequest}
              onAddBreakInstruction={instr => setBreakInstructions(prev => [...prev, instr])}
              // v0.8.0 Part E (#14): drag-to-draw frame tools.
              activeFrameTool={activeTool}
              onDrawFrame={handleDrawFrame}
              onDrawTextFrame={handleDrawTextFrame}
              // v0.5.0 Part B (Module 4): the hovered SECTION (block) —
              // identity + bounding box — handed to the state manager.
              onHoverBlock={setHoveredBlock}
              // v0.5.0 Part C (Module 8): direct on-page editing. Commits go
              // through the same handleCommitInPlaceUnitEdit path (existing
              // undo history); the mini-toolbar's format changes persist as
              // local overrides on the edited block.
              enableContentEditableEditing
              // v0.5.0 (Title Page): direct on-page editing of title-page
              // fields (overlay); commits go through handleUpdateDesignSettings.
              onTitlePageFieldChange={handleTitlePageFieldChange}
              onTitlePageFieldPositionChange={handleTitlePageFieldPositionChange}
              // v0.6.0 Part C (§2/§6): movable boxes on this folio +
              // editable running-header title (see handlers above).
              customLayoutBoxes={customLayoutBoxesForPage}
              onCustomLayoutBoxesChange={handleCustomLayoutBoxesChange}
              onHeaderTitleChange={handleHeaderTitleChange}
              onInlineFormatChange={(unitId, patch) => {
                const character: {
                  fontSizePt?: number;
                  isBold?: boolean;
                  isItalic?: boolean;
                } = {};
                if (patch.fontSizePt !== undefined) character.fontSizePt = patch.fontSizePt;
                if (patch.bold !== undefined) character.isBold = patch.bold;
                if (patch.italic !== undefined) character.isItalic = patch.italic;
                const paragraph: { alignment?: 'right' | 'center' | 'left' | 'justify' } = {};
                if (patch.alignment) paragraph.alignment = patch.alignment;
                // v0.9.2 Part B — through the ONE shared text-style
                // handler (same as the floating toolbar, the Design
                // panel, the style panels and the keyboard shortcut).
                const target = {
                  role: contentUnits.find(u => u.id === unitId)?.role ?? 'main_source',
                  unitId,
                };
                let next = designSettings;
                if (Object.keys(character).length > 0) next = applyCharacterStyleChange(next, target, character);
                if (Object.keys(paragraph).length > 0) next = applyParagraphStyleChange(next, target, paragraph);
                handleUpdateDesignSettings(next, t('עריכת טקסט במקום'));
              }}
            />
            </ErrorBoundary>
            )}
            {/* v0.7.0 Part 2 (M4) — right-click context menu. */}
            {contextMenu && (
              <FrameContextMenu
                menu={contextMenu}
                onClose={() => setContextMenu(null)}
                onFittingAutoCenter={() => handleAutoCenterSelectedBlock()}
                onDisplayPerformance={() => setDisplayPerformanceFast(v => !v)}
                displayPerformanceFast={displayPerformanceFast}
                onOpenStoryEditor={() => setStoryView(true)}
                onAssignParagraphStyle={() => handleRevealStylesPanel('paragraph_styles')}
                onAssignCharacterStyle={() => handleRevealStylesPanel('character_styles')}
                onCopyText={() => {
                  const u = contentUnits.find(x => x.id === contextMenu.unitId);
                  if (u) void navigator.clipboard?.writeText(u.rawText).catch(() => undefined);
                }}
                onDeleteUnit={() => {
                  if (!contextMenu.unitId) return;
                  setContentUnits(prev => prev.filter(u => u.id !== contextMenu.unitId));
                  showToast(t('היחידה נמחקה'), 'success');
                }}
              />
            )}
            {/* v0.8.0 Part B — named-workspace picker (save as / load /
                delete). Replaces the old save-only "שמור סביבה" button,
                whose load path (`loadSavedWorkspaces`) had no callers. */}
            {isWorkspaceMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setIsWorkspaceMenuOpen(false)} />
                <div
                  className="fixed z-50 w-72 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-panel-bg)] shadow-xl p-2 text-xs space-y-2"
                  style={{ left: Math.min(workspaceMenuPos.x, window.innerWidth - 300), top: Math.min(workspaceMenuPos.y, window.innerHeight - 320) }}
                  data-testid="workspace-menu"
                >
                  <div className="font-semibold px-1">{t('סביבות עבודה')}</div>
                  <div className="flex gap-1 px-1">
                    <input
                      value={workspaceNameDraft}
                      onChange={e => setWorkspaceNameDraft(e.target.value)}
                      placeholder={t('שם הסביבה')}
                      className="flex-1 min-w-0 px-1.5 py-1 rounded border border-[var(--ui-border)] bg-[var(--ui-input-bg)] text-[var(--ui-text)]"
                    />
                    <button type="button" onClick={handleSaveWorkspaceAs} className="px-2 py-1 rounded border border-[var(--ui-border)] hover:bg-[var(--ui-hover)] whitespace-nowrap">{t('שמור')}</button>
                  </div>
                  <div className="space-y-0.5 max-h-56 overflow-y-auto">
                    {savedWorkspacesList.length === 0 && (
                      <div className="text-[var(--ui-muted)] px-1 py-1">{t('אין סביבות שמורות עדיין')}</div>
                    )}
                    {savedWorkspacesList.map(w => (
                      <div key={w.name} className="flex items-center gap-1 px-1 py-0.5 rounded hover:bg-[var(--ui-hover)]">
                        <span className="flex-1 truncate" title={w.name}>{w.name}</span>
                        <button type="button" onClick={() => handleLoadNamedWorkspace(w)} className="px-2 py-0.5 rounded border border-[var(--ui-border)] hover:bg-[var(--ui-hover)]">{t('טען')}</button>
                        <button type="button" onClick={() => handleDeleteNamedWorkspace(w.name)} className="px-2 py-0.5 rounded border border-[var(--ui-border)] hover:bg-[var(--ui-hover)] text-red-600">{t('מחק')}</button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Resizable Splitter for Optional Inspector / AI Drawer */}
          {rightDrawerMode !== null && (
            <div
              onMouseDown={e => {
                resizingSideRef.current = 'inspector';
                resizeStartXRef.current = e.clientX;
                resizeStartWidthRef.current = rightDockWidth;
              }}
              className="w-1 bg-[var(--ui-border)] hover:bg-[var(--ui-accent)] cursor-col-resize transition-colors shrink-0 z-30"
              title={t("גרור לשינוי רוחב החלונית")}
            />
          )}

          {/* v0.7.0 Part 1 (M1) — dockable InDesign-style panels (persisted workspace). */}
          <DockablePanels layout={workspaceLayout} side={dir === 'rtl' ? 'left' : 'right'} onLayoutChange={handleWorkspaceLayoutChange} renderFloating>
            {dockPanelBodies}
          </DockablePanels>
          {/* 2C. Optional Contextual Inspector Drawer or AI Drawer (Disappears completely when closed) */}
          {rightDrawerMode === 'design' && (
            <div
              style={{ width: `${rightDockWidth}px` }}
              className="h-full min-h-0 shrink-0 z-30 shadow-[var(--ui-floating-shadow)] overflow-hidden"
            >
              <DesignTypesettingPanel
                designSettings={designSettings}
                onUpdateDesignSettings={handleUpdateDesignSettings}
                availableFonts={availableFonts}
                selectedUnit={selectedUnit}
                selectedWordInfo={selectedWordInfo}
                onClearSelectedWord={() => setSelectedWordInfo(null)}
                currentPageIndex={safePageIndex}
                totalPages={totalPages}
                activeMainTab={inspectorMainTab}
                onMainTabChange={setInspectorMainTab}
                bookTitle={documentTitle}
                knee={activePage.knee}
                kneeSettings={kneeSettings}
                onUpdateKneeSettings={nextKnee => {
                  setKneeSettings(nextKnee);
                  setDesignSettings(prev =>
                    DesignSettingsEngine.updateRavTextSettings(
                      prev,
                      {
                        kneeSettings: nextKnee,
                        gutterWidthPt: nextKnee.gutterWidth,
                        upperCollarLines: nextKnee.upperKneeLines,
                      },
                      'user'
                    )
                  );
                }}
                onClose={() => setRightDrawerMode(null)}
                onStartEditUnit={unitId => setEditingUnitId(unitId)}
                onAutoCenterBlockGenuine={handleAutoCenterSelectedBlock}
                // v0.9.0 Part B — historical library + template files.
                onApplyHistoricalRecipe={handleApplyHistoricalRecipe}
                onExportTemplate={handleExportTemplateRecipe}
                onImportTemplateFile={file => void handleImportTemplateFile(file)}
              />
            </div>
          )}

          {rightDrawerMode === 'ai' && (
            <div
              style={{ width: `${rightDockWidth}px` }}
              className="h-full min-h-0 shrink-0 z-30 shadow-[var(--ui-floating-shadow)] overflow-hidden"
            >
              <AiChatPanel
                isDocked={true}
                onClose={() => setRightDrawerMode(null)}
                onApplyAdjustment={handleApplyAiAdjustment}
                designSettings={designSettings}
                onUpdateDesignSettings={handleUpdateDesignSettings}
                selectedUnitId={selectedUnitId}
                onOpenGeminiKeyModal={() => setIsGeminiKeyModalOpen(true)}
                geminiKeyVersion={geminiKeyVersion}
                onImportCommentaryUnits={(units, title, links) => {
                  setContentUnits(prev => [...prev, ...units]);
                  setRavTextLinks(prev => [...prev, ...(links ?? [])]);
                  showToast(tf('המפרש נוסף לספר: {title}', { title }), 'success');
                }}
                findTextExcerpt={find => {
                  const u = contentUnits.find(x => x.rawText.includes(find));
                  if (!u) return null;
                  const i = u.rawText.indexOf(find);
                  return u.rawText.slice(Math.max(0, i - 40), i + find.length + 40);
                }}
                currentDocumentInfo={{
                  title: documentTitle,
                  layoutPreset: layoutType,
                  kneeJunction: activePage.knee.kneeJunctionY,
                  qualityScore: qaReport.qualityScore,
                }}
              />
            </div>
          )}
        </div>
      )}
      </div>

      {/* 3. Compact Bottom Editorial Status & Navigation Strip */}
      <WorkspaceStatusBar
        activePage={activePage}
        currentPageIndex={safePageIndex}
        totalPages={totalPages}
        onSelectPage={idx => setCurrentPageIndex(idx)}
        zoom={zoom}
        onZoomChange={setZoom}
        layoutType={layoutType}
        totalUnits={validationReport.totalUnits}
        totalLinks={ravTextLinks.length}
        selectedUnitId={selectedUnitId}
        selectedUnitRole={selectedUnit?.role}
        selectedWordText={selectedWordInfo?.wordText}
        hoveredBlock={hoveredBlock}
        qaScore={qaReport.qualityScore}
        qaIssues={qaReport.issues}
        isExportingPdf={isExportingPdf}
        exportProgress={exportProgress}
        designRevision={designSettings.revision}
        lastSavedLabel={undoLabel}
        lastAutosaveTimestamp={lastAutosaveTimestamp}
        isDirty={isDirty}
        recoveredFromAutosave={recoveredFromAutosave}
        onOpenKneeInspector={() => toggleRightDrawer('design', 'rav_text')}
        onOpenRulesModal={() => setIsRulesModalOpen(true)}
        onOpenTests={() => setIsTestPanelOpen(true)}
        developerMode={developerMode}
        onToggleAiChat={() => toggleRightDrawer('ai')}
        isAiChatOpen={rightDrawerMode === 'ai'}
      />

      {/* v0.3.0: search / proofing / QA-fix / overview / suggestion panels */}
      {isSearchOpen && (
        <SearchReplacePanel
          onSearch={handleSearch}
          onJumpToHit={handleJumpToHit}
          onReplaceAll={handleReplaceAll}
          onReplaceOne={handleReplaceOne}
          onClose={() => setIsSearchOpen(false)}
        />
      )}
      {isProofingOpen && (
        <ProofreadingPanel
          issues={textIssues}
          onFixIssue={handleFixIssue}
          onFixGroup={handleFixGroup}
          onClose={() => setIsProofingOpen(false)}
        />
      )}
      {/* v0.9.8 Phase 1 — Developer Mode OFF: the QA-fix panel cannot
          mount even if showQaFixList was somehow set while the mode was
          on (the toolbar button above is gated the same way). */}
      {developerMode && showQaFixList && (
        <div className="fixed bottom-11 left-5 w-[28rem] max-w-[calc(100vw-2.5rem)] max-h-[70vh] overflow-auto bg-[var(--ui-surface)] border border-[var(--ui-border)] shadow-[var(--ui-floating-shadow)] rounded-xl z-50">
          <QaFixList
            issues={qaReport.issues}
            onApplyFix={handleApplyQaFix}
            onClose={() => setShowQaFixList(false)}
            pageNumber={safePageIndex + 1}
          />
        </div>
      )}
      {showSuggestions && (
        <SuggestionReviewPanel
          suggestions={suggestions}
          onApprove={handleApproveSuggestion}
          onReject={handleRejectSuggestion}
          onClose={() => setShowSuggestions(false)}
        />
      )}

      {/* v0.8.1 — the workspace boundary also covers the status bar and
          the floating panels below, so a crash in any of them shows the
          fallback instead of a blank window. */}
      </ErrorBoundary>

      {/* 7. Toast Notification */}
      {notification && (
        <div
          className={`fixed bottom-11 right-5 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-[var(--ui-floating-shadow)] text-xs font-medium border transition-all ${
            notification.type === 'success'
              ? 'bg-[var(--ui-surface)] text-[var(--ui-text-primary)] border-[var(--ui-border)]'
              : notification.type === 'warning'
                ? 'bg-[var(--ui-warning-bg)] text-[var(--ui-warning)] border-[var(--ui-warning)]/35'
                : 'bg-[var(--ui-danger-bg)] text-[var(--ui-danger)] border-[var(--ui-danger)]/35'
          }`}
        >
          {notification.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-[var(--ui-success)] shrink-0" />
          ) : notification.type === 'warning' ? (
            <AlertCircle className="w-4 h-4 text-[var(--ui-warning)] shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-[var(--ui-danger)] shrink-0" />
          )}
          <span>{notification.message}</span>
        </div>
      )}

      {/* 8. PDF Export Loading Overlay */}
      {isExportingPdf && exportProgress && (
        <div className="keter-dialog-backdrop">
          <div className="keter-dialog-surface rounded-xl p-6 max-w-sm w-full flex flex-col items-center text-center space-y-3">
            <Loader2 className="w-8 h-8 text-[var(--ui-accent)] animate-spin" />
            <h3 className="text-sm font-semibold text-[var(--ui-text-primary)]">
              
              {t("מייצא PDF ברזולוציה גבוהה לדפוס")}
            </h3>
            <p className="text-xs text-[var(--ui-text-secondary)]">
              
              {t("מעבד עמוד")} {exportProgress.current}  {t("מתוך")} {exportProgress.total}  {t("באיכות 300 DPI...")}
            </p>
            <div className="w-full bg-[var(--ui-surface-subtle)] rounded-full h-2 overflow-hidden border border-[var(--ui-border)]">
              <div
                className="bg-[var(--ui-accent)] h-full transition-all duration-200 keter-export-bar"
                style={{
                  width: `${Math.round((exportProgress.current / exportProgress.total) * 100)}%`,
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* 9. Modals */}
      {/* v0.4.0: command palette (Ctrl+K, checklist §4) */}
      <CommandPalette
        open={isPaletteOpen}
        onClose={() => setIsPaletteOpen(false)}
        commands={paletteCommands}
      />

      {/* v0.4.0: first-run welcome guide (also reopenable from the header) */}
      {isWelcomeOpen && <WelcomeModal onClose={handleCloseWelcome} />}

      {pendingProtectedAction && (
        <UnsavedChangesModal
          documentTitle={documentTitle}
          actionDescriptionHe={t(pendingProtectedAction.descriptionHe)}
          onSaveAndContinue={async () => {
            const action = pendingProtectedAction.execute;
            setPendingProtectedAction(null);
            const saved = await handleSaveProjectFile();
            if (saved) {
              action();
            }
          }}
          onDiscardAndContinue={() => {
            const action = pendingProtectedAction.execute;
            setPendingProtectedAction(null);
            action();
          }}
          onCancel={() => setPendingProtectedAction(null)}
        />
      )}

      {isNewProjectModalOpen && (
        <NewProjectModal
          onClose={() => setIsNewProjectModalOpen(false)}
          initialMode={newProjectModalInitialMode}
          onCreateProject={handleCreateNewProject}
        />
      )}

      {isContentEditorOpen && (
        <ContentEditorModal
          currentUnits={contentUnits}
          currentTitle={documentTitle}
          layoutType={layoutType}
          onClose={() => setIsContentEditorOpen(false)}
          onSave={handleSaveCustomContent}
        />
      )}

      {isFontScannerOpen && (
        <Suspense fallback={null}>
          <FontScannerPanel
          onClose={() => setIsFontScannerOpen(false)}
          selectedFont={selectedFont}
          onSelectFont={f => {
            setSelectedFont(f);
            setDesignSettings(
              prev =>
                DesignSettingsEngine.updateRoleStyle(
                  prev,
                  'main_source',
                  { character: { fontFamily: f } },
                  'user'
                ).settings
            );
          }}
          selectedRashiFont={selectedRashiFont}
          onSelectRashiFont={f => {
            setSelectedRashiFont(f);
            setDesignSettings(
              prev =>
                DesignSettingsEngine.updateRoleStyle(
                  prev,
                  'primary_comment',
                  { character: { fontFamily: f } },
                  'user'
                ).settings
            );
          }}
          selectedTosafotFont={selectedTosafotFont}
          onSelectTosafotFont={f => {
            setSelectedTosafotFont(f);
            setDesignSettings(
              prev =>
                DesignSettingsEngine.updateRoleStyle(
                  prev,
                  'secondary_comment',
                  { character: { fontFamily: f } },
                  'user'
                ).settings
            );
          }}
          />
        </Suspense>
      )}

      {isDocxModalOpen && (
        <DocxImportModal
          onClose={() => setIsDocxModalOpen(false)}
          onImportUnits={handleImportUnits}
        />
      )}

      {/* v0.9.8 Phase 1 — Developer Mode OFF: the test panel and the
          architecture-report modal cannot mount (their header-menu and
          status-bar entry points are gated the same way). */}
      {developerMode && isTestPanelOpen && (
        <Suspense fallback={null}>
          <AutomatedTestPanel onClose={() => setIsTestPanelOpen(false)} />
        </Suspense>
      )}

      {developerMode && isReportModalOpen && (
        <Suspense fallback={null}>
          <Milestone1ReportModal onClose={() => setIsReportModalOpen(false)} />
        </Suspense>
      )}

      {isGeminiKeyModalOpen && (
        <GeminiKeyModal
          onClose={() => setIsGeminiKeyModalOpen(false)}
          onNotify={showToast}
          onKeyChanged={() => setGeminiKeyVersion(v => v + 1)}
        />
      )}

      {/* v0.7.0 Part 3 (M2) — Vilna Shas verification panel. */}
      {showShasPanel && (
        <ShasQaPanel
          pages={displayPages}
          units={contentUnits}
          links={ravTextLinks}
          layoutType={layoutType}
          diagnostics={displayBookDoc.diagnostics}
          onDiagnosticAction={handleDiagnosticAction}
          onApplyFixes={handleApplyShasFixes}
          onApplyVilnaDefaults={handleApplyVilnaDefaults}
          onClose={() => setShowShasPanel(false)}
        />
      )}
      {isRulesModalOpen && (
        <TypesettingRulesModal
          rulesConfig={rulesConfig}
          projectRules={projectRules}
          localOverrides={localOverrides}
          onUpdateGlobalUserRules={nextRules => {
            setGlobalUserRules(nextRules);
            TypesettingRulesEngine.saveGlobalUserRuleSet({
              rules: nextRules,
              updatedAt: Date.now(),
            });
            showToast(t("חוקי משתמש גלובליים נשמרו בהצלחה!"), 'success');
          }}
          onUpdateProjectRules={nextProjRules => {
            lastActionLabelRef.current = {
              label: t("עדכון חוקי עימוד בפרויקט"),
              key: 'project-rules',
              coalesce: false,
            };
            setProjectRules(nextProjRules);
          }}
          onUpdateLocalOverrides={nextLocalOverrides => {
            lastActionLabelRef.current = {
              label: t("עדכון דריסת חוק מקומית"),
              key: 'local-overrides',
              coalesce: false,
            };
            setLocalOverrides(nextLocalOverrides);
          }}
          onResetGlobalDefaults={() => {
            lastActionLabelRef.current = {
              label: t("איפוס חוקי עימוד לברירת מחדל מקצועית"),
              key: 'reset-rules',
              coalesce: false,
            };
            setGlobalUserRules([]);
            setProjectRules([]);
            setLocalOverrides([]);
            TypesettingRulesEngine.resetGlobalUserRuleSet();
            showToast(t("כל חוקי העימוד אופסו לברירות המחדל המקצועיות!"), 'success');
          }}
          onClose={() => setIsRulesModalOpen(false)}
        />
      )}
    </div>
  );
}
