export interface VideoAnchor {
  /** Timestamp from performance.now() in milliseconds. */
  perfNow: number;
  /** video.currentTime in seconds. */
  videoTime: number;
  /** video.playbackRate (e.g. 1.0, 1.5, 2.0). */
  rate: number;
  /** video.paused boolean. */
  paused: boolean;
  /** True if a seek occurred right before or at this anchor. */
  isSeek?: boolean;
}

export interface InterpolatedVideoSpan {
  videoStart: number;
  videoEnd: number;
  rate: number;
  paused: boolean;
  isDiscontinuous: boolean;
}

/**
 * Maps audio capture timestamps (performance.now()) to exact video playback intervals.
 * Handles variable playback rates, pauses, and seeking smoothly without drift.
 */
export class AnchorLog {
  private anchors: VideoAnchor[] = [];
  private readonly maxAnchors: number;

  constructor(maxAnchors = 100) {
    this.maxAnchors = maxAnchors;
  }

  get length(): number {
    return this.anchors.length;
  }

  addAnchor(anchor: VideoAnchor): void {
    // Keep chronologically sorted by perfNow
    const last = this.anchors[this.anchors.length - 1];
    if (last && anchor.perfNow < last.perfNow) {
      // Out of order: insertion sort
      let idx = this.anchors.length - 1;
      while (idx >= 0 && this.anchors[idx]!.perfNow > anchor.perfNow) {
        idx--;
      }
      this.anchors.splice(idx + 1, 0, anchor);
    } else {
      this.anchors.push(anchor);
    }

    if (this.anchors.length > this.maxAnchors) {
      this.anchors.shift();
    }
  }

  /**
   * Given an audio chunk's capture start time and duration (in milliseconds of audio),
   * maps it to the exact video interval [videoStart, videoEnd].
   */
  mapSpan(capturePerfNow: number, durationMs: number): InterpolatedVideoSpan {
    const defaultRate = 1.0;
    if (this.anchors.length === 0) {
      const vStart = 0;
      const vEnd = Number((durationMs / 1000).toFixed(3));
      return { videoStart: vStart, videoEnd: vEnd, rate: defaultRate, paused: false, isDiscontinuous: true };
    }

    // Find the closest anchor at or before capturePerfNow
    let bestAnchor: VideoAnchor = this.anchors[0]!;
    for (let i = this.anchors.length - 1; i >= 0; i--) {
      const a = this.anchors[i]!;
      if (a.perfNow <= capturePerfNow) {
        bestAnchor = a;
        break;
      }
    }

    if (bestAnchor.paused) {
      return {
        videoStart: Number(bestAnchor.videoTime.toFixed(3)),
        videoEnd: Number(bestAnchor.videoTime.toFixed(3)),
        rate: bestAnchor.rate,
        paused: true,
        isDiscontinuous: true,
      };
    }

    const elapsedWallSec = Math.max(0, (capturePerfNow - bestAnchor.perfNow) / 1000);
    const videoDurationSec = (durationMs / 1000) * bestAnchor.rate;

    const videoStart = Number((bestAnchor.videoTime + elapsedWallSec * bestAnchor.rate).toFixed(3));
    const videoEnd = Number((videoStart + videoDurationSec).toFixed(3));

    return {
      videoStart,
      videoEnd,
      rate: bestAnchor.rate,
      paused: false,
      isDiscontinuous: !!bestAnchor.isSeek,
    };
  }

  clear(): void {
    this.anchors = [];
  }
}
