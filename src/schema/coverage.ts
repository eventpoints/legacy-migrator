import type { RequirementsDocument, SourceRef } from "./requirements.js";

/**
 * Extraction coverage.
 *
 * The completeness of a requirements document cannot be verified by human
 * review alone: a reviewer cannot spot a rule that was silently never written
 * down (an error of omission). So we measure completeness mechanically instead.
 *
 * Every node in the document links DOWN to the legacy source lines it was
 * derived from. Inverting those links tells us, for each file, which lines are
 * "claimed" by at least one requirement. The UNCLAIMED lines are the gap — the
 * exact functions we failed to understand, and where missed edge cases live.
 *
 * Coverage is also the convergence signal for the extraction loop: keep
 * extracting until claimed coverage crosses a threshold and the unclaimed
 * remainder is confirmed dead code.
 *
 * Note: v0 counts raw line ranges. A later pass should restrict the denominator
 * to executable lines (excluding blanks/comments) using the AST, so coverage
 * reflects understood *behavior*, not understood *text*.
 */

export interface LineRange {
  startLine: number;
  endLine: number;
}

export interface FileCoverage {
  file: string;
  totalLines: number;
  claimedLines: number;
  /** claimedLines / totalLines, 0..1. */
  coverage: number;
  /** Line ranges no requirement points at — the completeness gap. */
  unclaimedRanges: LineRange[];
}

export interface CoverageReport {
  generatedAt: string;
  /** Total claimed lines / total lines across all known files. */
  overall: number;
  claimedLines: number;
  totalLines: number;
  /** Sorted worst-covered first — the work queue for the extraction loop. */
  files: FileCoverage[];
}

/** Collect every SourceRef in the document, regardless of nesting depth. */
export function collectSourceRefs(doc: RequirementsDocument): SourceRef[] {
  const refs: SourceRef[] = [];
  for (const slice of doc.slices) {
    refs.push(...slice.sourceRefs);
    for (const feature of slice.features) {
      refs.push(...feature.sourceRefs);
      for (const rule of feature.rules) {
        refs.push(...rule.sourceRefs);
      }
    }
  }
  return refs;
}

/** Merge overlapping/adjacent inclusive line ranges into a minimal set. */
export function mergeRanges(ranges: LineRange[]): LineRange[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.startLine - b.startLine);
  const merged: LineRange[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const cur = sorted[i];
    // adjacent (cur.start <= last.end + 1) counts as contiguous
    if (cur.startLine <= last.endLine + 1) {
      last.endLine = Math.max(last.endLine, cur.endLine);
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

function countLines(ranges: LineRange[]): number {
  return ranges.reduce((sum, r) => sum + (r.endLine - r.startLine + 1), 0);
}

/** Invert a set of claimed ranges into the gaps within [1, totalLines]. */
export function invertRanges(
  claimed: LineRange[],
  totalLines: number,
): LineRange[] {
  const gaps: LineRange[] = [];
  let cursor = 1;
  for (const r of claimed) {
    const start = Math.max(r.startLine, 1);
    if (start > cursor) {
      gaps.push({ startLine: cursor, endLine: Math.min(start - 1, totalLines) });
    }
    cursor = Math.max(cursor, Math.min(r.endLine, totalLines) + 1);
    if (cursor > totalLines) break;
  }
  if (cursor <= totalLines) {
    gaps.push({ startLine: cursor, endLine: totalLines });
  }
  return gaps;
}

/**
 * Compute coverage of the legacy codebase by the requirements document.
 *
 * @param doc            the requirements artifact
 * @param fileLineCounts map of repo-relative file path -> total line count.
 *                       Files present here but unreferenced by any SourceRef
 *                       show as 0% covered (entirely unclaimed).
 */
export function computeCoverage(
  doc: RequirementsDocument,
  fileLineCounts: Record<string, number>,
): CoverageReport {
  const byFile = new Map<string, LineRange[]>();
  for (const ref of collectSourceRefs(doc)) {
    const list = byFile.get(ref.file) ?? [];
    list.push({ startLine: ref.startLine, endLine: ref.endLine });
    byFile.set(ref.file, list);
  }

  const files: FileCoverage[] = [];
  let totalLines = 0;
  let claimedTotal = 0;

  for (const [file, total] of Object.entries(fileLineCounts)) {
    const rawClaimed = byFile.get(file) ?? [];
    // clamp claimed ranges to the file's actual extent before merging
    const clamped = rawClaimed
      .map((r) => ({
        startLine: Math.max(1, Math.min(r.startLine, total)),
        endLine: Math.max(1, Math.min(r.endLine, total)),
      }))
      .filter((r) => total > 0);
    const merged = mergeRanges(clamped);
    const claimed = countLines(merged);
    const unclaimedRanges = invertRanges(merged, total);

    files.push({
      file,
      totalLines: total,
      claimedLines: claimed,
      coverage: total > 0 ? claimed / total : 0,
      unclaimedRanges,
    });
    totalLines += total;
    claimedTotal += claimed;
  }

  files.sort((a, b) => a.coverage - b.coverage);

  return {
    generatedAt: new Date().toISOString(),
    overall: totalLines > 0 ? claimedTotal / totalLines : 0,
    claimedLines: claimedTotal,
    totalLines,
    files,
  };
}
