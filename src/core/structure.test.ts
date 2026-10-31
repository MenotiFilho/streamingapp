/**
 * The client core's shape, read from the sources themselves (ADR-0035 §1).
 *
 * The layering is `core ← kit ← window | remote`: the core imports neither the
 * kit nor a client, the kit may import the core's decisions, and each client
 * imports both. The core is framework-free — outside `src/core/react/` it
 * imports no React and touches no `document`, `window`, `localStorage`,
 * `WebSocket` or `@tauri-apps` — and it ships no barrel, so every client
 * imports the real module the graph holds.
 *
 * These are rules, not inventories: nothing here counts files, so a new module
 * is judged by where it sits and what it imports.
 */

import { describe, expect, test } from "vitest";

/** The core, and its one React-and-DOM pocket. */
const CORE = "src/core";
const CORE_REACT = "src/core/react";
/** The kit A3 lands; the rules already read it, so that move does not revisit them. */
const KIT = "src/kit";

/**
 * The sources, raw, the way the token lock reads the sheet: the graph the build
 * sees is the one under test. A missing directory is an empty map.
 */
const coreSources = import.meta.glob<string>("./**/*.{ts,tsx}", {
  eager: true,
  query: "?raw",
  import: "default",
});

const kitSources = import.meta.glob<string>("../kit/**/*.{ts,tsx}", {
  eager: true,
  query: "?raw",
  import: "default",
});

/**
 * The window's sources, read as text, for the one rule about the rehearsal's
 * link: it is a client of the preview Host and never of Tauri (ADR-0035 §1).
 */
const windowSources = import.meta.glob<string>("../window/**/*.{ts,tsx}", {
  eager: true,
  query: "?raw",
  import: "default",
});

type Source = { file: string; text: string };

/**
 * A path from the repository root with no `.` or `..` left: the sources are
 * read as text, and the repository's own paths are all this test needs, so a
 * path helper keeps it free of a Node type package the window does not carry.
 */
function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

/** The directory a file sits in, as a path from the repository root. */
function dirname(file: string): string {
  const cut = file.lastIndexOf("/");
  return cut <= 0 ? "" : file.slice(0, cut);
}

/** The glob's keys as paths from the repository root. */
function sourcesIn(root: string, globbed: Record<string, string>): Source[] {
  return Object.entries(globbed).map(([key, text]) => ({
    file: normalize(`${root}/${key}`),
    text,
  }));
}

/**
 * The one core suite allowed a DOM fixture: it builds an `<input>` to ask
 * `isTypingTarget` what counts as a place a person types.
 */
const DOM_SUITE = "src/core/input.test.ts";

/**
 * Read a module the way the language does: comments are not code, and a string
 * is a value rather than a name. `keepStrings` leaves the quoted text in place,
 * which is what import specifiers need; the identifier rules drop it, so a
 * refusal's prose about "the window" cannot trip a rule about `window`.
 */
function scan(source: string, keepStrings: boolean): string {
  let out = "";
  let index = 0;

  while (index < source.length) {
    const here = source[index];
    const next = source[index + 1];

    if (here === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") {
        index += 1;
      }
      out += "\n";
      continue;
    }

    if (here === "/" && next === "*") {
      index += 2;
      while (
        index < source.length &&
        !(source[index] === "*" && source[index + 1] === "/")
      ) {
        index += 1;
      }
      index += 2;
      out += " ";
      continue;
    }

    if (here === '"' || here === "'" || here === "`") {
      const quote = here;
      index += 1;
      let body = "";
      while (index < source.length) {
        const character = source[index];
        if (character === "\\") {
          body += source.slice(index, index + 2);
          index += 2;
          continue;
        }
        if (character === quote) {
          index += 1;
          break;
        }
        body += character;
        index += 1;
      }
      out += keepStrings ? `${quote}${body}${quote}` : `${quote}${quote}`;
      continue;
    }

    out += here;
    index += 1;
  }

  return out;
}

/** Every module a source names, through an import, a re-export or a require. */
function importsOf(source: string): string[] {
  const text = scan(source, true);
  const specifiers: string[] = [];

  for (const pattern of [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s*["']([^"']+)["']/g,
  ]) {
    for (const match of text.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier) {
        specifiers.push(specifier);
      }
    }
  }

  return specifiers;
}

