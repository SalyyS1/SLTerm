// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Monaco ships its language contributions at paths ending in ".contribution".
// TypeScript treats that trailing segment as a file extension and strips it
// before resolution, so it looks for ".../monaco" and finds nothing — even
// though monaco-editor's `exports` map ("./*": "./*") does expose the real
// files and Vite resolves them correctly at build time.
//
// These imports are side-effect only (they register languages with the editor),
// so declaring them as untyped modules loses nothing.

declare module "monaco-editor/esm/vs/basic-languages/_.contribution";
declare module "monaco-editor/esm/vs/language/json/monaco.contribution";

// editor.api is monaco's core entry point, without the language services that
// "monaco-editor" (editor.main) drags in. Its own .d.ts declares a global
// namespace rather than exporting a module, so TypeScript cannot resolve it as
// one; monaco-env casts the import to the full monaco-editor types, which is
// accurate for everything the app calls.
declare module "monaco-editor/esm/vs/editor/editor.api";
