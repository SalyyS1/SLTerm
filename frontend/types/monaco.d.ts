// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Monaco ships its language contributions at paths ending in ".contribution".
// TypeScript treats that trailing segment as a file extension and strips it
// before resolution, so it looks for ".../monaco" and finds nothing — even
// though monaco-editor's `exports` map ("./*": "./*") does expose the real
// files and Vite resolves them correctly at build time.
//
// These imports are side-effect only (they register a language with the
// editor), so declaring them as untyped modules loses nothing.

declare module "monaco-editor/esm/vs/language/css/monaco.contribution";
declare module "monaco-editor/esm/vs/language/html/monaco.contribution";
declare module "monaco-editor/esm/vs/language/json/monaco.contribution";
declare module "monaco-editor/esm/vs/language/typescript/monaco.contribution";
