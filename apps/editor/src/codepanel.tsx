// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * The Code tab: a live preview of what `ufsm generate` writes for the active machine (C header and source, Python,
 * TypeScript), with the options from the Project tab. Updates as the machine changes; layout edits do not
 * regenerate anything.
 */
import { Component } from "preact";
import { selectedTarget, targetOut, type GeneratedFile, type UfsmDocument } from "@ufsm/core";
import { TARGETS } from "./panel/project";
import { CODE_VIEWS, generatedCode, highlight, type CodeView } from "./code";

export interface CodeOps {
  setView(id: string): void;
  copy(text: string, what: string): void;
  save(file: GeneratedFile): void;
  /** Write every file of the target (a folder is asked for). */
  saveAll(files: GeneratedFile[]): void;
  /** Generate the selected target's code into its output folder (File › Generate Code). */
  generate(): void;
  showProblems(): void;
}

export interface CodeProps {
  doc: UfsmDocument;
  view: string;
  ops: CodeOps;
}

/** Re-renders only when the text changes: highlighting a few thousand lines on every drag frame would be wasted. */
class Source extends Component<{ text: string; view: CodeView }> {
  override shouldComponentUpdate(next: { text: string; view: CodeView }): boolean {
    return next.text !== this.props.text || next.view.target !== this.props.view.target;
  }

  render() {
    const { text, view } = this.props;
    const lines = text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
    return (
      <div class="code">
        <pre class="gutter" aria-hidden="true">
          {Array.from({ length: lines }, (_, i) => i + 1).join("\n")}
        </pre>
        <pre class={`src lang-${view.target}`} dangerouslySetInnerHTML={{ __html: highlight(text, view.target) }} />
      </div>
    );
  }
}

export function CodeTab({ doc, view: viewId, ops }: CodeProps) {
  const view = CODE_VIEWS.find((v) => v.id === viewId) ?? CODE_VIEWS[0]!;
  const result = generatedCode(doc, view.target);
  const file = "files" in result ? result.files[view.file] : undefined;
  // Generate writes the language selected in the Project tab, which need not be the one shown here.
  const target = selectedTarget(doc);
  const language = TARGETS.find((t) => t.key === target)?.title ?? target;
  const out = targetOut(doc, target);
  return (
    <div class="codetab">
      <div class="pheader ctools">
        <div class="cviews" role="radiogroup" aria-label="Generated file">
          {CODE_VIEWS.map((v) => (
            <button
              type="button"
              key={v.id}
              role="radio"
              aria-checked={v.id === view.id}
              class={`cview${v.id === view.id ? " active" : ""}`}
              onClick={() => ops.setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
        {file && "files" in result && (
          <div class="cfile">
            <span class="cname" title={`${file.text.split("\n").length - 1} lines`}>
              {file.name}
            </span>
            <span class="statusbar-fill" />
            <button
              type="button"
              class="mini"
              title={`Generate ${language} code${out !== undefined ? ` into ${out}` : ""}, as set in the Project tab (Ctrl+Shift+B)`}
              onClick={ops.generate}
            >
              Generate {language}
            </button>
            <button type="button" class="mini" title="Copy this file" onClick={() => ops.copy(file.text, file.name)}>
              Copy
            </button>
            <button type="button" class="mini" title="Save this file" onClick={() => ops.save(file)}>
              Save…
            </button>
            {result.files.length > 1 && (
              <button
                type="button"
                class="mini"
                title={`Save ${result.files.map((f) => f.name).join(" and ")} into a folder`}
                onClick={() => ops.saveAll(result.files)}
              >
                Save both…
              </button>
            )}
          </div>
        )}
      </div>
      {"error" in result && (
        <div class="pempty">
          <div class="serror">{result.error}</div>
          {/^the model has/.test(result.error) && (
            <button type="button" class="link" onClick={ops.showProblems}>
              Show the problems
            </button>
          )}
        </div>
      )}
      {"files" in result && result.problems.length > 0 && (
        <div class="pnote">
          {result.problems.map((p) => (
            <div key={p} class="swarn">
              {p}
            </div>
          ))}
        </div>
      )}
      {file && <Source text={file.text} view={view} />}
    </div>
  );
}
