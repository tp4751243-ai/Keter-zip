/**
 * v0.5.0 Part C — Module 7 (In-Project Secondary Document Import).
 *
 * Pure merge logic for importing an extra .docx (a second commentary,
 * notes, footnotes…) into the project that is already open — WITHOUT
 * resetting anything: the existing units, links, formatting, design
 * settings and unsaved state are never touched except by appending the
 * new units and the confident new links. The caller (App) only has to
 * `setContentUnits(merged.units)` / `setRavTextLinks(merged.links)`;
 * the merge itself never calls `resetForNewProject` and never rebuilds
 * the project snapshot.
 *
 * Linking follows the same rules as the first import (DocxImportModal):
 * - Imported links whose dibbur-hamatchil confidence is >= 0.8 are
 *   applied; anything below that is returned in `uncertainLinks` for
 *   the user to accept / reassign / drop — never applied silently.
 * - When `autoLink` is on, the imported commentaries are also linked
 *   against the EXISTING source units via `autoLinkCommentariesToSource`.
 * - All imported unit/link ids are re-issued, so an imported file can
 *   never collide with (or overwrite) an existing unit.
 */

import { ContentRole, ContentUnit, RavTextLink } from '../types/typesetter';
import {
  DocxImporter,
  DocxImportResult,
  flagUncertainMatches,
} from './docx-importer';
// v0.9.8 Phase 5 — the new linker is wired here too (Phase 3 left this
// file on the old linker only). Same pattern as the main hub: run the new
// engine after the old one, merge (higher confidence wins), stamp
// `anchorLink` on the linked units; wrapped so the new engine can never
// break a secondary import (the old linker's output stands on failure).
import {
  anchorLinksToRavTextLinks,
  linkCommentariesToSource,
  mergeLinkSets,
} from './commentary-linker';

/** The tier the user assigns the secondary import to. */
export type SecondaryImportTier =
  | 'main_text'
  | 'first_commentary'
  | 'second_commentary'
  | 'footnote';

export const SECONDARY_IMPORT_TIER_ROLES: Record<SecondaryImportTier, ContentRole> = {
  main_text: 'main_source',
  first_commentary: 'primary_comment',
  second_commentary: 'secondary_comment',
  footnote: 'footnote',
};

export const SECONDARY_IMPORT_TIER_LABELS_HE: Record<SecondaryImportTier, string> = {
  main_text: 'טקסט ראשי',
  first_commentary: 'פירוש ראשון (רש״י)',
  second_commentary: 'פירוש שני (תוספות)',
  footnote: 'הערות שוליים',
};

export const SECONDARY_IMPORT_TIER_LABELS_EN: Record<SecondaryImportTier, string> = {
  main_text: 'Main text',
  first_commentary: 'First commentary (Rashi)',
  second_commentary: 'Second commentary (Tosafot)',
  footnote: 'Footnotes',
};

export interface SecondaryImportOptions {
  /** Tier/role the whole import is assigned to (overrides auto-detect). */
  targetTier?: SecondaryImportTier;
  /** Link imported commentaries against the existing source text. */
  autoLink?: boolean;
}

export interface SecondaryImportMergeResult {
  /** Existing units + the imported units, in book order. */
  units: ContentUnit[];
  /** Existing links + the confident new links. */
  links: RavTextLink[];
  /** Imported units, with their new ids. */
  addedUnits: ContentUnit[];
  /** Confident links that were applied. */
  appliedLinks: RavTextLink[];
  /** Links held back for manual review (confidence < 0.8). */
  uncertainLinks: RavTextLink[];
  /** Existing source units the import was linked against (for the UI). */
  linkableSources: ContentUnit[];
  summaryHe: string;
  summaryEn: string;
}

function reissueId(prefix: string, index: number): string {
  return `${prefix}-${Date.now().toString(36)}-${index}`;
}

/**
 * Merges one already-parsed .docx result into the live project.
 * Pure: inputs are never mutated; the returned arrays are new objects.
 */
