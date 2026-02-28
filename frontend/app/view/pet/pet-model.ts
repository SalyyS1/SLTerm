// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

import * as jotai from "jotai";
import type { PetBehavior, PetCatalogueEntry, PetInstance, PetPosition, PlayerProfile, SessionData } from "./pet-types";

// Waifu pixel-art sprite imports (Vite resolves these to URL strings)
import waifuAsunaUrl from "./waifu_asuna_1772301017996.png";
import waifuEmiliaUrl from "./waifu_emilia_1772301065596.png";
import waifuMeguminUrl from "./waifu_megumin_1772300992144.png";
import waifuMikuUrl from "./waifu_miku_1772301115608.png";
import waifuNezukoUrl from "./waifu_nezuko_1772301086037.png";
import waifuRamUrl from "./waifu_ram_1772300977088.png";
import waifuRemUrl from "./waifu_rem_1772301048541.png";
import waifuRiasUrl from "./waifu_rias_1772301130751.png";
import waifuTohruUrl from "./waifu_tohru_1772301145485.png";
import waifuZerotwoUrl from "./waifu_zerotwo_1772300934783.png";

// ============================================================
// Hardcoded catalogue — 50 Pokemon with Pokedex numbers
// ============================================================
export const DEFAULT_CATALOGUE: PetCatalogueEntry[] = [
    // Gen 1 Starters & Favourites
    { id: "pikachu", name: "Pikachu", dexNum: 25 },
    { id: "bulbasaur", name: "Bulbasaur", dexNum: 1 },
    { id: "charmander", name: "Charmander", dexNum: 4 },
    { id: "squirtle", name: "Squirtle", dexNum: 7 },
    { id: "eevee", name: "Eevee", dexNum: 133 },
    { id: "jigglypuff", name: "Jigglypuff", dexNum: 39 },
    { id: "meowth", name: "Meowth", dexNum: 52 },
    { id: "snorlax", name: "Snorlax", dexNum: 143 },
    { id: "gengar", name: "Gengar", dexNum: 94 },
    { id: "mew", name: "Mew", dexNum: 151 },
    // Gen 1 Cute/Popular
    { id: "vulpix", name: "Vulpix", dexNum: 37 },
    { id: "growlithe", name: "Growlithe", dexNum: 58 },
    { id: "psyduck", name: "Psyduck", dexNum: 54 },
    { id: "abra", name: "Abra", dexNum: 63 },
    { id: "machop", name: "Machop", dexNum: 66 },
    { id: "geodude", name: "Geodude", dexNum: 74 },
    { id: "magikarp", name: "Magikarp", dexNum: 129 },
    { id: "ditto", name: "Ditto", dexNum: 132 },
    { id: "porygon", name: "Porygon", dexNum: 137 },
    { id: "lapras", name: "Lapras", dexNum: 131 },
    { id: "dragonite", name: "Dragonite", dexNum: 149 },
    { id: "cubone", name: "Cubone", dexNum: 104 },
    { id: "haunter", name: "Haunter", dexNum: 93 },
    { id: "chansey", name: "Chansey", dexNum: 113 },
    { id: "scyther", name: "Scyther", dexNum: 123 },
    // Gen 2 Favourites
    { id: "togepi", name: "Togepi", dexNum: 175 },
    { id: "chikorita", name: "Chikorita", dexNum: 152 },
    { id: "cyndaquil", name: "Cyndaquil", dexNum: 155 },
    { id: "totodile", name: "Totodile", dexNum: 158 },
    { id: "pichu", name: "Pichu", dexNum: 172 },
    { id: "marill", name: "Marill", dexNum: 183 },
    { id: "umbreon", name: "Umbreon", dexNum: 197 },
    { id: "espeon", name: "Espeon", dexNum: 196 },
    { id: "wobbuffet", name: "Wobbuffet", dexNum: 202 },
    { id: "teddiursa", name: "Teddiursa", dexNum: 216 },
    { id: "larvitar", name: "Larvitar", dexNum: 246 },
    // Gen 3 Favourites
    { id: "mudkip", name: "Mudkip", dexNum: 258 },
    { id: "torchic", name: "Torchic", dexNum: 255 },
    { id: "treecko", name: "Treecko", dexNum: 252 },
    { id: "ralts", name: "Ralts", dexNum: 280 },
    { id: "aron", name: "Aron", dexNum: 304 },
    { id: "absol", name: "Absol", dexNum: 359 },
    { id: "bagon", name: "Bagon", dexNum: 371 },
    { id: "beldum", name: "Beldum", dexNum: 374 },
    // Gen 4 Favourites
    { id: "piplup", name: "Piplup", dexNum: 393 },
    { id: "shinx", name: "Shinx", dexNum: 403 },
    { id: "riolu", name: "Riolu", dexNum: 447 },
    { id: "gible", name: "Gible", dexNum: 443 },
    { id: "munchlax", name: "Munchlax", dexNum: 446 },
    { id: "lucario", name: "Lucario", dexNum: 448 },
    // ===== Anime Waifu Characters =====
    // Detailed chibi SVG sprites with character-specific features
    // NOTE: Waifu sprites use imported pixel-art PNGs (Vite resolves to URL)
    {
        id: "zerotwo",
        name: "Zero Two",
        dexNum: 0,
        type: "waifu",
        customSpriteUrl: waifuZerotwoUrl,
        customGridUrl: waifuZerotwoUrl,
    },
    { id: "rem", name: "Rem", dexNum: 0, type: "waifu", customSpriteUrl: waifuRemUrl, customGridUrl: waifuRemUrl },
    { id: "ram", name: "Ram", dexNum: 0, type: "waifu", customSpriteUrl: waifuRamUrl, customGridUrl: waifuRamUrl },
    {
        id: "megumin",
        name: "Megumin",
        dexNum: 0,
        type: "waifu",
        customSpriteUrl: waifuMeguminUrl,
        customGridUrl: waifuMeguminUrl,
    },
    {
        id: "asuna",
        name: "Asuna",
        dexNum: 0,
        type: "waifu",
        customSpriteUrl: waifuAsunaUrl,
        customGridUrl: waifuAsunaUrl,
    },
    {
        id: "emilia",
        name: "Emilia",
        dexNum: 0,
        type: "waifu",
        customSpriteUrl: waifuEmiliaUrl,
        customGridUrl: waifuEmiliaUrl,
    },
    {
        id: "nezuko",
        name: "Nezuko",
        dexNum: 0,
        type: "waifu",
        customSpriteUrl: waifuNezukoUrl,
        customGridUrl: waifuNezukoUrl,
    },
    {
        id: "miku",
        name: "Hatsune Miku",
        dexNum: 0,
        type: "waifu",
        customSpriteUrl: waifuMikuUrl,
        customGridUrl: waifuMikuUrl,
    },
    { id: "rias", name: "Rias", dexNum: 0, type: "waifu", customSpriteUrl: waifuRiasUrl, customGridUrl: waifuRiasUrl },
    {
        id: "tohru",
        name: "Tohru",
        dexNum: 0,
        type: "waifu",
        customSpriteUrl: waifuTohruUrl,
        customGridUrl: waifuTohruUrl,
    },
];

