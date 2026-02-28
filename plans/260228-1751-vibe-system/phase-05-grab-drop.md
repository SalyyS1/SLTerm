# Phase 05: Grab & Drop + User Interaction

Status: ⬜ Pending
Dependencies: Phase 04

## Objective

User có thể nhấc pet lên bằng chuột (grab), kéo di chuyển, thả rơi bụp xuống. Click nhẹ = vuốt ve.

## Implementation Steps

1. [ ] **Cursor states** (`pet-grab.ts`)

   ```css
   .pet-overlay {
     cursor: default;
   }
   .pet-overlay.pet-hover {
     cursor: grab;
   }
   .pet-overlay.pet-grabbing {
     cursor: grabbing;
   }
   ```

2. [ ] **Hit detection:**
   - Mouse position so với pet bounding box
   - Hover trong vùng pet → cursor `grab` 🤚
   - Tolerance: +10px xung quanh sprite

3. [ ] **Grab mechanic:**
   - `mousedown` trên pet → state = GRABBED
   - Pet animation chuyển sang `grabbed` (chân đạp đạp)
   - Pet position theo mouse offset (drag)
   - Pet speech bubble: random "Aaaa đặt em xuống!" / "Wheee~"

4. [ ] **Drop mechanic (gravity fall):**
   - `mouseup` → state = FALLING
   - Physics: `velocityY += gravity * dt` (gravity = 800px/s²)
   - Khi chạm đáy terminal → bounce effect
   - Bounce: 2 lần (60% → 30% height), rồi dừng
   - Animation: `fall` → `dizzy` (lắc đầu choáng 1.5s) → `idle`

5. [ ] **Click (không kéo) = vuốt ve:**
   - Detect: `mousedown` → `mouseup` trong < 200ms, di chuyển < 5px
   - Animation: `pet` (hearts float up ❤️)
   - Mood += happiness boost
   - Pet speech: "Hehe cưng quá~" / "Em thích lắm!"

6. [ ] **Hearts particle effect:**
   - Khi vuốt ve: 3-5 trái tim ❤️ float lên từ pet
   - Simple CSS animation hoặc canvas particles
   - Fade out sau 1.5s

7. [ ] **Prevent terminal interaction khi grabbing:**
   - `pointer-events: none` trên terminal khi đang drag pet
   - Restore `pointer-events` sau khi drop

## Test Criteria

- [ ] Cursor thay đổi khi hover pet
- [ ] Grab + drag mượt mà
- [ ] Drop có gravity + bounce
- [ ] Pet có animation choáng sau drop
- [ ] Click vuốt ve có hearts effect
- [ ] Terminal vẫn hoạt động bình thường

---

Next Phase: → Phase 06 (Dialogue System)
