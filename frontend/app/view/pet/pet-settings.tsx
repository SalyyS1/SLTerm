// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

import * as jotai from "jotai";
import * as React from "react";
import { petController } from "./pet-controller";
import { petCatalogueAtom, petEnabledAtom, petInstanceAtom, playerProfileAtom } from "./pet-model";
import "./pet-settings.scss";

/**
 * PetSettings — Configuration panel for pet system and Discord RPC.
 * Shown as a floating panel when the pet HUD settings icon is clicked.
 */
const PetSettings: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const [petEnabled, setPetEnabled] = jotai.useAtom(petEnabledAtom);
    const petInstance = jotai.useAtomValue(petInstanceAtom);
    const profile = jotai.useAtomValue(playerProfileAtom);
    const catalogue = jotai.useAtomValue(petCatalogueAtom);
    const [activeTab, setActiveTab] = React.useState<"pet" | "discord">("pet");

    return (
        <div className="pet-settings-overlay" onClick={onClose}>
            <div className="pet-settings-panel" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="pet-settings-header">
                    <h3>🐾 Vibe Settings</h3>
                    <button className="pet-settings-close" onClick={onClose}>
                        ✕
                    </button>
                </div>

                {/* Tabs */}
                <div className="pet-settings-tabs">
                    <button
                        className={`tab ${activeTab === "pet" ? "active" : ""}`}
                        onClick={() => setActiveTab("pet")}
                    >
                        🐣 Pet
                    </button>
                    <button
                        className={`tab ${activeTab === "discord" ? "active" : ""}`}
                        onClick={() => setActiveTab("discord")}
                    >
                        🎮 Discord
                    </button>
                </div>

                {/* Content */}
                <div className="pet-settings-content">
                    {activeTab === "pet" && (
                        <div className="pet-tab">
                            {/* Enable Toggle */}
                            <div className="setting-row">
                                <span>Pet Enabled</span>
                                <label className="toggle-switch">
                                    <input
                                        type="checkbox"
                                        checked={petEnabled}
                                        onChange={(e) => setPetEnabled(e.target.checked)}
                                    />
                                    <span className="toggle-slider" />
                                </label>
                            </div>

                            {/* Current Pet Info */}
                            {petInstance && (
                                <div className="current-pet-info">
                                    <div className="pet-info-header">
                                        <span className="pet-name">{petInstance.name}</span>
                                        <span className="pet-level">LV.{petInstance.level}</span>
                                    </div>
                                    <div className="pet-stats">
                                        <div className="stat">
                                            <span>Mood</span>
                                            <span className="stat-value">
                                                {getMoodEmoji(petInstance.mood)} {petInstance.mood}
                                            </span>
                                        </div>
                                        <div className="stat">
                                            <span>Energy</span>
                                            <div className="stat-bar">
                                                <div
                                                    className="stat-fill energy"
                                                    style={{ width: `${(petInstance.energy ?? 1) * 100}%` }}
                                                />
                                            </div>
                                        </div>
                                        <div className="stat">
                                            <span>Hunger</span>
                                            <div className="stat-bar">
                                                <div
                                                    className="stat-fill hunger"
                                                    style={{ width: `${(petInstance.hunger ?? 0) * 100}%` }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Pet Selector */}
                            <div className="pet-selector">
                                <h4>Choose Your Pet</h4>
                                <div className="pet-grid">
                                    {catalogue.map((entry) => (
                                        <button
                                            key={entry.id}
                                            className={`pet-option ${petInstance?.petId === entry.id ? "selected" : ""}`}
                                            onClick={() => petController.selectPet(entry.id)}
                                        >
                                            <span className="pet-icon">{getPetIcon(entry.id)}</span>
                                            <span className="pet-name">{entry.name}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Stats */}
                            {profile && (
                                <div className="profile-stats">
                                    <h4>Stats</h4>
                                    <div className="stat-row">
                                        <span>🔥 Streak</span>
                                        <span>{profile.streakDays} days</span>
                                    </div>
                                    <div className="stat-row">
                                        <span>⌨️ Commands</span>
                                        <span>{profile.totalCommands}</span>
                                    </div>
                                    <div className="stat-row">
                                        <span>⏱️ Focus Time</span>
                                        <span>{Math.floor((profile.totalFocusTime ?? 0) / 3600)}h</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === "discord" && (
                        <div className="discord-tab">
                            <div className="setting-row">
                                <span>Discord Rich Presence</span>
                                <label className="toggle-switch">
                                    <input type="checkbox" />
                                    <span className="toggle-slider" />
                                </label>
                            </div>
                            <div className="discord-preview">
                                <div className="discord-card">
                                    <div className="discord-icon">🎮</div>
                                    <div className="discord-info">
                                        <div className="discord-title">SLTerm</div>
                                        <div className="discord-detail">
                                            Coding with {petInstance?.name || "Pikachu"}
                                        </div>
                                        <div className="discord-detail">
                                            LV.{petInstance?.level || 1} • {petInstance?.mood || "happy"}
                                        </div>
                                    </div>
                                </div>
                                <p className="discord-note">Shows your pet and coding activity on Discord</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

function getMoodEmoji(mood: string): string {
    const map: Record<string, string> = {
        happy: "😊",
        neutral: "😐",
        sad: "😢",
        hungry: "🤤",
        sleepy: "😪",
    };
    return map[mood] || "😐";
}

function getPetIcon(id: string): string {
    const map: Record<string, string> = {
        pikachu: "⚡",
        bulbasaur: "🌿",
        charmander: "🔥",
        squirtle: "💧",
        eevee: "🦊",
        jigglypuff: "🎤",
        meowth: "😺",
        snorlax: "😴",
        gengar: "👻",
        mew: "✨",
    };
    return map[id] || "🐣";
}

export { PetSettings };
