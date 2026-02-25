// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Connection domain re-exports from global.ts.
// Consumers can import SSH/connection atom utilities from here
// instead of the monolithic global.ts.

export {
    getConnStatusAtom,
    loadConnStatus,
    subscribeToConnEvents,
} from "../global";
