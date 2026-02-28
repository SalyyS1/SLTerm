// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

/**
 * Pet Selector — UI component to choose and switch pets.
 * Stub for Phase 07 implementation.
 */

import * as React from "react";

/**
 * PetSelector modal — displays a grid of available pets from the catalogue.
 * User can click to select, with a confirmation dialog.
 */
const PetSelector: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    // TODO: Phase 07 — implement full pet selector grid with pokesprite CSS
    return (
        <div className="pet-selector-overlay" onClick={onClose}>
            <div className="pet-selector-modal" onClick={(e) => e.stopPropagation()}>
                <h3>🐣 Chọn Pet</h3>
                <p>Pet selector sẽ được implement ở Phase 07</p>
                <button onClick={onClose}>Đóng</button>
            </div>
        </div>
    );
};

export { PetSelector };
