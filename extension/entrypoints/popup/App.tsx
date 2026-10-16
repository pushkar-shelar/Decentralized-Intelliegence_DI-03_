import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { browser } from 'wxt/browser';
import {
  DEFAULT_SETTINGS,
  LANGUAGES,
  LIMITS,
  loadSettings,
  saveSettings,
  type DisplayMode,
  type LiveSubSettings,
} from '../../src/settings/settings';
import { parseVideoId } from '../../src/youtube/video-id';

type TabStatus = { kind: 'loading' } | { kind: 'video'; videoId: string } | { kind: 'other' };

const DISPLAY_MODES: Array<{ value: DisplayMode; label: string }> = [
  { value: 'original', label: 'Original' },
  { value: 'translated', label: 'Translated' },
  { value: 'dual', label: 'Dual' },
];

const PREVIEW_TEXT: Record<string, string> = {
  en: 'Today we will make paneer tikka',
  hi: 'आज हम पनीर टिक्का बनाएंगे',
  mr: 'आज आपण पनीर टिक्का बनवूया',
  ta: 'இன்று நாம் பனீர் டிக்கா செய்வோம்',
  te: 'ఈ రోజు మనం పనీర్ టిక్కా చేద్దాం',
};

export default function App() {
  const [settings, setSettings] = useState<LiveSubSettings | null>(null);
  const [tab, setTab] = useState<TabStatus>({ kind: 'loading' });

  useEffect(() => {
    // The popup is the only writer of settings, so it doesn't subscribe to its own storage echoes
    // (stale echoes during a slider drag would make the thumb jump back).
    void loadSettings().then(setSettings);
    void browser.tabs.query({ active: true, currentWindow: true }).then(([active]) => {
      const videoId = active?.url ? parseVideoId(active.url) : null;
      setTab(videoId ? { kind: 'video', videoId } : { kind: 'other' });
    });
  }, []);

  if (!settings) return <div className="app app--loading" aria-busy="true" />;

  const update = (patch: Partial<LiveSubSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next); // optimistic
    void saveSettings(next); // full snapshot → last write always wins with complete state
  };

  return (
    <main className={`app ${settings.enabled ? '' : 'app--disabled'}`}>
      <header className="header">
        <div className="brand">
          <div className="brand__logo" aria-hidden="true">
            <span />
            <span />
          </div>
          <div>
            <h1 className="brand__name">LiveSub</h1>
            <p className="brand__tag">Real-time multilingual subtitles</p>
          </div>
        </div>
        <Toggle
          id="toggle-enabled"
          checked={settings.enabled}
          onChange={(enabled) => update({ enabled })}
          label="Enable LiveSub"
        />
      </header>

      <StatusChip tab={tab} enabled={settings.enabled} />

      <Preview settings={settings} />

      <Section title="Languages">
        <div className="row row--split">
          <Field label="Spoken" htmlFor="select-source">
            <select
              id="select-source"
              className="select"
              value={settings.sourceLang}
              onChange={(e) => update({ sourceLang: e.target.value as LiveSubSettings['sourceLang'] })}
            >
              <option value="auto">Auto-detect</option>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label} · {l.native}
                </option>
              ))}
            </select>
          </Field>
          <span className="arrow" aria-hidden="true">
            →
          </span>
          <Field label="Translate to" htmlFor="select-target">
            <select
              id="select-target"
              className="select"
              value={settings.targetLang}
              onChange={(e) => update({ targetLang: e.target.value as LiveSubSettings['targetLang'] })}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label} · {l.native}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      <Section title="Display">
        <div className="segmented" role="radiogroup" aria-label="Display mode">
          {DISPLAY_MODES.map((m) => (
            <button
              key={m.value}
              id={`mode-${m.value}`}
              type="button"
              role="radio"
              aria-checked={settings.displayMode === m.value}
              className={`segmented__item ${settings.displayMode === m.value ? 'is-active' : ''}`}
              onClick={() => update({ displayMode: m.value })}
            >
              {m.label}
            </button>
          ))}
          <span
            className="segmented__thumb"
            style={{ '--index': DISPLAY_MODES.findIndex((m) => m.value === settings.displayMode) } as CSSProperties}
            aria-hidden="true"
          />
        </div>
      </Section>

      <Section title="Style">
        <Slider
          id="slider-font"
          label="Font size"
          value={settings.fontSize}
          min={LIMITS.fontSize.min}
          max={LIMITS.fontSize.max}
          step={1}
          format={(v) => `${v}px`}
          onChange={(fontSize) => update({ fontSize })}
        />
        <Slider
          id="slider-bg"
          label="Background"
          value={settings.bgOpacity}
          min={LIMITS.bgOpacity.min}
          max={LIMITS.bgOpacity.max}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(bgOpacity) => update({ bgOpacity })}
        />
        <Slider
          id="slider-position"
          label="Height"
          value={settings.position}
          min={LIMITS.position.min}
          max={LIMITS.position.max}
          step={1}
          format={(v) => `${v}%`}
          onChange={(position) => update({ position })}
        />
      </Section>

      <Section title="Developer">
        <div className="row row--between">
          <div>
            <div className="label-strong">Demo cues</div>
            <div className="hint">Sample subtitles driven by video time (Phase 1)</div>
          </div>
          <Toggle
            id="toggle-demo"
            small
            checked={settings.demoMode}
            onChange={(demoMode) => update({ demoMode })}
            label="Demo cues"
          />
        </div>
      </Section>

      <footer className="footer">
        <button id="btn-reset" type="button" className="link" onClick={() => update({ ...DEFAULT_SETTINGS })}>
          Reset to defaults
        </button>
        <span className="version">v{browser.runtime.getManifest().version} · Phase 1</span>
      </footer>
    </main>
  );
}

