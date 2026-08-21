// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

/**
 * Pet Controller — Frontend RPC bridge to Go backend.
 * Handles: state sync, dialogue polling, activity tracking, persist lifecycle.
 */

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { globalStore } from "@/store/global";
// Note: behavior scheduling is in pet-overlay.tsx's rAF loop, not here
import { petInstanceAtom, playerProfileAtom, speechBubbleAtom } from "./pet-model";
import type { PlayerProfile } from "./pet-types";

/** Random delay between dialogues: 45-90 seconds */
function getDialogueDelay(): number {
    return 45_000 + Math.random() * 45_000;
}

class PetController {
    private syncInterval: ReturnType<typeof setInterval> | null = null;
    private dialogueTimeout: ReturnType<typeof setTimeout> | null = null;
    // behavior is managed by pet-overlay.tsx rAF loop, not controller
    private running = false;

    /** Start the pet controller — call once on app mount */
    async start(): Promise<void> {
        if (this.running) return;
        this.running = true;

        await this.syncState();
        await this.loadCatalogue();

        this.syncInterval = setInterval(() => this.syncState(), 30000);
        this.scheduleNextDialogue();
        // behavior changes handled by pet-overlay.tsx rAF loop
    }

    /** Stop the pet controller */
    stop(): void {
        this.running = false;
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
        if (this.dialogueTimeout) {
            clearTimeout(this.dialogueTimeout);
            this.dialogueTimeout = null;
        }
        // behavior timer is in pet-overlay.tsx, not here
    }

    /** Show a terminal reaction as a speech bubble */
    showTerminalReaction(text: string): void {
        globalStore.set(speechBubbleAtom, { text, visible: true, type: "custom" as any });
        setTimeout(() => {
            globalStore.set(speechBubbleAtom, { text: "", visible: false, type: "dialogue" });
        }, 5000);
    }

    /** Select a pet from the catalogue — sets atom directly, no backend sync */
    async selectPet(petId: string): Promise<void> {
        // Fire-and-forget so a slow backend can't stall the UI, but a rejection
        // must stay visible: this call silently did nothing for its whole life
        // because it named a command that does not exist (PetSelectCommand) and
        // an `as any` cast plus a swallowing .catch() hid both facts.
        try {
            await RpcApi.PetSelectPetCommand(TabRpcClient, { petId });
        } catch (err) {
            console.error("PetSelectPetCommand failed:", err);
        }
    }

    /** Sync profile/session from backend (pet selection stays in frontend) */
    async syncState(): Promise<void> {
        try {
            const [, profile, session] = await Promise.all([
                Promise.resolve(null), // pet state managed locally, not synced from backend
                RpcApi.PetGetProfileCommand(TabRpcClient),
                RpcApi.PetGetSessionCommand(TabRpcClient),
            ]);
            // DO NOT overwrite petInstanceAtom — user's pet selection is local
            if (profile) globalStore.set(playerProfileAtom, profile as PlayerProfile);
            // session data is read-only, no need to sync
        } catch (err) {
            console.warn("[PetController] syncState failed:", err);
        }
    }

    /** Load pet catalogue — using hardcoded DEFAULT_CATALOGUE (50 Pokemon) */
    async loadCatalogue(): Promise<void> {
        // Backend only has 10 entries — we use the hardcoded 50-entry
        // DEFAULT_CATALOGUE in pet-model.ts instead.
        // No-op: the atom already initializes with DEFAULT_CATALOGUE.
    }

    /** Interact with pet (pet, feed, etc.) — no atom overwrite */
    async interact(action: string): Promise<void> {
        // Fire-and-forget to backend, don't overwrite petInstanceAtom. Failures
        // are logged rather than swallowed so a renamed/removed command shows up
        // instead of silently doing nothing.
        try {
            await RpcApi.PetInteractCommand(TabRpcClient, { action });
        } catch (err) {
            console.error("PetInteractCommand failed:", err);
        }
    }

    /** Local dialogue system — no backend needed */
    async requestDialogue(): Promise<void> {
        const pet = globalStore.get(petInstanceAtom);
        if (!pet) return;

        const mood = (pet.mood || "neutral") as string;
        const hour = new Date().getHours();

        // Hardcoded dialogue pool — mood + time-aware
        const dialogues: Record<string, string[]> = {
            happy: [
                "Hôm nay vui quá! 🎉",
                "Code thêm đi ba ơi~",
                "Tui thích ở đây lắm! ✨",
                "*nhảy nhảy* Yeee!",
                "Debug xong chưa? 😆",
            ],
            neutral: [
                "Hmm... commit chưa nhỉ? 🤔",
                "*ngáp* Làm gì đó đi~",
                "git push đi ba!",
                "Tui ngồi đây chill thôi 😌",
                "Console sạch chưa? 👀",
            ],
            sad: [
                "Buồn ghê... vuốt tui đi 🥺",
                "*thở dài*",
                "Lỗi nhiều quá hà...",
                "Cho tui ăn gì đi mà 😢",
                "Tui nhớ nhà...",
            ],
            sleepy: [
                "*ngáp rộng* Buồn ngủ quá...",
                "Zzz... 5 phút nữa...",
                "Đi ngủ thôi ba ơi 😴",
                "*gật gù*",
                "Khuya rồi mà...",
            ],
            hungry: [
                "Đói bụng rồi nè! 🍕",
                "Cho tui ăn gì đi ba!",
                "*bụng kêu* Grrrr...",
                "Candy! Candy! 🍬",
                "Tui cần năng lượng... 😩",
            ],
        };

        // Late night dialogues
        if (hour >= 23 || hour < 5) {
            const lateNight = ["Khuya rồi, đi ngủ đi ba! 🌙", "Mắt tui díp rồi...", "Ngày mai code tiếp ha 😴"];
            const text = lateNight[Math.floor(Math.random() * lateNight.length)];
            this.showSpeechBubble(text, "dialogue");
            return;
        }

        const pool = dialogues[mood] || dialogues.neutral;
        const text = pool[Math.floor(Math.random() * pool.length)];
        this.showSpeechBubble(text, "dialogue");
    }

    /** Show speech bubble with auto-dismiss */
    private showSpeechBubble(text: string, type: "dialogue" | "health" | "levelup" | "custom"): void {
        globalStore.set(speechBubbleAtom, { text, visible: true, type });
        const readTime = Math.max(3000, Math.min(text.length * 100, 8000));
        setTimeout(() => {
            globalStore.set(speechBubbleAtom, { text: "", visible: false, type: "dialogue" });
        }, readTime);
    }

    /** Schedule next dialogue */
    private scheduleNextDialogue(): void {
        if (!this.running) return;
        const delay = getDialogueDelay();
        this.dialogueTimeout = setTimeout(() => {
            this.requestDialogue();
            this.scheduleNextDialogue();
        }, delay);
    }

    // Behavior scheduling removed — handled by pet-overlay.tsx rAF loop
    // Having two behavior timers caused jitter (both fighting to set petBehaviorAtom)
}

export const petController = new PetController();