/** React, its DOM binding, the motion preset, and the shell's door to Tauri. */
const FRAMEWORK = /^(react|react-dom)(\/|$)|^motion\/|^@tauri-apps(\/|$)/;
/**
 * The platform bindings that never belong in a client core. Both patterns are
 * built from text so this suite's own source — comments and string bodies are
 * stripped before the read — cannot trip the rule it states.
 */
const RUNTIME = new RegExp("\\b(localStorage|WebSocket)\\b");
/** The document and the browser's window, rather than a value named after them. */
const DOM = new RegExp("\\b(document|window)\\b");

/** A JSON or image the core reads: data, not a module of another layer. */
function isData(path: string): boolean {
  return /^src\/[^/]+\.(json|svg)$/.test(path) || path.startsWith("src/assets/");
}

/**
 * Resolve a relative import from the file that makes it, and say where it
 * points. A bare specifier is left to the framework rule.
 */
function resolves(file: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) {
    return null;
  }
  return normalize(`${dirname(file)}/${specifier}`);
}

/** React and Tauri, named by a core source outside its bindings. */
function frameworkOffenders(source: Source): string[] {
  if (source.file.startsWith(`${CORE_REACT}/`)) {
    return [];
  }
  return importsOf(source.text).flatMap((specifier) =>
    resolves(source.file, specifier) === null && FRAMEWORK.test(specifier)
      ? [`${source.file} imports ${specifier}`]
      : [],
  );
}

/**
 * The document, the browser's window, and the platform bindings. One core
 * suite is allowed a DOM fixture — `input.test.ts` builds an `<input>` to ask
 * a pure function what counts as typing — so that suite is named rather than
 * every suite being exempt; the import rules still apply to it.
 */
function platformOffenders(source: Source): string[] {
  const code = scan(source.text, false);
  const offenders: string[] = [];

  if (RUNTIME.test(code)) {
    offenders.push(`${source.file} names localStorage or WebSocket`);
  }
  if (
    !source.file.startsWith(`${CORE_REACT}/`) &&
    source.file !== DOM_SUITE &&
    DOM.test(code)
  ) {
    offenders.push(`${source.file} reads the document or the window`);
  }

  return offenders;
}

/** A relative import that leaves the core for the kit, a client, or elsewhere. */
function layeringOffenders(source: Source): string[] {
  return importsOf(source.text).flatMap((specifier) => {
    const target = resolves(source.file, specifier);
    if (target === null || target.startsWith(`${CORE}/`) || isData(target)) {
      return [];
    }
    return [`${source.file} imports ${specifier} (${target})`];
  });
}

/** The imports and names a kit source may not have. */
function kitOffenders(source: Source): string[] {
  const offenders: string[] = [];

  for (const specifier of importsOf(source.text)) {
    const target = resolves(source.file, specifier);

    if (target === null) {
      if (specifier.startsWith("@tauri-apps")) {
        offenders.push(`${source.file} imports ${specifier}`);
      }
      continue;
    }

    const allowed =
      target.startsWith(`${KIT}/`) ||
      target.startsWith(`${CORE}/`) ||
      isData(target);
    if (!allowed) {
      offenders.push(`${source.file} imports ${specifier} (${target})`);
    }
  }

  if (RUNTIME.test(scan(source.text, false))) {
    offenders.push(`${source.file} names localStorage or WebSocket`);
  }

  return offenders;
}

const core = sourcesIn(CORE, coreSources);
const kit = sourcesIn(KIT, kitSources);