// ============================================================
// Core pet state
// ============================================================

export const petInstanceAtom = jotai.atom<PetInstance | null>({
    id: "default-pet",
    petId: "pikachu",
    name: "Pikachu",
    level: 1,
    xp: 0,
    xpToNext: 100,
    progress: 0,
    mood: "happy",
    energy: 1.0,
    hunger: 0.2,
    state: "ACTIVE",
    spawnedAt: "",
    totalPlaytime: 0,
} as PetInstance);

export const playerProfileAtom = jotai.atom<PlayerProfile | null>({
    activePetId: "pikachu",
    completedPets: [],
    streakDays: 1,
    lastActiveDate: "",
    totalFocusTime: 0,
    totalCommands: 0,
    achievements: [],
} as PlayerProfile);

export const sessionDataAtom = jotai.atom<SessionData | null>(null);
export const petCatalogueAtom = jotai.atom<PetCatalogueEntry[]>(DEFAULT_CATALOGUE);

// ============================================================
// Frontend-only state
// ============================================================

export const petPositionAtom = jotai.atom<PetPosition>({
    x: 100,
    y: 0,
    facing: "right",
    velocityX: 0,
    velocityY: 0,
});

export const petBehaviorAtom = jotai.atom<PetBehavior>("WALK");
export const currentAnimationAtom = jotai.atom<string>("idle");
export const currentFrameAtom = jotai.atom<number>(0);

