// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

/**
 * Pet Dialogue — Frontend dialogue scheduler.
 * Manages speech bubble timing, health reminders, and i18n.
 * Stub for Phase 06 implementation.
 */

import { HEALTH_REMINDERS } from "./pet-types";

export interface DialogueConfig {
    frequency: number; // 0-1 slider
    healthRemindersEnabled: boolean;
    lang: "vi" | "en";
}

const DEFAULT_CONFIG: DialogueConfig = {
    frequency: 0.5,
    healthRemindersEnabled: true,
    lang: "vi",
};

/**
 * Check if a health reminder should fire at the current time
 */
export function getActiveHealthReminder(hour: number): string | null {
    if (HEALTH_REMINDERS.SLEEP.hours?.includes(hour)) return "sleep";
    if (HEALTH_REMINDERS.LUNCH.hours?.includes(hour)) return "lunch";
    if (HEALTH_REMINDERS.DINNER.hours?.includes(hour)) return "dinner";
    return null;
}

/**
 * Calculate next dialogue delay based on frequency setting
 * frequency 0 = rare (180s), frequency 1 = frequent (20s)
 */
export function getDialogueDelay(frequency: number): number {
    const minDelay = 20000; // 20s
    const maxDelay = 180000; // 180s
    const delay = maxDelay - frequency * (maxDelay - minDelay);
    // Add some randomness (±30%)
    const variance = delay * 0.3;
    return delay - variance + Math.random() * variance * 2;
}
