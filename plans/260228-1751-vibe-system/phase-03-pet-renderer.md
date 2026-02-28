# Phase 03: Pet Renderer (Frontend)

Status: ⬜ Pending
Dependencies: Phase 02

## Objective

Render con pet lên màn hình terminal bằng Canvas overlay. Pet hiển thị sprite animation frame-by-frame từ pokesprite/Shimeji spritesheet.

## Implementation Steps

1. [ ] **Tạo PetOverlay component** (`pet-overlay.tsx`)
   - React component render `<canvas>` overlay phía trên terminal
   - Position: `absolute`, z-index cao hơn terminal content
   - Trong suốt (transparent background) để không che terminal
   - Kích thước = kích thước terminal block

2. [ ] **Sprite Animation Engine** (`pet-sprites.ts`)
   - Load spritesheet image (pokesprite PNG)
   - Parse sprite frames từ CSS hoặc JSON manifest
   - `SpriteAnimator` class:
     - `play(animation: string)` — "walk", "idle", "jump", "sleep"
     - `setDirection(dir: "left" | "right")` — lật sprite theo hướng
     - `update(dt: number)` — advance frame theo delta time
     - `draw(ctx: CanvasRenderingContext2D, x, y)` — vẽ frame hiện tại

3. [ ] **Animation definitions** (`pet-sprites.ts`)

   ```ts
   const ANIMATIONS = {
     idle: { frames: [0, 1, 2, 1], fps: 2, loop: true },
     walk: { frames: [3, 4, 5, 4], fps: 6, loop: true },
     run: { frames: [6, 7, 8, 7], fps: 10, loop: true },
     jump: { frames: [9, 10, 11], fps: 8, loop: false },
     sleep: { frames: [12, 13], fps: 1, loop: true },
     celebrate: { frames: [14, 15, 16, 15], fps: 8, loop: true },
     sit: { frames: [17], fps: 1, loop: true },
     grabbed: { frames: [18, 19], fps: 4, loop: true }, // chân đạp đạp
     fall: { frames: [20, 21], fps: 6, loop: false }, // rơi bụp
     dizzy: { frames: [22, 23], fps: 3, loop: false }, // choáng sau khi rơi
     pet: { frames: [24, 25, 26], fps: 4, loop: false }, // được vuốt ve
   };
   ```

4. [ ] **Canvas render loop** (`pet-overlay.tsx`)
   - `requestAnimationFrame` loop
   - Clear → Draw pet sprite → Draw speech bubble (nếu có)
   - Target: 30 FPS (nhẹ nhàng, tiết kiệm CPU)

5. [ ] **Pet position state** (`pet-model.ts`)
   - Jotai atoms for pet position `{ x, y }`
   - Jotai atoms for current animation
   - Jotai atoms for pet data (from Go backend via RPC)

6. [ ] **Mount PetOverlay vào terminal view**
   - Thêm `<PetOverlay />` vào terminal block component
   - Overlay chỉ hiện khi user có pet active
   - Conditionally render dựa trên setting `pet:enabled`

7. [ ] **Pokesprite integration:**
   - Copy pokesprite CSS + spritesheet vào `public/pet-assets/`
   - Fallback: nếu không có custom spritesheet, dùng CSS sprites
   - Mỗi Pokémon = 1 sprite (static) cho MVP, animation sau

8. [ ] **Pet facing direction:**
   - Pet nhìn theo hướng di chuyển (flip horizontal)
   - CSS `transform: scaleX(-1)` hoặc canvas flip

9. [ ] **Performance safeguards:**
   - Pause render loop khi terminal tab không active
   - Debounce position updates
   - Canvas chỉ redraw khi có thay đổi (dirty flag)

10. [ ] **Setting toggle:**
    - `pet:enabled` (boolean) — bật/tắt pet
    - Thêm vào Settings UI (waveconfig)

## Files to Create/Modify

| Path                                     | Action | Purpose                  |
| ---------------------------------------- | ------ | ------------------------ |
| `frontend/app/view/pet/pet-overlay.tsx`  | NEW    | Canvas overlay component |
| `frontend/app/view/pet/pet-overlay.scss` | NEW    | Overlay styles           |
| `frontend/app/view/pet/pet-sprites.ts`   | NEW    | Sprite animation engine  |
| `frontend/app/view/pet/pet-model.ts`     | NEW    | Jotai state atoms        |
| `frontend/app/view/pet/pet-types.ts`     | NEW    | TypeScript types         |
| `frontend/app/view/term/term.tsx`        | MODIFY | Mount PetOverlay         |
| `public/pet-assets/`                     | NEW    | Sprite assets            |

## Test Criteria

- [ ] Pet sprite hiển thị trên terminal
- [ ] Animation chạy mượt mà (30 FPS)
- [ ] Pet không che chắn text gõ
- [ ] Pet toggle on/off hoạt động
- [ ] Canvas pause khi tab không active

---

Next Phase: → Phase 04 (Pet AI & Free-Roaming)
