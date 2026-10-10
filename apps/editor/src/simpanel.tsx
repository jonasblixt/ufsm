// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * The Simulator tab: start/stop, events to send (marked when they would take a transition now; hovering one shows
 * those transitions on the canvas), guard values, the active states, the recorded trace and the step log.
 */
import { Component, type ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { vertexName, type DocIndex, type Id } from "@ufsm/core";
import { type LogLine, type LogStep, type SimOptions, type Simulation } from "./sim";
import { Field, Section } from "./widgets";

export interface SimOps {
  /** Start, or restart when running. */
  start(): void;
  stop(): void;
  send(event: string): void;
  setGuard(name: string, value: boolean): void;
  setOption(key: keyof SimOptions, value: number): void;
  /** The event under the pointer (its transitions are shown on the canvas), or undefined. */
  hover(event: string | undefined): void;
  /** Show a state or transition of the log on the canvas. */
  select(id: Id): void;
  saveTrace(): void;
  copyTrace(): void;
  setRecordActive(on: boolean): void;
}

export interface SimProps {
  /** The current document's index (event and guard lists follow edits). */
  index: DocIndex;
  sim: Simulation | undefined;
  /** The machine changed since the simulation started. */
  stale: boolean;
  /** Why the simulation could not start (the model has errors). */
  error: string | undefined;
  /** Events that would take a transition now, with the transitions. */
  would: ReadonlyMap<string, readonly Id[]>;
  guards: ReadonlyMap<string, boolean>;
  /** What the next start runs with: the model's options, with the session's overrides. */
  options: SimOptions;
  /** The session's overrides (the rest are the model's). */
  overridden: Partial<SimOptions>;
  recordActive: boolean;
  ops: SimOps;
}

/** Most recent steps shown in the log; older ones stay in the recorded trace. */
const LOG_LIMIT = 400;

/** "P › A" for a state inside P. */
function statePath(index: DocIndex, id: Id): string {
  const names: string[] = [];
  for (let v = index.vertices.get(id); v; ) {
    names.unshift(v.vertex.name ?? v.vertex.kind);
    const owner = index.regions.get(v.region.id)?.owner;
    v = owner ? index.vertices.get(owner.id) : undefined;
  }
  return names.join(" › ");
}

function NameLink({ id, text, ops }: { id: Id; text: string; ops: SimOps }) {
  return (
    <button type="button" class="link" onClick={() => ops.select(id)}>
      {text}
    </button>
  );
}

function Line({ index, line, ops }: { index: DocIndex; line: LogLine; ops: SimOps }) {
  switch (line.kind) {
    case "exit":
    case "enter":
      return (
        <div class={`sline ${line.kind}`}>
          <span class="sk">{line.kind}</span>
          <NameLink id={line.state} text={vertexName(index, line.state)} ops={ops} />
        </div>
      );
    case "transition": {
      const t = index.transitions.get(line.id);
      const it = index.internals.get(line.id);
      const text = t ? `${vertexName(index, t.from)} → ${vertexName(index, t.to)}` : it ? `${it.state.name} (internal)` : line.id;
      return (
        <div class="sline transition">
          <span class="sk">take</span>
          <NameLink id={t ? line.id : (it?.state.id ?? line.id)} text={text} ops={ops} />
        </div>
      );
    }
    case "call":
      return (
        <div class="sline call">
          <span class="sk">call</span>
          <code>{line.name}()</code>
        </div>
      );
    case "emit":
      return (
        <div class="sline emit">
          <span class="sk">emit</span>
          <code>^{line.name}</code>
        </div>
      );
    case "signal":
      return (
        <div class="sline signal">
          <span class="sk">signal</span>
          <code>{line.name}</code>
        </div>
      );
    case "terminate":
      return (
        <div class="sline terminate">
          <span class="sk">terminated</span>
        </div>
      );
  }
}

function Step({ index, step, ops }: { index: DocIndex; step: LogStep; ops: SimOps }) {
  const guards = step.guards ? Object.entries(step.guards).map(([k, v]) => `${k} = ${v}`).join(", ") : "";
  return (
    <div class={`sstep${step.error ? " failed" : ""}`}>
      <div class="shead">
        <span class="sn">{step.n}</span>
        <span class="sev">{step.event ?? "reset"}</span>
        {guards && <span class="dim sguards">{guards}</span>}
      </div>
      {step.lines.map((l, i) => (
        <Line key={i} index={index} line={l} ops={ops} />
      ))}
      {step.event !== undefined && step.fired === 0 && !step.error && <div class="sline dim">nothing to take</div>}
      {step.error && (
        <div class="sline error">
          <span class="sk">{step.error.code}</span>
          {step.error.message}
        </div>
      )}
    </div>
  );
}

/** The log only re-renders when the simulation took a step (the panel re-renders on every edit and drag frame). */
class Log extends Component<{ sim: Simulation; version: number; ops: SimOps }> {
  private box: HTMLDivElement | null = null;
  private atEnd = true;

  override shouldComponentUpdate(next: { sim: Simulation; version: number }): boolean {
    return next.sim !== this.props.sim || next.version !== this.props.version;
  }

  override componentDidMount(): void {
    this.scrollToEnd();
  }

  override componentDidUpdate(): void {
    if (this.atEnd) this.scrollToEnd();
  }

  private scrollToEnd(): void {
    if (this.box) this.box.scrollTop = this.box.scrollHeight;
  }

  render() {
    const { sim, ops } = this.props;
    const steps = sim.steps.slice(-LOG_LIMIT);
    return (
      <div
        class="slog"
        ref={(e) => void (this.box = e)}
        onScroll={(e) => {
          const b = e.currentTarget;
          this.atEnd = b.scrollTop + b.clientHeight >= b.scrollHeight - 8;
        }}
      >
        {sim.steps.length > steps.length && <div class="sline dim">{sim.steps.length - steps.length} earlier steps not shown</div>}
        {steps.map((s) => (
          <Step key={s.n} index={sim.index} step={s} ops={ops} />
        ))}
      </div>
    );
  }
}

/** Where an option's value comes from, for the field's tooltip. */
function optionTitle(p: SimProps, key: keyof SimOptions): string {
  return key in p.overridden ? "Changed for this session; set it back to the model's value to follow the model again." : "The model's value (Project tab).";
}

function NumberInput({ value, min, onCommit, title }: { value: number; min?: number; onCommit(v: number): void; title?: string }) {
  return (
    <input
      type="number"
      class="num"
      step={1}
      min={min}
      value={value}
      title={title}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "Escape") (e.currentTarget as HTMLInputElement).blur();
      }}
      onChange={(e) => {
        const el = e.currentTarget as HTMLInputElement;
        const v = Number(el.value);
        if (el.value.trim() === "" || !Number.isInteger(v) || (min !== undefined && v < min)) el.value = String(value);
        else onCommit(v);
      }}
    />
  );
}

