// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Barrel re-export for all domain-specific atom modules.
// Consumers can import from "@/store/atoms" to get fine-grained imports,
// or continue importing from "@/store/global" — both work identically.

export * from "./connection-atoms";
export * from "./settings-atoms";
export * from "./terminal-atoms";
export * from "./ui-atoms";
export * from "./workspace-atoms";

// Core store exports that don't fit a single domain.
export {
    atoms,
    counterInc,
    countersClear,
    countersPrint,
    getApi,
    getBlockMetaKeyAtom,
    getHostName,
    getObjectId,
    getOrefMetaKeyAtom,
    getUserName,
    globalPrimaryTabStartup,
    globalStore,
    initGlobal,
    initGlobalWaveEventSubs,
    isDev,
    readAtom,
    setPlatform,
    useBlockAtom,
    useBlockCache,
    useBlockDataLoaded,
    useBlockMetaKeyAtom,
    useOrefMetaKeyAtom,
    WOS,
} from "../global";
