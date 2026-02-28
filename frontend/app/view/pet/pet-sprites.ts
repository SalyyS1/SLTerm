// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

/**
 * Pet Sprites — Sprite animation engine.
 * Stub for Phase 03 implementation.
 * Will handle: spritesheet loading, frame-by-frame rendering, animation playback.
 */

import type { AnimDef, PetCatalogueEntry } from "./pet-types";

export class SpriteAnimator {
    private spriteSheet: HTMLImageElement | null = null;
    private currentAnim: AnimDef | null = null;
    private currentFrame: number = 0;
    private frameTimer: number = 0;
    private loaded: boolean = false;

    constructor(private catalogue: PetCatalogueEntry) {}

    /**
     * Load the spritesheet image
     */
    async load(): Promise<void> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                this.spriteSheet = img;
                this.loaded = true;
                resolve();
            };
            img.onerror = reject;
            img.src = `/pet-assets/${this.catalogue.spriteSheet}`;
        });
    }

    /**
     * Play an animation by name
     */
    play(animName: string): void {
        const anim = this.catalogue.animations[animName];
        if (anim) {
            this.currentAnim = anim;
            this.currentFrame = 0;
            this.frameTimer = 0;
        }
    }

    /**
     * Advance animation by delta time (seconds)
     */
    update(dt: number): number {
        if (!this.currentAnim) return 0;

        this.frameTimer += dt;
        const frameDuration = 1 / this.currentAnim.fps;

        if (this.frameTimer >= frameDuration) {
            this.frameTimer -= frameDuration;
            this.currentFrame++;

            if (this.currentFrame >= this.currentAnim.frames.length) {
                if (this.currentAnim.loop) {
                    this.currentFrame = 0;
                } else {
                    this.currentFrame = this.currentAnim.frames.length - 1;
                }
            }
        }

        return this.currentAnim.frames[this.currentFrame];
    }

    /**
     * Draw the current frame to a canvas context
     */
    draw(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number = 1): void {
        if (!this.loaded || !this.spriteSheet || !this.currentAnim) return;

        const frameIndex = this.currentAnim.frames[this.currentFrame];
        const fw = this.catalogue.frameWidth;
        const fh = this.catalogue.frameHeight;

        // Calculate source position in spritesheet
        const cols = Math.floor(this.spriteSheet.width / fw);
        const sx = (frameIndex % cols) * fw;
        const sy = Math.floor(frameIndex / cols) * fh;

        ctx.drawImage(this.spriteSheet, sx, sy, fw, fh, x, y, fw * scale, fh * scale);
    }

    isLoaded(): boolean {
        return this.loaded;
    }
}
