// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

import * as jotai from "jotai";
import * as React from "react";
import "./pet-hud.scss";
import { petEnabledAtom, petInstanceAtom, playerProfileAtom } from "./pet-model";

/**
 * PetHUD — Compact heads-up display showing pet level, XP bar, and streak counter.
 * Settings are in the main Settings page (SettingsCategory "Pet System" and "Discord").
 */
const PetHUD: React.FC = () => {
    const petEnabled = jotai.useAtomValue(petEnabledAtom);
    const petInstance = jotai.useAtomValue(petInstanceAtom);
    const profile = jotai.useAtomValue(playerProfileAtom);

    if (!petEnabled || !petInstance) {
        return null;
    }

    const xpPercent = Math.round(petInstance.progress * 100);

    return (
        <div className="pet-hud">
            <div className="pet-hud-info">
                <span className="pet-hud-name">{petInstance.name}</span>
                <span className="pet-hud-level">LV.{petInstance.level}</span>
            </div>
            <div className="pet-hud-xpbar">
                <div className="xp-fill" style={{ width: `${xpPercent}%` }} />
            </div>
            <div className="pet-hud-actions">
                {profile && profile.streakDays > 0 && <span className="pet-hud-streak">🔥{profile.streakDays}</span>}
            </div>
        </div>
    );
};

export { PetHUD };
