// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * The right panel's Settings tab: global editor settings (color theme, zoom, updates, export), saved to settings.json
 * at once.
 */
import {
  zoomStep,
  ZOOM_MAX,
  ZOOM_MIN,
  type AppearanceChoice,
  type Settings,
  type ThemeSetting,
  type UpdateMode,
} from "./settings";
import { FALLBACK_THEME, THEMES, findTheme, modifierHasEffect, themeInfo, type ResolvedTheme } from "./theme";
import { phaseText, type UpdatePhase } from "./updates";
import { Field, Section } from "./widgets";

/** The Updates section: the version running, the `updates` setting and what the updater is doing. */
export interface UpdateProps {
  /** The version running. */
  version: string;
  phase: UpdatePhase;
  /** Check for Updates can run now. */
  canCheck: boolean;
  onMode(mode: UpdateMode): void;
  onCheck(): void;
  /** Restart into a downloaded version. */
  onInstall(): void;
}

export interface SettingsProps {
  settings: Settings;
  /** The theme in use (follows the OS when the appearance is "system"). */
  theme: ResolvedTheme;
  systemDark: boolean;
  /** Where settings are kept: a path, or "browser storage"; undefined while loading. */
  location: string | undefined;
  /** What could not be honoured when reading or applying the settings. */
  problems: readonly string[];
  onTheme(theme: ThemeSetting): void;
  /** Zoom the whole window to this percentage. */
  onZoom(percent: number): void;
  /** Include the drawing frame in SVG exports. */
  onExportFrame(on: boolean): void;
  updates: UpdateProps;
}

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** A row of mutually exclusive buttons. */
function Segmented<T extends string>({
  label,
  value,
  options,
  onPick,
  disabled,
}: {
  label: string;
  value: T;
  options: readonly { value: T; text: string; title?: string }[];
  onPick(v: T): void;
  disabled?: string;
}) {
  return (
    <div
      class="segmented"
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled ? "true" : undefined}
      title={disabled}
    >
      {options.map((o) => (
        <button
          type="button"
          role="radio"
          key={o.value}
          aria-checked={o.value === value}
          class={o.value === value ? "on" : ""}
          title={o.title}
          disabled={disabled !== undefined}
          onClick={() => o.value !== value && onPick(o.value)}
        >
          {o.text}
        </button>
      ))}
    </div>
  );
}

