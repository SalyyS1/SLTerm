// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

/**
 * Pet Behaviors — AI decision engine for diverse pet expressions.
 * Now includes: HAPPY, SAD, CRY, WAG, PLAY, SNOOZE for rich personality.
 */

import type { PetBehavior, PetPosition } from "./pet-types";
import { BEHAVIOR_WEIGHTS } from "./pet-types";

/**
 * Pick a random behavior based on weighted probabilities.
 * Mood affects weights heavily for more personality.
 */
export function pickRandomBehavior(currentMood: string): PetBehavior {
    const weights = { ...BEHAVIOR_WEIGHTS };

    // Mood-driven personality
    if (currentMood === "sleepy") {
        weights.SLEEP = 30;
        weights.SNOOZE = 25;
        weights.SIT = 15;
        weights.WALK = 5;
        weights.RUN = 0;
        weights.PLAY = 0;
        weights.HAPPY = 0;
    } else if (currentMood === "happy") {
        weights.HAPPY = 25;
        weights.PLAY = 20;
        weights.WAG = 15;
        weights.JUMP = 12;
        weights.CELEBRATE = 10;
        weights.SAD = 0;
        weights.CRY = 0;
    } else if (currentMood === "sad") {
        weights.SAD = 25;
        weights.CRY = 15;
        weights.SIT = 20;
        weights.IDLE = 20;
        weights.HAPPY = 0;
        weights.PLAY = 0;
        weights.CELEBRATE = 0;
    } else if (currentMood === "hungry") {
        weights.SAD = 10;
        weights.SIT = 15;
        weights.WALK = 20;
        weights.SNOOZE = 10;
    }

    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    let rand = Math.random() * total;

    for (const [behavior, weight] of Object.entries(weights)) {
        rand -= weight;
        if (rand <= 0) {
            return behavior as PetBehavior;
        }
    }

    return "IDLE";
}

/**
 * Calculate next position for a walking/running pet
 */
export function calculateMovement(
    pos: PetPosition,
    behavior: PetBehavior,
    bounds: { width: number; height: number },
    dt: number
): PetPosition {
    const newPos = { ...pos };
    const speed = behavior === "RUN" ? 80 : 30;

    if (behavior === "WALK" || behavior === "RUN") {
        const direction = pos.facing === "right" ? 1 : -1;
        newPos.x += direction * speed * dt;

        if (newPos.x <= 10) {
            newPos.x = 10;
            newPos.facing = "right";
        } else if (newPos.x >= bounds.width - 50) {
            newPos.x = bounds.width - 50;
            newPos.facing = "left";
        }
    }

    return newPos;
}

/**
 * Calculate behavior duration — diverse timing for natural feel
 */
export function getBehaviorDuration(behavior: PetBehavior): number {
    const durations: Record<string, [number, number]> = {
        IDLE: [4000, 8000],
        WALK: [5000, 10000],
        RUN: [3000, 6000],
        SIT: [5000, 10000],
        JUMP: [2000, 4000],
        SLEEP: [10000, 25000],
        CELEBRATE: [3000, 5000],
        HAPPY: [3000, 6000],
        SAD: [5000, 8000],
        CRY: [4000, 6000],
        WAG: [3000, 5000],
        PLAY: [4000, 8000],
        SNOOZE: [8000, 20000],
    };

    const [min, max] = durations[behavior] ?? [2000, 5000];
    return min + Math.random() * (max - min);
}
