// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Terminal domain re-exports from global.ts.
// Consumers can import tab-indicator and block-term-durability utilities
// from here instead of the monolithic global.ts.

export {
    clearAllTabIndicators,
    clearTabIndicatorFromFocus,
    getBlockTermDurableAtom,
    getTabIndicatorAtom,
    loadTabIndicators,
    setTabIndicator,
} from "../global";
