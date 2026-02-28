// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Mirror of Go structs for frontend

export interface PetInstance {
    id: string;
    petId: string;
    name: string;
    level: number;
    xp: number;
    xpToNext: number;
    progress: number; // 0-1
    mood: PetMood;
    state: PetState;
    hunger: number;
    energy: number;
    spawnedAt: string;
    totalPlaytime: number;
}

export type PetMood = "happy" | "neutral" | "sad" | "hungry" | "sleepy";
export type PetState = "ACTIVE" | "IDLE" | "SLEEPING" | "CELEBRATING" | "GRABBED" | "FALLING";

export interface PlayerProfile {
    activePetId: string;
    completedPets: string[];
    streakDays: number;
    lastActiveDate: string;
    totalFocusTime: number;
    totalCommands: number;
    achievements: string[];
    customDialogues?: CustomDialogue[];
}

export interface CustomDialogue {
    id: string;
    textVi: string;
    textEn: string;
    mood?: PetMood;
    timeFrom?: number;
    timeTo?: number;
}

export interface SessionData {
    startedAt: string;
    activeTime: number;
    commandCount: number;
    isIdle: boolean;
    currentProject: string;
    discordConnected: boolean;
}

export interface PetCatalogueEntry {
    id: string;
    name: string;
    dexNum: number;
    spriteSheet?: string;
    frameWidth?: number;
    frameHeight?: number;
    animations?: Record<string, AnimDef>;
    type?: "pokemon" | "shimeji" | "custom" | "waifu";
    customSpriteUrl?: string; // custom animated GIF URL for non-Pokemon
    customGridUrl?: string; // custom static image for the grid
    discordAssetKey?: string;
}

export interface AnimDef {
    frames: number[];
    fps: number;
    loop: boolean;
}

// Frontend-only types
export interface PetPosition {
    x: number;
    y: number;
    facing: "left" | "right";
    velocityX: number;
    velocityY: number;
}

export type PetBehavior =
    | "WALK"
    | "RUN"
    | "JUMP"
    | "IDLE"
    | "SLEEP"
    | "CELEBRATE"
    | "SIT"
    | "GRABBED"
    | "FALL"
    | "DIZZY"
    | "PET"
    | "EAT"
    | "HAPPY"
    | "SAD"
    | "CRY"
    | "WAG"
    | "PLAY"
    | "SNOOZE";

// Animation definitions for pet sprites
export const PET_ANIMATIONS: Record<PetBehavior, AnimDef> = {
    IDLE: { frames: [0, 1, 2, 1], fps: 2, loop: true },
    WALK: { frames: [3, 4, 5, 4], fps: 6, loop: true },
    RUN: { frames: [6, 7, 8, 7], fps: 10, loop: true },
    JUMP: { frames: [9, 10, 11], fps: 8, loop: false },
    SLEEP: { frames: [12, 13], fps: 1, loop: true },
    CELEBRATE: { frames: [14, 15, 16, 15], fps: 8, loop: true },
    SIT: { frames: [17], fps: 1, loop: true },
    GRABBED: { frames: [18, 19], fps: 4, loop: true },
    FALL: { frames: [20, 21], fps: 6, loop: false },
    DIZZY: { frames: [22, 23], fps: 3, loop: false },
    PET: { frames: [24, 25, 26], fps: 4, loop: false },
    EAT: { frames: [27, 28, 29], fps: 4, loop: false },
    HAPPY: { frames: [14, 15, 16, 15], fps: 6, loop: true },
    SAD: { frames: [0, 1], fps: 1, loop: true },
    CRY: { frames: [0, 1, 2], fps: 3, loop: true },
    WAG: { frames: [3, 4, 5, 4], fps: 8, loop: true },
    PLAY: { frames: [9, 10, 11, 14, 15], fps: 6, loop: true },
    SNOOZE: { frames: [12, 13], fps: 0.5, loop: true },
};

// Behavior weights for AI decision making — diverse!
export const BEHAVIOR_WEIGHTS: Record<string, number> = {
    IDLE: 18,
    WALK: 18,
    SIT: 8,
    JUMP: 8,
    RUN: 5,
    SLEEP: 5,
    CELEBRATE: 4,
    HAPPY: 8,
    SAD: 3,
    CRY: 2,
    WAG: 8,
    PLAY: 8,
    SNOOZE: 5,
};

// XP Constants
export const XP_CONSTANTS = {
    PER_MINUTE: 2,
    PER_COMMAND: 5,
    PER_FOCUS_SESSION: 50,
    STREAK_MULTIPLIER: 25,
    MAX_LEVEL: 10,
    IDLE_TIMEOUT_SEC: 300,
};

// Health reminder intervals (ms)
export const HEALTH_REMINDERS = {
    SLEEP: { interval: 30 * 60 * 1000, hours: [23, 0, 1, 2, 3, 4] },
    LUNCH: { interval: 20 * 60 * 1000, hours: [12] },
    DINNER: { interval: 20 * 60 * 1000, hours: [18] },
    WATER: { interval: 90 * 60 * 1000, hours: null }, // always
    EYES: { interval: 45 * 60 * 1000, hours: null },
    STANDUP: { interval: 120 * 60 * 1000, hours: null },
};

// Calculate XP needed for next level
export function calcXPToNext(level: number): number {
    return Math.floor(100 * level * 1.5);
}