export function mergeSecondaryImport(
  existingUnits: ContentUnit[],
  existingLinks: RavTextLink[],
  imported: DocxImportResult,
  options: SecondaryImportOptions = {}
): SecondaryImportMergeResult {
  const targetRole = options.targetTier
    ? SECONDARY_IMPORT_TIER_ROLES[options.targetTier]
    : undefined;
  const autoLink = options.autoLink ?? true;

  const maxOrder = existingUnits.reduce((m, u) => Math.max(m, u.order ?? 0), 0);
  const idMap = new Map<string, string>();
  imported.units.forEach((u, i) => {
    idMap.set(u.id, reissueId('sec', i));
  });

  const addedUnits: ContentUnit[] = imported.units.map((u, i) => {
    const nextId = idMap.get(u.id)!;
    // Body-text units take the assigned tier; tables/images keep their role,
    // and a footnote file's own footnote units stay footnotes.
    const isBodyText =
      u.role === 'main_source' ||
      u.role === 'regular_paragraph' ||
      u.role === 'primary_comment' ||
      u.role === 'secondary_comment' ||
      u.role === 'tertiary_comment';
    const nextRole: ContentRole =
      targetRole && (isBodyText || targetRole === 'footnote') ? targetRole : u.role;
    const roleChanged = nextRole !== u.role;
    return {
      ...JSON.parse(JSON.stringify(u)) as ContentUnit,
      id: nextId,
      role: nextRole,
      order: maxOrder + i + 1,
      // Re-point every in-unit reference at the re-issued ids.
      linkedSourceId: u.linkedSourceId ? idMap.get(u.linkedSourceId) ?? u.linkedSourceId : undefined,
      linkedCommentaryIds: u.linkedCommentaryIds?.map(
        id => idMap.get(id) ?? id
      ),
      footnoteAnchorUnitId: u.footnoteAnchorUnitId
        ? idMap.get(u.footnoteAnchorUnitId) ?? u.footnoteAnchorUnitId
        : undefined,
      // Footnote anchors inside the runs point at the re-issued footnote ids.
      textRuns: (roleChanged
        ? DocxImporter.buildRunsFromRawText(u.rawText, nextRole, u.dibburHamatchil)
        : u.textRuns
      )?.map(r => ({
        ...r,
        footnoteUnitId: r.footnoteUnitId
          ? idMap.get(r.footnoteUnitId) ?? r.footnoteUnitId
          : undefined,
      })),
    };
  });

  const units = [...existingUnits, ...addedUnits];

  // --- Links: re-issue ids, keep only confident ones -----------------------
  const remappedImportedLinks: RavTextLink[] = imported.links.map((l, i) => ({
    ...JSON.parse(JSON.stringify(l)) as RavTextLink,
    linkId: reissueId('link-sec', i),
    sourceUnitId: idMap.get(l.sourceUnitId) ?? l.sourceUnitId,
    commentaryUnitId: idMap.get(l.commentaryUnitId) ?? l.commentaryUnitId,
  }));

  const existingSources = existingUnits.filter(
    u => u.role === 'main_source' || u.role === 'chapter' || u.role === 'verse'
  );
  const importedCommentaries = addedUnits.filter(
    u =>
      u.role === 'primary_comment' ||
      u.role === 'secondary_comment' ||
      u.role === 'tertiary_comment'
  );

  let discoveredLinks: RavTextLink[] = [];
  if (autoLink && importedCommentaries.length > 0 && existingSources.length > 0) {
    discoveredLinks = DocxImporter.autoLinkCommentariesToSource(
      existingSources,
      importedCommentaries
    );
    // v0.9.8 Phase 5 — new CommentaryLinkerEngine over the same pair
    // (fuzzy, nikud-free, sliding-window); merged below with the old
    // links, higher confidence wins. Best-effort: any failure here
    // leaves the old linker's output untouched.
    try {
      const newAnchorLinks = linkCommentariesToSource(
        existingSources,
        importedCommentaries
      );
      const newRavLinks = anchorLinksToRavTextLinks(
        newAnchorLinks,
        [...existingSources, ...importedCommentaries]
      );
      discoveredLinks = mergeLinkSets(newRavLinks, discoveredLinks);
      const byId = new Map(newAnchorLinks.map(a => [a.commentaryUnitId, a]));
      for (const u of importedCommentaries) {
        const a = byId.get(u.id);
        if (a && a.targetMainNodeId) u.anchorLink = a;
      }
    } catch {
      // Old linker's output stands.
    }
  }

  // A link is only "new" when its (source, commentary) pair is not already linked.
  const existingPairs = new Set(
    existingLinks.map(l => `${l.sourceUnitId}→${l.commentaryUnitId}`)
  );
  const candidateLinks = [...remappedImportedLinks, ...discoveredLinks].filter(
    l => !existingPairs.has(`${l.sourceUnitId}→${l.commentaryUnitId}`)
  );
  const uncertainLinks = flagUncertainMatches(candidateLinks);
  const uncertainIds = new Set(uncertainLinks.map(l => l.linkId));
  const appliedLinks = candidateLinks.filter(l => !uncertainIds.has(l.linkId));

  const links = [...existingLinks, ...appliedLinks];

  return {
    units,
    links,
    addedUnits,
    appliedLinks,
    uncertainLinks,
    linkableSources: existingSources,
    summaryHe: `נוספו ${addedUnits.length} קטעים מהמסמך המשני, וקושרו ${appliedLinks.length} קישורי דיבור המתחיל.`,
    summaryEn: `Added ${addedUnits.length} passages from the secondary document and linked ${appliedLinks.length} dibbur-hamatchil links.`,
  };
}

/**
 * Completes a merge held in review: returns the final link list for the
 * uncertain links the user explicitly accepted (or reassigned to another
 * source unit). Undecided / dropped links are never added.
 */
export function finalizeSecondaryImportReview(
  baseLinks: RavTextLink[],
  uncertainLinks: RavTextLink[],
  decisions: Record<string, 'accepted' | 'dropped'>,
  reassignTo?: Record<string, string>,
  linkableSources?: ContentUnit[]
): RavTextLink[] {
  const finalLinks = [...baseLinks];
  for (const link of uncertainLinks) {
    const action = decisions[link.linkId];
    if (action === 'accepted') {
      finalLinks.push({ ...link, isUserLocked: true });
    } else if (reassignTo?.[link.linkId]) {
      const newSrc = linkableSources?.find(s => s.id === reassignTo[link.linkId]);
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
    // 'dropped' and undecided: never added.
  }
  return finalLinks;
}
