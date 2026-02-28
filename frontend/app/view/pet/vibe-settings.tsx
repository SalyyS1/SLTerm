// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

/**
 * Vibe Settings — Pet System, Food Shop (buy → drop to terminal), Discord.
 */

import {
    droppedFoodAtom,
    FOOD_SHOP,
    petCatalogueAtom,
    petCoinsAtom,
    petEdgeAtom,
    petEnabledAtom,
    petInstanceAtom,
    petInventoryAtom,
    petSizeAtom,
    playerProfileAtom,
    type DroppedFood,
    type FoodItem,
} from "@/app/view/pet/pet-model";
import "@/app/view/pet/vibe-settings.scss";
import { SettingsCategory } from "@/app/view/waveconfig/setting-controls";
import * as jotai from "jotai";
import { memo, useCallback, useState } from "react";

// Static sprites for grid — PokeAPI dexNum URLs (100% reliable)
const POKEAPI_SPRITES = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";
const SHOWDOWN_ANI = "https://play.pokemonshowdown.com/sprites/ani";

// ============================================================
// Main Vibe Settings Page
// ============================================================
const VibeSettingsContent = memo(({ model }: { model: any }) => {
    return (
        <div className="@container flex flex-col gap-4 p-4 overflow-y-auto h-full vibe-settings-page">
            <PetSystemSection />
            <FoodShopSection />
            <PetDialogueSection />
            <DiscordSection />
        </div>
    );
});
VibeSettingsContent.displayName = "VibeSettingsContent";

