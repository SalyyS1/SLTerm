// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Settings domain re-exports from global.ts.
// Consumers can import settings-related atom utilities from here instead of
// the monolithic global.ts, reducing subscription coupling.

export {
    getOverrideConfigAtom,
    getSettingsKeyAtom,
    getSettingsPrefixAtom,
    useOverrideConfigAtom,
    useSettingsKeyAtom,
} from "../global";