function StatusChip({ tab, enabled }: { tab: TabStatus; enabled: boolean }) {
  let state: 'live' | 'idle' | 'off' = 'idle';
  let text = 'Checking current tab…';
  if (!enabled) {
    state = 'off';
    text = 'Paused — subtitles hidden';
  } else if (tab.kind === 'video') {
    state = 'live';
    text = `Active on video ${tab.videoId}`;
  } else if (tab.kind === 'other') {
    text = 'Open a YouTube video to start';
  }
  return (
    <div className={`status status--${state}`} role="status">
      <span className="status__dot" aria-hidden="true" />
      {text}
    </div>
  );
}

function Preview({ settings }: { settings: LiveSubSettings }) {
  const target = settings.targetLang;
  const source = settings.sourceLang === 'auto' ? (target === 'hi' ? 'en' : 'hi') : settings.sourceLang;
  const defaultText = 'Today we will make paneer tikka';
  const original = PREVIEW_TEXT[source] ?? defaultText;
  const translated = source === target ? null : (PREVIEW_TEXT[target] ?? null);

  const lines: Array<{ kind: string; text: string }> = [];
  if (settings.displayMode !== 'translated' || !translated) lines.push({ kind: 'original', text: original });
  if (settings.displayMode !== 'original' && translated) lines.push({ kind: 'translation', text: translated });

  // Preview frame is ~180px tall; scale font relative to the 720px reference the overlay uses.
  const style = {
    '--pv-font': `${(settings.fontSize * 0.42).toFixed(1)}px`,
    '--pv-bg': settings.bgOpacity,
    '--pv-bottom': `${settings.position}%`,
  } as CSSProperties;

  return (
    <div className="preview" style={style} aria-label="Subtitle preview">
      <div className="preview__scene" aria-hidden="true">
        <span className="preview__orb preview__orb--a" />
        <span className="preview__orb preview__orb--b" />
      </div>
      {settings.enabled && (
        <div className="preview__subs">
          {lines.map((l) => (
            <span key={l.kind} className={`preview__line preview__line--${l.kind}`}>
              {l.text}
            </span>
          ))}
        </div>
      )}
      <div className="preview__bar" aria-hidden="true">
        <span className="preview__progress" />
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card">
      <h2 className="card__title">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}

function Toggle(props: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  small?: boolean;
}) {
  return (
    <button
      id={props.id}
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      className={`toggle ${props.small ? 'toggle--small' : ''} ${props.checked ? 'is-on' : ''}`}
      onClick={() => props.onChange(!props.checked)}
    >
      <span className="toggle__knob" />
    </button>
  );
}

function Slider(props: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const pct = ((props.value - props.min) / (props.max - props.min)) * 100;
  return (
    <div className="slider">
      <div className="slider__head">
        <label htmlFor={props.id}>{props.label}</label>
        <output htmlFor={props.id}>{props.format(props.value)}</output>
      </div>
      <input
        id={props.id}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        style={{ '--pct': `${pct}%` } as CSSProperties}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </div>
  );
}
