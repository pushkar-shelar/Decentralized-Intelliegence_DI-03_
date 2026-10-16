import { describe, expect, it } from 'vitest';
import { AnchorLog } from '../src/audio/anchor-log';

describe('AnchorLog', () => {
  it('maps audio chunk at standard 1.0x rate accurately', () => {
    const log = new AnchorLog();
    log.addAnchor({ perfNow: 1000, videoTime: 10.0, rate: 1.0, paused: false });

    // Chunk captured at 1100ms (100ms later), with 200ms audio duration
    const span = log.mapSpan(1100, 200);
    expect(span.videoStart).toBeCloseTo(10.1, 2);
    expect(span.videoEnd).toBeCloseTo(10.3, 2);
    expect(span.paused).toBe(false);
    expect(span.isDiscontinuous).toBe(false);
  });

  it('correctly scales video time interval under 2.0x speed', () => {
    const log = new AnchorLog();
    log.addAnchor({ perfNow: 2000, videoTime: 20.0, rate: 2.0, paused: false });

    // 200ms of audio played at 2x spans 400ms of video time
    const span = log.mapSpan(2000, 200);
    expect(span.videoStart).toBe(20.0);
    expect(span.videoEnd).toBe(20.4);
    expect(span.rate).toBe(2.0);
  });

  it('correctly scales video time interval under 0.5x speed', () => {
    const log = new AnchorLog();
    log.addAnchor({ perfNow: 3000, videoTime: 30.0, rate: 0.5, paused: false });

    // 200ms of audio played at 0.5x spans 100ms of video time
    const span = log.mapSpan(3000, 200);
    expect(span.videoStart).toBe(30.0);
    expect(span.videoEnd).toBe(30.1);
    expect(span.rate).toBe(0.5);
  });

  it('flags discontinuous state when playback is paused', () => {
    const log = new AnchorLog();
    log.addAnchor({ perfNow: 5000, videoTime: 45.0, rate: 1.0, paused: true });

    const span = log.mapSpan(5200, 200);
    expect(span.paused).toBe(true);
    expect(span.isDiscontinuous).toBe(true);
    expect(span.videoStart).toBe(45.0);
    expect(span.videoEnd).toBe(45.0);
  });

  it('flags discontinuous state when a seek is recorded', () => {
    const log = new AnchorLog();
    log.addAnchor({ perfNow: 8000, videoTime: 120.0, rate: 1.0, paused: false, isSeek: true });

    const span = log.mapSpan(8000, 200);
    expect(span.isDiscontinuous).toBe(true);
    expect(span.videoStart).toBe(120.0);
  });
});
