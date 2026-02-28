# Phase 07: HUD & Pet Selection UI

Status: ⬜ Pending
Dependencies: Phase 03

## Objective

Hiển thị HUD (Level, XP bar, streak) trên terminal và UI chọn/đổi pet.

## Implementation Steps

1. [ ] **Pet HUD overlay** (`pet-hud.tsx`)
   - Góc trên phải terminal block
   - Compact: `LV.7 ████░░ 78% 🔥3`
   - Semi-transparent background
   - Hover để expand xem chi tiết

2. [ ] **XP Bar animation:**
   - Smooth fill animation khi XP tăng
   - Flash/glow khi gần level up
   - Celebrate animation khi level up

3. [ ] **Streak counter:**
   - 🔥 icon + số ngày streak
   - Glow effect khi streak > 7

4. [ ] **Pet Selection UI** (`pet-selector.tsx`)
   - Grid hiển thị tất cả Pokémon available
   - Pokesprite CSS class → thumbnail
   - Click chọn → confirm dialog → đổi pet
   - Show pet đã hoàn thành (completed) với badge ✅

5. [ ] **Pet info panel (expand HUD):**
   - Tên pet, level, XP detail
   - Mood indicator (emoji)
   - Total playtime
   - Achievements unlocked

6. [ ] **Settings panel cho Pet:**
   - `pet:enabled` toggle
   - `pet:size` slider (small/medium/large)
   - `pet:speed` slider
   - `pet:dialogueFrequency` slider
   - `pet:healthReminders` toggle

7. [ ] **Thêm vào Settings Visual** (`settings-visual.tsx`)
   - Thêm SettingsCategory "Pet" với icon "paw"
   - Đặt dưới mục "Tab Background"

8. [ ] **Mini pet preview trong Settings:**
   - Hiện sprite nhỏ của pet hiện tại
   - Button "Change Pet" → mở Pet Selector

## Test Criteria

- [ ] HUD hiển thị đẹp, không che terminal
- [ ] XP bar animation mượt
- [ ] Pet selector load tất cả sprites
- [ ] Đổi pet hoạt động
- [ ] Settings toggle pet on/off

---

Next Phase: → Phase 08 (Discord RPC)