function Events({ index, running, would, ops }: { index: DocIndex; running: boolean; would: SimProps["would"]; ops: SimOps }) {
  const [filter, setFilter] = useState("");
  const events = index.doc.declarations.events;
  const shown = filter ? events.filter((e) => e.name.toLowerCase().includes(filter.toLowerCase())) : events;
  return (
    <Section title="Events" count={events.length}>
      {events.length > 12 && (
        <input
          class="text sfilter"
          type="search"
          placeholder="Filter events"
          value={filter}
          onInput={(e) => setFilter((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") (e.currentTarget as HTMLInputElement).blur();
          }}
        />
      )}
      {events.length === 0 && <div class="none">No events declared.</div>}
      <div class="sevents">
        {shown.map((e) => {
          const takes = would.get(e.name)?.length ?? 0;
          return (
            <button
              type="button"
              key={e.id}
              class={`sevent${takes ? " would" : ""}`}
              disabled={!running}
              title={running ? (takes ? `Send ${e.name}: takes ${takes} transition${takes > 1 ? "s" : ""} now` : `Send ${e.name}: nothing to take now`) : "Start the simulation first (F5)"}
              onClick={() => ops.send(e.name)}
              onPointerEnter={() => ops.hover(e.name)}
              onPointerLeave={() => ops.hover(undefined)}
            >
              {e.name}
            </button>
          );
        })}
      </div>
    </Section>
  );
}

function Guards({ index, guards, ops }: { index: DocIndex; guards: SimProps["guards"]; ops: SimOps }) {
  const list = index.doc.declarations.guards;
  if (list.length === 0) return null;
  return (
    <Section title="Guards" count={list.length}>
      {list.map((g) => {
        const v = guards.get(g.name) ?? false;
        return (
          <div class="erow sguard" key={g.id}>
            <label class="check elabel" title="Checked: the guard returns true; unchecked: false">
              <input type="checkbox" checked={v} onChange={() => ops.setGuard(g.name, !v)} />
              <code>{g.name}()</code>
            </label>
          </div>
        );
      })}
    </Section>
  );
}

function Controls(p: SimProps) {
  const running = p.sim !== undefined;
  let state: ComponentChildren;
  if (p.error) state = <span class="serror">{p.error}</span>;
  else if (!p.sim) state = <span class="dim">Stopped</span>;
  else if (p.stale) state = <span class="swarn">The machine changed. Restart to simulate the new version.</span>;
  else if (p.sim.terminated) state = <span class="dim">Terminated · step {p.sim.steps.length - 1}</span>;
  else state = <span class="srunning">Running · step {p.sim.steps.length - 1}</span>;
  return (
    <div class="pheader scontrols">
      <div class="sbuttons">
        <button type="button" class="sbtn primary" onClick={p.ops.start} title={running ? "Restart from the initial state (F5)" : "Start the simulation (F5)"}>
          {running ? "↻ Restart" : "▶ Start"}
        </button>
        <button type="button" class="sbtn" onClick={p.ops.stop} disabled={!running} title="Stop the simulation (Shift+F5)">
          ■ Stop
        </button>
      </div>
      <div class="sstate">{state}</div>
    </div>
  );
}

export function SimulatorTab(p: SimProps) {
  const sim = p.sim;
  const live = sim !== undefined && !p.stale && !sim.terminated;
  const index = p.index;
  const leaves = sim && !p.stale ? sim.leafIds() : [];
  return (
    <>
      <Controls {...p} />
      {!sim && !p.error && (
        <div class="pnote">
          Runs the machine on the reference interpreter, the definition every code generator is tested against. Active states are
          green on the canvas. Every step is recorded as a conformance trace you can save and replay (<code>ufsm trace</code>).
        </div>
      )}
      <Events index={index} running={live} would={live ? p.would : new Map()} ops={p.ops} />
      <Guards index={index} guards={p.guards} ops={p.ops} />
      {sim && !p.stale && (
        <Section title="Active states" count={leaves.length}>
          {leaves.length === 0 && <div class="none">None{sim.terminated ? " (terminated)" : ""}.</div>}
          <ul class="plist">
            {leaves.map((id) => (
              <li key={id}>
                <NameLink id={id} text={statePath(sim.index, id)} ops={p.ops} />
              </li>
            ))}
          </ul>
        </Section>
      )}
      {sim && (
        <Section title="Trace" count={sim.steps.length}>
          <div class="erow">
            <span class="elabel dim">
              {sim.steps.length} step{sim.steps.length === 1 ? "" : "s"} recorded
            </span>
            <label class="check" title="Record the innermost active states after each step (the trace's `active` lists)">
              <input type="checkbox" checked={p.recordActive} onChange={() => p.ops.setRecordActive(!p.recordActive)} />
              active states
            </label>
          </div>
          <div class="sbuttons">
            <button type="button" class="add" onClick={p.ops.saveTrace}>
              Save trace…
            </button>
            <button type="button" class="add" onClick={p.ops.copyTrace}>
              Copy
            </button>
          </div>
        </Section>
      )}
      {sim && (
        <Section title="Log" count={sim.steps.length}>
          <Log sim={sim} version={sim.version} ops={p.ops} />
        </Section>
      )}
      <Section title="Options" open={false}>
        <Field label="Signal queue">
          <NumberInput value={p.options.signalQueue} min={1} onCommit={(v) => p.ops.setOption("signalQueue", v)} title={optionTitle(p, "signalQueue")} />
        </Field>
        <Field label="Livelock limit">
          <NumberInput value={p.options.maxMicrosteps} min={1} onCommit={(v) => p.ops.setOption("maxMicrosteps", v)} title={`Microsteps per event. ${optionTitle(p, "maxMicrosteps")}`} />
        </Field>
        <div class="dim snote">
          The model's options (Project tab) unless changed here for this session; a saved trace records what was changed.
          Used from the next start.
        </div>
      </Section>
    </>
  );
}