// ============================================================
// Pet System Section
// ============================================================
const PetSystemSection = memo(() => {
    const [petEnabled, setPetEnabled] = jotai.useAtom(petEnabledAtom);
    const [petInstance, setPetInstance] = jotai.useAtom(petInstanceAtom);
    const catalogue = jotai.useAtomValue(petCatalogueAtom);
    const profile = jotai.useAtomValue(playerProfileAtom);
    const [petSize, setPetSize] = jotai.useAtom(petSizeAtom);
    const [petEdge, setPetEdge] = jotai.useAtom(petEdgeAtom);

    const selectPet = useCallback(
        (entry: any) => {
            if (petInstance) {
                setPetInstance({ ...petInstance, petId: entry.id, name: entry.name });
            }
        },
        [petInstance, setPetInstance]
    );

    return (
        <SettingsCategory title="🐾 Pet System" icon="paw">
            {/* Enable / Disable */}
            <div className="flex items-center justify-between gap-3">
                <span className="text-secondary text-sm">Enable Desktop Pet</span>
                <label className="vibe-toggle">
                    <input type="checkbox" checked={petEnabled} onChange={(e) => setPetEnabled(e.target.checked)} />
                    <span className="vibe-toggle-slider" />
                </label>
            </div>

            {/* Pet Stats — Pixelmon-style level bar */}
            {petInstance && (
                <div className="vibe-pet-stats">
                    <div className="vibe-pet-stats-header">
                        <img
                            src={`${SHOWDOWN_ANI}/${petInstance.petId}.gif`}
                            alt={petInstance.name}
                            className="vibe-pet-stats-sprite"
                            onError={(e) => {
                                (e.target as HTMLImageElement).src = `${POKEAPI_SPRITES}/${25}.png`;
                            }}
                        />
                        <div className="vibe-pet-info">
                            <div className="vibe-pet-stats-name">{petInstance.name}</div>
                            {/* Pixelmon-style level badge */}
                            <div className="vibe-level-badge">
                                <span className="vibe-level-label">Lv</span>
                                <span className="vibe-level-num">{petInstance.level}</span>
                            </div>
                        </div>
                        <div className="vibe-pet-stats-xp">
                            {/* Pixelmon-style XP bar */}
                            <div className="vibe-xp-bar pixelmon">
                                <div
                                    className="vibe-xp-fill"
                                    style={{ width: `${Math.round(petInstance.progress * 100)}%` }}
                                />
                            </div>
                            <span className="vibe-xp-text">
                                {petInstance.xp}/{petInstance.xpToNext} EXP
                            </span>
                        </div>
                    </div>
                    <div className="vibe-pet-stat-grid">
                        <div className="vibe-stat-item">
                            <span className="vibe-stat-label">Mood</span>
                            <span className="vibe-stat-value">
                                {getMoodEmoji(petInstance.mood)} {petInstance.mood}
                            </span>
                        </div>
                        <div className="vibe-stat-item">
                            <span className="vibe-stat-label">Energy</span>
                            <div className="vibe-stat-bar">
                                <div
                                    className="vibe-stat-fill energy"
                                    style={{ width: `${(petInstance.energy ?? 1) * 100}%` }}
                                />
                            </div>
                        </div>
                        <div className="vibe-stat-item">
                            <span className="vibe-stat-label">Hunger</span>
                            <div className="vibe-stat-bar">
                                <div
                                    className="vibe-stat-fill hunger"
                                    style={{ width: `${(petInstance.hunger ?? 0) * 100}%` }}
                                />
                            </div>
                        </div>
                        {profile && (
                            <div className="vibe-stat-item">
                                <span className="vibe-stat-label">Streak</span>
                                <span className="vibe-stat-value">🔥 {profile.streakDays} days</span>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Pet Size + Position */}
            <div className="vibe-pet-size">
                <span className="text-secondary text-sm">Pet Size: {petSize}px</span>
                <input
                    type="range"
                    min="32"
                    max="128"
                    step="4"
                    value={petSize}
                    onChange={(e) => setPetSize(Number(e.target.value))}
                    className="vibe-slider"
                />
            </div>
            <div className="flex items-center justify-between gap-3">
                <span className="text-secondary text-sm">Position</span>
                <div className="vibe-edge-toggle">
                    <button
                        className={`vibe-edge-btn ${petEdge === "bottom" ? "active" : ""}`}
                        onClick={() => setPetEdge("bottom")}
                    >
                        ⬇ Bottom
                    </button>
                    <button
                        className={`vibe-edge-btn ${petEdge === "top" ? "active" : ""}`}
                        onClick={() => setPetEdge("top")}
                    >
                        ⬆ Top
                    </button>
                </div>
            </div>

            {/* Pet Selector Grid — scrollable, shows all 50 Pokemon */}
            <div className="vibe-pet-selector">
                <span className="text-secondary text-sm block mb-2">
                    Choose Your Pet ({catalogue.length} available)
                </span>
                <div className="vibe-pet-grid" style={{ maxHeight: "280px", overflowY: "auto", paddingRight: "4px" }}>
                    {catalogue.map((entry) => (
                        <button
                            key={entry.id}
                            onClick={() => selectPet(entry)}
                            className={`vibe-pet-option ${petInstance?.petId === entry.id ? "selected" : ""}`}
                        >
                            <img
                                src={entry.customGridUrl || `${POKEAPI_SPRITES}/${entry.dexNum}.png`}
                                alt={entry.name}
                                className="vibe-pet-sprite"
                            />
                            <span className="vibe-pet-name">{entry.name}</span>
                        </button>
                    ))}
                </div>
            </div>
        </SettingsCategory>
    );
});
PetSystemSection.displayName = "PetSystemSection";

// ============================================================
// Food Shop — buy food, it DROPS into terminal overlay
// ============================================================
const FoodShopSection = memo(() => {
    const [coins, setCoins] = jotai.useAtom(petCoinsAtom);
    const [inventory, setInventory] = jotai.useAtom(petInventoryAtom);
    const [droppedFood, setDroppedFood] = jotai.useAtom(droppedFoodAtom);
    const petInstance = jotai.useAtomValue(petInstanceAtom);
    const [buyMsg, setBuyMsg] = useState<string>("");

    // Buy = add to inventory
    const buyFood = useCallback(
        (item: FoodItem) => {
            if (coins < item.cost) {
                setBuyMsg(`Không đủ coin! Cần ${item.cost} 🪙`);
                setTimeout(() => setBuyMsg(""), 2000);
                return;
            }
            setCoins(coins - item.cost);
            setInventory((prev: Record<string, number>) => ({
                ...prev,
                [item.id]: (prev[item.id] || 0) + 1,
            }));
            setBuyMsg(`Đã mua ${item.name}!`);
            setTimeout(() => setBuyMsg(""), 2000);
        },
        [coins]
    );

    // Drop food from inventory → falls into terminal overlay
    const dropFood = useCallback(
        (itemId: string) => {
            const count = inventory[itemId] || 0;
            if (count <= 0) return;

            // Remove from inventory
            setInventory((prev: Record<string, number>) => ({
                ...prev,
                [itemId]: Math.max(0, (prev[itemId] || 0) - 1),
            }));

            // Create dropped food in overlay — random X, starts at top
            const newFood: DroppedFood = {
                id: `food-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                itemId: itemId,
                x: 50 + Math.random() * 300,
                y: 0,
                falling: true,
            };
            setDroppedFood((prev: DroppedFood[]) => [...prev, newFood]);
        },
        [inventory]
    );

    return (
        <SettingsCategory title="🛒 Food Shop" icon="shopping-bag">
            <div className="vibe-shop-header">
                <span className="vibe-coin-balance">🪙 {coins} coins</span>
                <span className="text-muted-foreground text-xs">(+1 coin/phút)</span>
            </div>

            {buyMsg && <div className="vibe-shop-msg">{buyMsg}</div>}

            {/* Shop items */}
            <div className="vibe-shop-grid">
                {FOOD_SHOP.map((item) => (
                    <div key={item.id} className="vibe-shop-item">
                        <div className="vibe-shop-item-icon">
                            <img
                                src={item.spriteUrl}
                                alt={item.name}
                                className="vibe-food-pixel"
                                onError={(e) => {
                                    (e.target as HTMLImageElement).outerHTML = `<span>${item.emoji}</span>`;
                                }}
                            />
                        </div>
                        <div className="vibe-shop-item-info">
                            <span className="vibe-shop-item-name">{item.name}</span>
                            <span className="vibe-shop-item-effect">
                                🍽 -{Math.round(item.hungerRestore * 100)}% hunger
                            </span>
                        </div>
                        <button className="vibe-shop-buy" onClick={() => buyFood(item)} disabled={coins < item.cost}>
                            🪙 {item.cost}
                        </button>
                    </div>
                ))}
            </div>

            {/* Inventory — click to DROP food into terminal */}
            <div className="vibe-inventory">
                <span className="text-secondary text-sm block mb-2">
                    🎒 Inventory (bấm để thả đồ ăn xuống terminal)
                </span>
                <div className="vibe-inventory-grid">
                    {FOOD_SHOP.filter((item) => (inventory[item.id] || 0) > 0).map((item) => (
                        <button
                            key={item.id}
                            className="vibe-inventory-item"
                            onClick={() => dropFood(item.id)}
                            title={`Drop ${item.name} to terminal`}
                        >
                            <img
                                src={item.spriteUrl}
                                alt={item.name}
                                className="vibe-inv-pixel"
                                onError={(e) => {
                                    (e.target as HTMLImageElement).outerHTML =
                                        `<span class="vibe-inv-icon">${item.emoji}</span>`;
                                }}
                            />
                            <span className="vibe-inv-count">×{inventory[item.id] || 0}</span>
                            <span className="vibe-inv-feed">Drop</span>
                        </button>
                    ))}
                    {FOOD_SHOP.every((item) => (inventory[item.id] || 0) === 0) && (
                        <span className="text-muted-foreground text-xs">
                            Inventory trống — mua đồ ăn ở shop trên nha!
                        </span>
                    )}
                </div>
            </div>

            {/* Hunger status */}
            {petInstance && (
                <div className="vibe-hunger-status">
                    <span className="text-secondary text-sm">
                        {(petInstance.hunger ?? 0) <= 0.02
                            ? "Pet đang no! Nếu ép ăn nó sẽ từ chối~"
                            : (petInstance.hunger ?? 0) >= 0.7
                              ? "Pet đói quá! Thả đồ ăn xuống terminal rồi kéo vô pet!"
                              : "Thả đồ ăn từ inventory → rơi xuống terminal → kéo vô pet để cho ăn"}
                    </span>
                </div>
            )}
        </SettingsCategory>
    );
});
FoodShopSection.displayName = "FoodShopSection";

// ============================================================
// Pet Dialogue Section
// ============================================================
const PetDialogueSection = memo(() => {
    const [dialogues, setDialogues] = useState([
        {
            textVi: "Em đói rồi, đại ca đừng làm nữa cho em ăn đê",
            textEn: "I'm hungry, let's take a food break!",
            mood: "hungry",
        },
        { textVi: "Em buồn ngủ quá, ngủ đi mà~", textEn: "So sleepy... time for bed~", mood: "sleepy" },
        { textVi: "Code giỏi quá đại ca!", textEn: "Great coding, master!", mood: "happy" },
    ]);
    const [newVi, setNewVi] = useState("");
    const [newEn, setNewEn] = useState("");
    const [newMood, setNewMood] = useState("happy");

    const addDialogue = useCallback(() => {
        if (!newVi && !newEn) return;
        setDialogues((prev) => [...prev, { textVi: newVi, textEn: newEn, mood: newMood }]);
        setNewVi("");
        setNewEn("");
    }, [newVi, newEn, newMood]);

    return (
        <SettingsCategory title="💬 Pet Dialogues" icon="comments">
            <span className="text-secondary text-sm">Customize what your pet says.</span>
            <div className="vibe-dialogue-list">
                {dialogues.map((d, i) => (
                    <div key={i} className="vibe-dialogue-item">
                        <div className="vibe-dialogue-texts">
                            <span className="vibe-dialogue-vi">🇻🇳 {d.textVi}</span>
                            <span className="vibe-dialogue-en">🇺🇸 {d.textEn}</span>
                        </div>
                        <div className="vibe-dialogue-meta">
                            <span className="vibe-dialogue-mood">{getMoodEmoji(d.mood)}</span>
                            <button
                                className="vibe-dialogue-remove"
                                onClick={() => setDialogues((p) => p.filter((_, j) => j !== i))}
                            >
                                ✕
                            </button>
                        </div>
                    </div>
                ))}
            </div>
            <div className="vibe-dialogue-add">
                <input
                    type="text"
                    placeholder="🇻🇳 Tiếng Việt..."
                    value={newVi}
                    onChange={(e) => setNewVi(e.target.value)}
                    className="vibe-input"
                />
                <input
                    type="text"
                    placeholder="🇺🇸 English..."
                    value={newEn}
                    onChange={(e) => setNewEn(e.target.value)}
                    className="vibe-input"
                />
                <div className="vibe-dialogue-add-row">
                    <select value={newMood} onChange={(e) => setNewMood(e.target.value)} className="vibe-select">
                        <option value="happy">😊 Happy</option>
                        <option value="neutral">😐 Neutral</option>
                        <option value="sad">😢 Sad</option>
                        <option value="hungry">🤤 Hungry</option>
                        <option value="sleepy">😪 Sleepy</option>
                    </select>
                    <button onClick={addDialogue} className="vibe-btn-add">
                        + Add
                    </button>
                </div>
            </div>
            <div className="vibe-health-section">
                <span className="text-secondary text-sm block mb-2">Health Reminders</span>
                <div className="vibe-health-grid">
                    <label className="vibe-health-toggle">
                        <input type="checkbox" defaultChecked />
                        <span>💤 Sleep (11pm-4am)</span>
                    </label>
                    <label className="vibe-health-toggle">
                        <input type="checkbox" defaultChecked />
                        <span>🍱 Meal (12pm, 6pm)</span>
                    </label>
                    <label className="vibe-health-toggle">
                        <input type="checkbox" defaultChecked />
                        <span>💧 Water (90min)</span>
                    </label>
                    <label className="vibe-health-toggle">
                        <input type="checkbox" defaultChecked />
                        <span>👀 Eye rest (45min)</span>
                    </label>
                </div>
            </div>
        </SettingsCategory>
    );
});
PetDialogueSection.displayName = "PetDialogueSection";

// ============================================================
// Discord Section
// ============================================================
const DiscordSection = memo(() => {
    const petInstance = jotai.useAtomValue(petInstanceAtom);
    const profile = jotai.useAtomValue(playerProfileAtom);
    const [discordEnabled, setDiscordEnabled] = useState(false);
    const [labelLevel, setLabelLevel] = useState("LV.");
    const [detailLine1, setDetailLine1] = useState("Coding with {petName}");
    const [detailLine2, setDetailLine2] = useState("{levelLabel}{level} • {mood}");
    const [largeImageText, setLargeImageText] = useState("SLTerm");

    const previewLine1 = detailLine1.replace("{petName}", petInstance?.name || "Pikachu");
    const previewLine2 = detailLine2
        .replace("{levelLabel}", labelLevel)
        .replace("{level}", String(petInstance?.level || 1))
        .replace("{mood}", petInstance?.mood || "happy")
        .replace("{petName}", petInstance?.name || "Pikachu");

    return (
        <SettingsCategory title="🎮 Discord Rich Presence" icon="gamepad">
            <div className="flex items-center justify-between gap-3">
                <span className="text-secondary text-sm">Enable Discord Activity</span>
                <label className="vibe-toggle">
                    <input
                        type="checkbox"
                        checked={discordEnabled}
                        onChange={(e) => setDiscordEnabled(e.target.checked)}
                    />
                    <span className="vibe-toggle-slider" />
                </label>
            </div>
            <div className="vibe-discord-customize">
                <span className="text-secondary text-sm block mb-2">Customize Display</span>
                <div className="vibe-discord-field">
                    <label>Detail Line 1</label>
                    <input
                        type="text"
                        value={detailLine1}
                        onChange={(e) => setDetailLine1(e.target.value)}
                        className="vibe-input"
                    />
                </div>
                <div className="vibe-discord-field">
                    <label>Detail Line 2</label>
                    <input
                        type="text"
                        value={detailLine2}
                        onChange={(e) => setDetailLine2(e.target.value)}
                        className="vibe-input"
                    />
                </div>
                <div className="vibe-discord-field-row">
                    <div className="vibe-discord-field">
                        <label>Level Label</label>
                        <input
                            type="text"
                            value={labelLevel}
                            onChange={(e) => setLabelLevel(e.target.value)}
                            className="vibe-input"
                        />
                    </div>
                    <div className="vibe-discord-field">
                        <label>Large Image Text</label>
                        <input
                            type="text"
                            value={largeImageText}
                            onChange={(e) => setLargeImageText(e.target.value)}
                            className="vibe-input"
                        />
                    </div>
                </div>
                <span className="text-muted-foreground text-[10px]">
                    Variables: {"{petName}"}, {"{level}"}, {"{levelLabel}"}, {"{mood}"}, {"{streak}"}
                </span>
            </div>
            <div className="vibe-discord-preview">
                <span className="text-secondary text-sm block mb-2">Preview</span>
                <div className="vibe-discord-card">
                    <div className="vibe-discord-card-icon">
                        <img
                            src={petInstance ? `${SHOWDOWN_ANI}/${petInstance.petId}.gif` : ""}
                            alt="pet"
                            className="vibe-discord-sprite"
                            onError={(e) => {
                                (e.target as HTMLImageElement).outerHTML = '<span style="font-size:24px">🎮</span>';
                            }}
                        />
                    </div>
                    <div className="vibe-discord-card-info">
                        <div className="vibe-discord-card-title">{largeImageText}</div>
                        <div className="vibe-discord-card-detail">{previewLine1}</div>
                        <div className="vibe-discord-card-detail">
                            {previewLine2}
                            {profile && profile.streakDays > 0 ? ` • 🔥${profile.streakDays}d` : ""}
                        </div>
                        <div className="vibe-discord-card-time">12:34 elapsed</div>
                    </div>
                </div>
            </div>
        </SettingsCategory>
    );
});
DiscordSection.displayName = "DiscordSection";

// ============================================================
function getMoodEmoji(mood: string): string {
    return ({ happy: "😊", neutral: "😐", sad: "😢", hungry: "🤤", sleepy: "😪" } as any)[mood] || "😐";
}

export { VibeSettingsContent };
