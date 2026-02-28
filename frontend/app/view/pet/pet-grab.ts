// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

/**
 * Pet Grab — Grab & drop interaction with physics.
 * Stub for Phase 05 implementation.
 */

import type { PetPosition } from "./pet-types";

const GRAVITY = 800; // px/s²
const BOUNCE_FACTOR = 0.4; // 40% bounce height
const BOUNCE_THRESHOLD = 2; // Stop bouncing below this velocity

export interface GrabState {
    isGrabbed: boolean;
    isFalling: boolean;
    grabOffset: { x: number; y: number };
}

/**
 * Start grabbing the pet at mouse position
 */
export function startGrab(petPos: PetPosition, mouseX: number, mouseY: number): GrabState {
    return {
        isGrabbed: true,
        isFalling: false,
        grabOffset: {
            x: mouseX - petPos.x,
            y: mouseY - petPos.y,
        },
    };
}

/**
 * Update pet position while being dragged
 */
export function updateDrag(mouseX: number, mouseY: number, grabOffset: { x: number; y: number }): Partial<PetPosition> {
    return {
        x: mouseX - grabOffset.x,
        y: mouseY - grabOffset.y,
    };
}

/**
 * Release the pet — start falling with gravity
 */
export function startDrop(): GrabState {
    return {
        isGrabbed: false,
        isFalling: true,
        grabOffset: { x: 0, y: 0 },
    };
}

/**
 * Apply gravity physics during fall
 * Returns updated position and whether still falling
 */
export function applyGravity(
    pos: PetPosition,
    dt: number,
    groundY: number
): { pos: PetPosition; stillFalling: boolean } {
    const newPos = { ...pos };
    newPos.velocityY += GRAVITY * dt;
    newPos.y -= newPos.velocityY * dt; // y increases downward

    // Hit ground
    if (newPos.y <= groundY) {
        newPos.y = groundY;

        // Bounce
        if (Math.abs(newPos.velocityY) > BOUNCE_THRESHOLD) {
            newPos.velocityY = -newPos.velocityY * BOUNCE_FACTOR;
            return { pos: newPos, stillFalling: true };
        } else {
            newPos.velocityY = 0;
            return { pos: newPos, stillFalling: false };
        }
    }

    return { pos: newPos, stillFalling: true };
}

/**
 * Detect if a click is a "pat" (short click, no drag)
 */
export function isPat(startTime: number, startX: number, startY: number, endX: number, endY: number): boolean {
    const duration = Date.now() - startTime;
    const distance = Math.sqrt((endX - startX) ** 2 + (endY - startY) ** 2);
    return duration < 200 && distance < 5;
}
