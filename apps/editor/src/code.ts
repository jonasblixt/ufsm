// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Live code preview: the generated files of the active machine, regenerated only when something the generators read
 * changed (machine, declarations, name, options, targets; not the layout), and a small syntax highlighter for C, Python,
 * TypeScript, Rust, Go and C++. No DOM here.
 */
import {
  CodegenError,
  generateFiles,
  modelIr,
  type CodeTarget,
  type GeneratedCode,
  type UfsmDocument,
} from "@ufsm/core";
import { type IrModule } from "@ufsm/core/pipeline";

/** A file of the preview: which target, and which of its files. */
export interface CodeView {
  id: string;
  label: string;
  target: CodeTarget;
  file: number;
}

export const CODE_VIEWS: readonly CodeView[] = [
  { id: "c-header", label: "C header", target: "c", file: 0 },
  { id: "c-source", label: "C source", target: "c", file: 1 },
  { id: "python", label: "Python", target: "python", file: 0 },
  { id: "ts", label: "TypeScript", target: "ts", file: 0 },
  { id: "rust", label: "Rust", target: "rust", file: 0 },
  { id: "go", label: "Go", target: "go", file: 0 },
  { id: "cpp", label: "C++", target: "cpp", file: 0 },
];

export type CodeResult = GeneratedCode | { error: string };

interface Entry {
  name: string;
  declarations: UfsmDocument["declarations"];
  options: UfsmDocument["options"];
  targets: UfsmDocument["targets"];
  ir: IrModule | { error: string } | undefined;
  out: Map<CodeTarget, CodeResult>;
}

const cache = new WeakMap<UfsmDocument["machine"], Entry>();

/** The files of `target` for `doc`, from the cache when nothing they depend on changed. Errors come back as text. */
export function generatedCode(doc: UfsmDocument, target: CodeTarget): CodeResult {
  let e = cache.get(doc.machine);
  if (
    !e ||
    e.name !== doc.name ||
    e.declarations !== doc.declarations ||
    e.options !== doc.options ||
    e.targets !== doc.targets
  ) {
    e = {
      name: doc.name,
      declarations: doc.declarations,
      options: doc.options,
      targets: doc.targets,
      ir: undefined,
      out: new Map(),
    };
    cache.set(doc.machine, e);
  }
  const hit = e.out.get(target);
  if (hit) return hit;
  const message = (x: unknown): string => (x instanceof CodegenError ? x.message : `generator failed: ${String(x)}`);
  if (!e.ir) {
    try {
      e.ir = modelIr(doc);
    } catch (x) {
      e.ir = { error: message(x) };
    }
  }
  let result: CodeResult;
  if ("error" in e.ir) result = { error: e.ir.error };
  else {
    try {
      result = generateFiles(doc, target, {}, e.ir);
    } catch (x) {
      result = { error: message(x) };
    }
  }
  e.out.set(target, result);
  return result;
}

// ---------------------------------------------------------------- highlighting

const WORDS: Record<CodeTarget, string> = {
  c:
    "auto break case char const continue default do double else enum extern float for goto if inline int long register restrict " +
    "return short signed sizeof static struct switch typedef union unsigned void volatile while bool true false NULL " +
    "int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t size_t",
  python:
    "False None True and as assert async await break class continue def del elif else except finally for from global if import " +
    "in is lambda nonlocal not or pass raise return try while with yield self int bool str list tuple object",
  ts:
    "break case catch class const continue debugger default delete do else enum export extends false finally for function if " +
    "implements import in instanceof interface let new null private protected public readonly return static super switch this " +
    "throw true try type typeof undefined var void while with yield as keyof number boolean string never unknown",
  rust:
    "as break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self " +
    "Self static struct super trait true type unsafe use where while async await u8 u16 u32 u64 usize i8 i16 i32 i64 isize " +
    "f32 f64 bool char str Option Some None Result Ok Err",
  go:
    "break case chan const continue default defer else fallthrough for func go goto if import interface map package range " +
    "return select struct switch type var true false nil iota bool byte error int int8 int16 int32 int64 uint uint8 uint16 " +
    "uint32 uint64 string any",
  cpp:
    "alignas alignof auto bool break case char class const constexpr const_cast continue default delete do double else enum " +
    "explicit extern false float for friend goto if inline int long namespace new noexcept nullptr operator private protected " +
    "public return short signed sizeof static static_assert static_cast struct switch template this throw true try typedef " +
    "typename union unsigned using virtual void volatile while std int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t " +
    "uint64_t size_t",
};

const COMMENT: Record<CodeTarget, string> = {
  c: String.raw`\/\*[\s\S]*?\*\/|\/\/[^\n]*`,
  python: String.raw`#[^\n]*`,
  ts: String.raw`\/\*[\s\S]*?\*\/|\/\/[^\n]*`,
  rust: String.raw`\/\*[\s\S]*?\*\/|\/\/[^\n]*`,
  go: String.raw`\/\*[\s\S]*?\*\/|\/\/[^\n]*`,
  cpp: String.raw`\/\*[\s\S]*?\*\/|\/\/[^\n]*`,
};

const STRING: Record<CodeTarget, string> = {
  c: String.raw`"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'`,
  python: String.raw`"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'`,
  ts: String.raw`"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\x60(?:[^\x60\\]|\\.)*\x60`,
  // a char literal holds one character, so lifetimes ('static, '_) are not strings
  rust: String.raw`"(?:[^"\\]|\\.)*"|'(?:[^'\\\n]|\\.)'`,
  go: String.raw`"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\x60[^\x60]*\x60`,
  cpp: String.raw`"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'`,
};

const patterns = new Map<CodeTarget, RegExp>();

function pattern(lang: CodeTarget): RegExp {
  let re = patterns.get(lang);
  if (!re) {
    const pre =
      lang === "c" || lang === "cpp"
        ? String.raw`|(^[ \t]*#[^\n]*)`
        : lang === "rust"
          ? String.raw`|(^[ \t]*#!?\[[^\n]*)`
          : String.raw`|(^[ \t]*@\w+)`;
    re = new RegExp(
      `(${COMMENT[lang]})|(${STRING[lang]})${pre}|\\b(0[xX][0-9a-fA-F]+[uUlL]*|\\d+[uUlL]*)\\b|\\b(${WORDS[lang].split(" ").join("|")})\\b`,
      "gm",
    );
    patterns.set(lang, re);
  }
  return re;
}

export const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** HTML for `text` with spans `c-com`, `c-str`, `c-pre` (C preprocessor, decorators, Rust attributes), `c-num` and `c-kw`. */
export function highlight(text: string, lang: CodeTarget): string {
  const re = pattern(lang);
  re.lastIndex = 0;
  let out = "";
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[0] === "") {
      re.lastIndex++;
      continue;
    }
    const cls = m[1] ? "c-com" : m[2] ? "c-str" : m[3] ? "c-pre" : m[4] ? "c-num" : "c-kw";
    out += escapeHtml(text.slice(last, m.index)) + `<span class="${cls}">${escapeHtml(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return out + escapeHtml(text.slice(last));
}
