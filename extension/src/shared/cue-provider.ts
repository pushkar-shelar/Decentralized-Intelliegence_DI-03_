import type { Cue } from './cue';

/**
 * The seam between "where cues come from" and "how cues are rendered".
 * Phase 1: DemoCueProvider. Phase 2+: the real CueStore (captions / STT).
 */
export interface CueProvider {
  /** Return the cue active at the given video time, or null. Must be cheap — called every frame. */
  getActiveCue(videoTime: number): Cue | null;
  /** Return all cues active at the given video time (useful for multiple concurrent speakers). */
  getActiveCues?(videoTime: number): Cue[];
  /** Optional: record when a finalized cue is first displayed on screen (video time s). */
  recordFirstShown?(id: string, videoTime: number): void;
  /** Optional: subscribe to cue-set changes (new/revised cues) so the overlay can re-evaluate while paused. */
  subscribe?(listener: () => void): () => void;
}
