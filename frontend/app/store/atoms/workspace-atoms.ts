// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Workspace domain re-exports from global.ts.
// Covers block/tab lifecycle, layout, focus management, and navigation.

export {
    createBlock,
    createBlockSplitHorizontally,
    createBlockSplitVertically,
    createTab,
    fetchWaveFile,
    getAllBlockComponentModels,
    getBlockComponentModel,
    getFocusedBlockId,
    getLocalHostDisplayNameAtom,
    openLink,
    recordTEvent,
    refocusNode,
    registerBlockComponentModel,
    replaceBlock,
    setActiveTab,
    setNodeFocus,
    unregisterBlockComponentModel,
} from "../global";