describe("the client core", () => {
  test("keeps React to its bindings and the platform out of every module", () => {
    const offenders = core.flatMap((source) => [
      ...frameworkOffenders(source),
      ...platformOffenders(source),
    ]);
    expect(
      offenders,
      "the core is framework-free outside src/core/react",
    ).toEqual([]);
  });

  test("imports no kit and no client", () => {
    expect(
      core.flatMap(layeringOffenders),
      "the layering is core ← kit ← window | remote, and only JSON/SVG data crosses it",
    ).toEqual([]);
  });

  test("ships no barrel: clients import the module the graph holds", () => {
    const barrels = core
      .map((source) => source.file)
      .filter((file) => /(^|\/)index\.tsx?$/.test(file));
    expect(barrels, "no index.ts under src/core").toEqual([]);
  });

  test("the rule itself reads React, the DOM, a socket and a client", () => {
    // The tree is clean today; this keeps each rule falsifiable while it is.
    // The client path is assembled so this suite's own source never spells a
    // path the layering rule exists to keep out of the core.
    const client = ["..", "window/Shell"].join("/");
    const probe: Source = {
      file: "src/core/Probe.ts",
      text: [
        'import { useState } from "react";',
        `import { Shell } from "${client}";`,
        "const title = document.title;",
        "const socket = WebSocket;",
      ].join("\n"),
    };

    expect(frameworkOffenders(probe)).toEqual([
      "src/core/Probe.ts imports react",
    ]);
    expect(platformOffenders(probe)).toEqual([
      "src/core/Probe.ts names localStorage or WebSocket",
      "src/core/Probe.ts reads the document or the window",
    ]);
    expect(layeringOffenders(probe)).toEqual([
      `src/core/Probe.ts imports ${client} (src/window/Shell)`,
    ]);
  });
});

describe("the React bindings", () => {
  test("may use React and the DOM, and no platform binding", () => {
    const offenders = core
      .filter((source) => source.file.startsWith(`${CORE_REACT}/`))
      .flatMap((source) => [
        ...importsOf(source.text).flatMap((specifier) =>
          specifier.startsWith("@tauri-apps")
            ? [`${source.file} imports ${specifier}`]
            : [],
        ),
        ...platformOffenders(source),
      ]);
    expect(
      offenders,
      "src/core/react may draw with React and the DOM, and no storage, socket or Tauri",
    ).toEqual([]);
  });
});

describe("the kit", () => {
  test("is screen-agnostic: React and the DOM, and neither client", () => {
    expect(
      kit.flatMap(kitOffenders),
      "the kit may draw and read the core's decisions, and never a client",
    ).toEqual([]);
  });

  test("the rule itself reads a client, a socket and a Tauri import", () => {
    // A3 lands the kit; this keeps the rule live until then, so the move that
    // creates it cannot discover a rule nobody exercised. The client path is
    // assembled for the same reason as the core probe's.
    const client = ["..", "window/Shell"].join("/");
    const offenders = kitOffenders({
      file: "src/kit/Probe.tsx",
      text: [
        'import { useState } from "react";',
        `import { Shell } from "${client}";`,
        'import { invoke } from "@tauri-apps/api/core";',
        "const socket = WebSocket;",
      ].join("\n"),
    });

    expect(offenders).toEqual([
      `src/kit/Probe.tsx imports ${client} (src/window/Shell)`,
      "src/kit/Probe.tsx imports @tauri-apps/api/core",
      "src/kit/Probe.tsx names localStorage or WebSocket",
    ]);
  });
});

describe("the window's rehearsal", () => {
  test("the preview link is built without a Tauri module", () => {
    // The rehearsal mounts the same room as the window, so `Shell` keeps its
    // `TauriLink` default; what must not happen is the preview's own link — and
    // everything it is built from — reaching a Tauri module (ADR-0035 §1).
    const sources = new Map(
      sourcesIn("src/window", windowSources).map((source) => [source.file, source]),
    );
    const sourceAt = (path: string): Source | undefined =>
      sources.get(path) ??
      sources.get(`${path}.ts`) ??
      sources.get(`${path}.tsx`);
    const seen = new Set<string>();
    const queue = ["src/window/previewLink.ts"];
    const offenders: string[] = [];

    while (queue.length > 0) {
      const file = queue.pop();
      if (file === undefined || seen.has(file)) {
        continue;
      }
      seen.add(file);

      const source = sourceAt(file);
      if (!source) {
        continue;
      }

      for (const specifier of importsOf(source.text)) {
        if (specifier.startsWith("@tauri-apps")) {
          offenders.push(`${file} imports ${specifier}`);
          continue;
        }
        const target = resolves(file, specifier);
        const next = target === null ? undefined : sourceAt(target);
        if (next) {
          queue.push(next.file);
        }
      }
    }

    expect(
      offenders,
      "the preview link points at the preview Host, never at Tauri",
    ).toEqual([]);
    expect(seen, "the walk reached the preview Host").toContain(
      "src/window/repertory/previewHost.ts",
    );
  });
});
