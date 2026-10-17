import type { Cue } from '../shared/cue';
import type { CueProvider } from '../shared/cue-provider';

/**
 * High-performance indexed Cue timeline.
 * Stores cues sorted by `start` time and executes O(log N) binary search
 * to determine the active cue at any given video timestamp.
 *
 * Implements CueProvider so it directly plugs into SubtitleOverlay.
 */
export class CueStore implements CueProvider {
  private cues: Cue[] = [];
  private idMap = new Map<string, Cue>();
  private listeners = new Set<() => void>();

  get length(): number {
    return this.cues.length;
  }

  /**
   * Return the cue active at the specified video time (s), or null if none.
   * If multiple cues overlap, returns the one that started most recently.
   * O(log N) complexity.
   */
  getActiveCue(videoTime: number, allowLinger = true): Cue | null {
    const list = this.cues;
    const n = list.length;
    if (n === 0 || !Number.isFinite(videoTime) || videoTime < 0) return null;

    // Fast boundary check
    const first = list[0];
    if (first && videoTime < first.start) return null;

    // Binary search for the rightmost cue with start <= videoTime
    let low = 0;
    let high = n - 1;
    let candidateIndex = -1;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const c = list[mid];
      if (!c) break;

      if (c.start <= videoTime) {
        candidateIndex = mid;
        low = mid + 1; // look for later matching starts
      } else {
        high = mid - 1;
      }
    }

    if (candidateIndex === -1) return null;

    // 1. Direct hit: scan back for any cue strictly active at videoTime [start, end)
    for (let i = candidateIndex; i >= 0; i--) {
      const c = list[i];
      if (!c) continue;
      if (videoTime - c.start > 60) break;
      if (videoTime >= c.start && videoTime < c.end) {
        return c;
      }
    }

    // 2. Lingering hold: Keep the most recent subtitle visible a little longer
    // until the next subtitle time comes (with a max hold cap of 4.0s).
    if (allowLinger) {
      const candidate = list[candidateIndex];
      if (candidate && videoTime >= candidate.end) {
        const nextCue = list[candidateIndex + 1];
        const nextStart = nextCue ? nextCue.start : Infinity;
        const MAX_LINGER_SEC = 4.0;
        if (videoTime < nextStart && (videoTime - candidate.end) <= MAX_LINGER_SEC) {
          return candidate;
        }
      }
    }

    return null;
  }

  /**
   * Return all cues active at videoTime (useful if dual lines or multiple tracks overlap).
   */
  getActiveCues(videoTime: number): Cue[] {
    const active: Cue[] = [];
    const list = this.cues;
    const n = list.length;
    if (n === 0 || !Number.isFinite(videoTime) || videoTime < 0) return active;

    let low = 0;
    let high = n - 1;
    let candidateIndex = -1;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const c = list[mid];
      if (!c) break;
      if (c.start <= videoTime) {
        candidateIndex = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    if (candidateIndex === -1) return active;

    for (let i = candidateIndex; i >= 0; i--) {
      const c = list[i];
      if (!c) continue;
      if (videoTime - c.start > 60) break;
      if (videoTime >= c.start && videoTime < c.end) {
        active.unshift(c);
      }
    }

    return active;
  }

  /**
   * Load multiple cues at once (e.g., from YouTube timedtext or an SRT file).
   * Deduplicates by id, sorts chronologically, and notifies subscribers.
   */
  loadCues(incoming: Cue[]): void {
    if (incoming.length === 0) return;

    for (const cue of incoming) {
      const existing = this.idMap.get(cue.id);
      const normalized: Cue = {
        ...cue,
        revisions:
          cue.revisions && cue.revisions.length > 0
            ? [...cue.revisions]
            : [{ at: cue.start, text: cue.text }],
        first_shown_at: cue.first_shown_at ?? null,
      };

      if (existing) {
        Object.assign(existing, normalized);
      } else {
        this.cues.push(normalized);
        this.idMap.set(normalized.id, normalized);
      }
    }

    this.sort();
    this.notify();
  }

  /**
   * Insert or update an individual cue in place.
   * Merges revisions and maintains chronological order.
   * Essential for live STT hypotheses (Phase 4).
   */
  upsertCue(cue: Cue): void {
    const existing = this.idMap.get(cue.id);
    if (existing) {
      const textChanged = existing.text !== cue.text;
      existing.text = cue.text;
      existing.end = cue.end;
      if (cue.translation !== undefined) existing.translation = cue.translation;
      if (cue.translation_lang !== undefined) existing.translation_lang = cue.translation_lang;
      if (cue.speaker !== undefined && (cue.speaker !== null || existing.speaker === undefined)) {
        existing.speaker = cue.speaker;
      }
      if (cue.is_final !== undefined) existing.is_final = cue.is_final;
      if (cue.first_shown_at !== undefined && cue.first_shown_at !== null) {
        existing.first_shown_at = cue.first_shown_at;
      }

      // Merge new revisions
      if (cue.revisions && cue.revisions.length > 0) {
        for (const rev of cue.revisions) {
          if (!existing.revisions.some((r) => r.at === rev.at && r.text === rev.text)) {
            existing.revisions.push(rev);
          }
        }
      } else if (textChanged) {
        // Record automatic revision if text changed without explicit revisions array
        existing.revisions.push({ at: cue.start, text: cue.text });
      }

      // If start changed, re-sort
      if (existing.start !== cue.start) {
        existing.start = cue.start;
        this.sort();
      }
    } else {
      const toInsert: Cue = {
        ...cue,
        first_shown_at: cue.first_shown_at ?? null,
        revisions:
          cue.revisions && cue.revisions.length > 0
            ? [...cue.revisions]
            : [{ at: cue.start, text: cue.text }],
      };
      this.cues.push(toInsert);
      this.idMap.set(toInsert.id, toInsert);
      this.sort();
    }

    this.notify();
  }

  /**
   * Explicitly record a text change revision for a cue.
   */
  recordRevision(id: string, at: number, text: string): void {
    const cue = this.idMap.get(id);
    if (!cue) return;
    if (cue.text !== text) {
      cue.text = text;
      cue.revisions.push({ at: Number(at.toFixed(3)), text });
      this.notify();
    }
  }

  /**
   * Record the video time (s) when a cue's final text was first displayed on screen.
   * Only records once (subsequent renders preserve original first_shown_at).
   */
  recordFirstShown(id: string, videoTime: number): void {
    const cue = this.idMap.get(id);
    if (cue && cue.first_shown_at == null) {
      cue.first_shown_at = Number(videoTime.toFixed(3));
    }
  }

  /**
   * Read-only snapshot of all currently stored cues.
   */
  getCues(): readonly Cue[] {
    return this.cues;
  }

  /**
   * Clear the timeline (invoked on navigation or session reset).
   */
  clear(): void {
    if (this.cues.length === 0) return;
    this.cues = [];
    this.idMap.clear();
    this.notify();
  }

  /**
   * Subscribe to timeline updates (new cues loaded or revisions updated).
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private sort(): void {
    this.cues.sort((a, b) => a.start - b.start || a.end - b.end);
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }
}