// Speech bubble
export const speechBubbleAtom = jotai.atom<{
    text: string;
    visible: boolean;
    type: "dialogue" | "health" | "levelup" | "custom";
}>({
    text: "",
    visible: false,
    type: "dialogue",
});

// Grab & hover
export const isGrabbedAtom = jotai.atom<boolean>(false);
export const isHoveringPetAtom = jotai.atom<boolean>(false);

// Pet visibility & settings
export const petOverlayVisibleAtom = jotai.atom<boolean>(true);
export const petSizeAtom = jotai.atom<number>(68);
export const petEdgeAtom = jotai.atom<"top" | "bottom">("bottom");

// ============================================================
// Food Shop — coins & items
// ============================================================

export const petCoinsAtom = jotai.atom<number>(50);
export const petEnabledAtom = jotai.atom<boolean>(true);

export interface FoodItem {
    id: string;
    name: string;
    emoji: string;
    spriteUrl: string;
    cost: number;
    hungerRestore: number;
    happinessBoost: number;
}

// Pokesprite items for pixel art food
const ITEMS_BASE = "https://raw.githubusercontent.com/msikma/pokesprite/master/items";

export const FOOD_SHOP: FoodItem[] = [
    {
        id: "oran-berry",
        name: "Oran Berry",
        emoji: "🫐",
        spriteUrl: `${ITEMS_BASE}/berry/oran.png`,
        cost: 5,
        hungerRestore: 0.15,
        happinessBoost: 0.05,
    },
    {
        id: "sitrus-berry",
        name: "Sitrus Berry",
        emoji: "🍊",
        spriteUrl: `${ITEMS_BASE}/berry/sitrus.png`,
        cost: 8,
        hungerRestore: 0.2,
        happinessBoost: 0.08,
    },
    {
        id: "potion",
        name: "Potion",
        emoji: "🧃",
        spriteUrl: `${ITEMS_BASE}/medicine/potion.png`,
        cost: 12,
        hungerRestore: 0.25,
        happinessBoost: 0.1,
    },
    {
        id: "rare-candy",
        name: "Rare Candy",
        emoji: "🍬",
        spriteUrl: `${ITEMS_BASE}/medicine/rare-candy.png`,
        cost: 25,
        hungerRestore: 0.3,
        happinessBoost: 0.2,
    },
    {
        id: "poffin",
        name: "Poffin",
        emoji: "🧁",
        spriteUrl: `${ITEMS_BASE}/berry/pecha.png`,
        cost: 35,
        hungerRestore: 0.5,
        happinessBoost: 0.3,
    },
    {
        id: "pokeball-cake",
        name: "Poké Cake",
        emoji: "🎂",
        spriteUrl: `${ITEMS_BASE}/ball/poke.png`,
        cost: 50,
        hungerRestore: 0.8,
        happinessBoost: 0.5,
    },
    {
        id: "master-feast",
        name: "Master Feast",
        emoji: "🍱",
        spriteUrl: `${ITEMS_BASE}/ball/master.png`,
        cost: 100,
        hungerRestore: 1.0,
        happinessBoost: 1.0,
    },
];

export const petInventoryAtom = jotai.atom<Record<string, number>>({
    "oran-berry": 3,
});

// Food drops in terminal overlay
export interface DroppedFood {
    id: string;
    itemId: string;
    x: number;
    y: number;
    falling: boolean;
}
export const droppedFoodAtom = jotai.atom<DroppedFood[]>([]);

// ============================================================
// Derived atoms
// ============================================================

export const petLevelAtom = jotai.atom((get) => get(petInstanceAtom)?.level ?? 1);
export const petProgressAtom = jotai.atom((get) => get(petInstanceAtom)?.progress ?? 0);
export const petMoodAtom = jotai.atom((get) => get(petInstanceAtom)?.mood ?? "neutral");
export const petStateAtom = jotai.atom((get) => get(petInstanceAtom)?.state ?? "ACTIVE");
export const hasPetAtom = jotai.atom((get) => get(petInstanceAtom) != null);