export function SettingsTab(p: SettingsProps) {
  const t = p.settings.theme;
  const entry = findTheme(t.name) ?? FALLBACK_THEME;
  const info = themeInfo(entry);
  const hasAppearance = info.modifiers.some((m) => m.name === "appearance");
  const set = (patch: Partial<ThemeSetting>): void => p.onTheme({ ...t, ...patch });
  return (
    <>
      <Section title="Color theme">
        <div class="settings-fields">
          <Field label="Theme">
            <select
              aria-label="Theme"
              value={entry.id}
              onChange={(e) => set({ name: e.currentTarget.value, inputs: {} })}
            >
              {THEMES.map((x) => (
                <option key={x.id} value={x.id}>
                  {themeInfo(x).name ?? x.id}
                </option>
              ))}
            </select>
          </Field>
          {hasAppearance && (
            <Field label="Appearance">
              <Segmented<AppearanceChoice>
                label="Appearance"
                value={t.appearance}
                onPick={(appearance) => set({ appearance })}
                options={[
                  {
                    value: "system",
                    text: "System",
                    title: `Follow the operating system (now ${p.systemDark ? "dark" : "light"})`,
                  },
                  { value: "dark", text: "Dark" },
                  { value: "light", text: "Light" },
                ]}
              />
            </Field>
          )}
          {info.modifiers
            .filter((m) => m.name !== "appearance")
            .map((m) => {
              const others = Object.entries(p.theme.inputs).filter(([k]) => k !== m.name);
              const idle = modifierHasEffect(entry, p.theme.inputs, m.name)
                ? undefined
                : `No effect with ${others.map(([k, v]) => `${k} ${v}`).join(", ")}`;
              return (
                <Field label={capital(m.name)} key={m.name}>
                  <Segmented<string>
                    label={capital(m.name)}
                    value={p.theme.inputs[m.name] ?? m.default ?? ""}
                    onPick={(v) => set({ inputs: { ...t.inputs, [m.name]: v } })}
                    options={m.contexts.map((c) => ({ value: c, text: capital(c) }))}
                    disabled={idle}
                  />
                </Field>
              );
            })}
        </div>
        <div class="swatches" aria-label={`${p.theme.name} ${Object.values(p.theme.inputs).join(" ")}`}>
          {p.theme.swatches.map((s) => (
            <span key={s.token} class="swatch" style={{ background: s.color }} title={`${s.token} ${s.color}`} />
          ))}
        </div>
        {info.description && <div class="dim theme-about">{info.description}</div>}
      </Section>
      <Section title="Zoom">
        <div class="settings-fields">
          <Field label="Interface">
            <div class="segmented zoom-control" role="group" aria-label="UI zoom">
              <button
                type="button"
                class="zoom-out"
                title="Zoom out (Ctrl+-)"
                aria-label="Zoom out"
                disabled={p.settings.zoom <= ZOOM_MIN}
                onClick={() => p.onZoom(zoomStep(p.settings.zoom, -1))}
              >
                −
              </button>
              <span class="zoom-value" aria-live="polite">
                {p.settings.zoom}%
              </span>
              <button
                type="button"
                class="zoom-in"
                title="Zoom in (Ctrl++)"
                aria-label="Zoom in"
                disabled={p.settings.zoom >= ZOOM_MAX}
                onClick={() => p.onZoom(zoomStep(p.settings.zoom, 1))}
              >
                +
              </button>
              <button
                type="button"
                class="zoom-reset"
                title="Back to 100% (Ctrl+0)"
                disabled={p.settings.zoom === 100}
                onClick={() => p.onZoom(100)}
              >
                Reset
              </button>
            </div>
          </Field>
        </div>
        <div class="dim zoom-about">
          Text and controls around the canvas; the diagram keeps its own zoom. Ctrl++ / Ctrl+- / Ctrl+0 or the View
          menu.
        </div>
      </Section>
      <UpdatesSection mode={p.settings.updates} {...p.updates} />
      <Section title="Export">
        <div class="settings-fields">
          <Field label="Drawing frame">
            <label class="check">
              <input
                type="checkbox"
                class="export-frame"
                aria-label="Include the drawing frame"
                checked={p.settings.exportFrame}
                onChange={(e) => p.onExportFrame(e.currentTarget.checked)}
              />
              {p.settings.exportFrame ? "included" : "left out"}
            </label>
          </Field>
        </div>
        <div class="dim zoom-about">
          File › Export SVG: the whole sheet with its frame, zones and title block, or only the diagram.
        </div>
      </Section>
      <Section title="Settings file">
        <div class="dim settings-location" title={p.location}>
          {p.location === undefined
            ? "Loading…"
            : p.location === "browser storage"
              ? "Kept in this browser's storage (desktop app: settings.json)."
              : p.location}
        </div>
        {p.problems.length > 0 && (
          <ul class="plist settings-problems">
            {p.problems.map((x, i) => (
              <li key={i} class="swarn">
                {x}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function UpdatesSection(p: UpdateProps & { mode: UpdateMode }) {
  const phase = p.phase;
  const ready = phase.kind === "ready";
  return (
    <Section title="Updates">
      <div class="settings-fields">
        <Field label="Version">
          <span class="update-version">uFSM {p.version}</span>
        </Field>
        <Field label="Check">
          <Segmented<UpdateMode>
            label="Check for updates"
            value={p.mode}
            onPick={p.onMode}
            options={[
              {
                value: "auto",
                text: "Automatically",
                title: "Look for a new version at start and every few hours, download it in the background",
              },
              { value: "manual", text: "When asked", title: "Only Help › Check for Updates" },
            ]}
          />
        </Field>
      </div>
      <div class={`dim update-state${phase.kind === "failed" ? " swarn" : ""}`} aria-live="polite">
        {phaseText(phase)}
      </div>
      {ready && phase.notes && <div class="dim update-notes">{phase.notes}</div>}
      <div class="generate-row">
        {ready ? (
          <button type="button" class="sbtn primary update-install" onClick={p.onInstall}>
            Restart to Update
          </button>
        ) : (
          <button
            type="button"
            class="sbtn update-check"
            disabled={!p.canCheck}
            title="Look for a new version now (Help › Check for Updates)"
            onClick={p.onCheck}
          >
            Check Now
          </button>
        )}
      </div>
    </Section>
  );
}
