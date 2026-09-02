// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

import type { TermWrap } from "@/app/view/term/termwrap";
import { useEffect } from "react";

interface TermLiveOptionsProps {
    termRef: React.RefObject<TermWrap>;
    fontSize: number;
    fontFamily: string;
    macOptionIsMeta: boolean;
    ignoreBracketedPasteMode: boolean;
}

/**
 * Applies the terminal options xterm can change in place, without rebuilding it.
 *
 * Rebuilding a terminal to change a font means disposing the grid and replaying
 * the whole history back into a fresh one — the path where scrollback gets
 * duplicated or lost. xterm mutates these options live instead, the same way
 * TermThemeUpdater already applies themes, so a font change costs a reflow and
 * nothing else.
 */
const TermLiveOptions = ({
    termRef,
    fontSize,
    fontFamily,
    macOptionIsMeta,
    ignoreBracketedPasteMode,
}: TermLiveOptionsProps) => {
    useEffect(() => {
        const termWrap = termRef.current;
        if (termWrap?.terminal == null) {
            // First render of a new terminal: the constructor was handed these
            // same values, so there is nothing to reconcile yet.
            return;
        }
        const opts = termWrap.terminal.options;
        let cellSizeChanged = false;
        if (fontSize != null && opts.fontSize !== fontSize) {
            opts.fontSize = fontSize;
            cellSizeChanged = true;
        }
        if (fontFamily != null && opts.fontFamily !== fontFamily) {
            opts.fontFamily = fontFamily;
            cellSizeChanged = true;
        }
        opts.macOptionIsMeta = macOptionIsMeta;
        opts.ignoreBracketedPasteMode = ignoreBracketedPasteMode;
        if (cellSizeChanged) {
            // The grid no longer fits the element, and the shell is still
            // wrapping at the old width until it is told the new one.
            termWrap.handleResize();
        }
    }, [fontSize, fontFamily, macOptionIsMeta, ignoreBracketedPasteMode]);
    return null;
};

export { TermLiveOptions };
