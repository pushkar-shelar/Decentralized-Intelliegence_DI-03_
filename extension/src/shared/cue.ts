/**
 * Normalized subtitle cue — mirrors shared/schema/cue.schema.json.
 * All times are VIDEO seconds (player currentTime), never audio-chunk time.
 */
export type CueSource = 'captions' | 'stt' | 'demo';

export interface CueRevision {
  /** Video time (s) when this revision was received. */
  at: number;
  text: string;
}

export interface Cue {
  id: string;
  start: number;
  end: number;
  lang: string;
  text: string;
  translation?: string | null;
  translation_lang?: string | null;
  source: CueSource;
  /** Speaker label from diarization (Phase 6.5). */
  speaker?: string | null;
  /** False while an STT hypothesis may still change. */
  is_final?: boolean;
  first_shown_at?: number | null;
  revisions: CueRevision[];
}
