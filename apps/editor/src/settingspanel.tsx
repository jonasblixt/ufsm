// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/** The right panel's Settings tab: global editor settings (color theme, zoom), saved to settings.json at once. */
import { zoomStep, ZOOM_MAX, ZOOM_MIN, type AppearanceChoice, type Settings, type ThemeSetting } from "./settings";
import { FALLBACK_THEME, THEMES, findTheme, modifierHasEffect, themeInfo, type ResolvedTheme } from "./theme";
import { Field, Section } from "./widgets";

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
