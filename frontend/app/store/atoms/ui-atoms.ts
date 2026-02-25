// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// UI state domain re-exports from global.ts.
// Covers flash errors, notifications, and modal-open state.

export {
    pushFlashError,
    pushNotification,
    removeFlashError,
    removeNotification,
    removeNotificationById,
} from "../global";
