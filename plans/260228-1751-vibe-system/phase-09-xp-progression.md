# Phase 09: XP & Progression System

Status: ⬜ Pending
Dependencies: Phase 02, Phase 07

## Objective

Hoàn thiện hệ thống XP, leveling, streaks, achievements — biến coding thành game RPG.

## Implementation Steps

1. [ ] **XP Sources integration:**
       | Source | XP | Cap | Trigger |
       |--------|----|-----|---------|
       | Active coding (per min) | +2 | 120/hr | Session ticker |
       | Command executed | +5 | 250/hr | Shell hook |
       | Focus session (30min+) | +50 | 3x/day | Timer |
       | Daily login streak | +25×streak | - | First open |

2. [ ] **Level formula đầy đủ:**

   ```
   Level 1→2:   150 XP
   Level 2→3:   300 XP
   Level 3→4:   450 XP
   ...
   Level N→N+1: 100 × N × 1.5 XP
   Max level:   10 (evolution)
   ```

3. [ ] **Daily streak system:**
   - Lưu `lastActiveDate` trong profile
   - Mỗi ngày mở SLTerm = +1 streak
   - Bỏ 1 ngày = reset streak về 0
   - Streak bonus XP khi mở app đầu ngày

4. [ ] **Level-up celebration:**
   - Pet CELEBRATE animation 5 giây
   - Speech bubble: "LEVEL UP! 🎉"
   - HUD flash + confetti particles
   - Discord presence tạm thời: "🎉 Pet leveled up!"
   - Sound effect (optional, tùy setting)

5. [ ] **Evolution (Level 10):**
   - Full-screen overlay animation
   - "PetName đã tiến hoá!" text
   - Choose next pet dialog
   - Previous pet → completed list

6. [ ] **Achievement system:**

   ```
   first_pet:     "Người bạn đầu tiên" — chọn pet đầu tiên
   streak_3:      "3 ngày liên tiếp" — streak 3 days
   streak_7:      "Tuần cháy bỏng" — streak 7 days
   streak_30:     "Huyền thoại" — streak 30 days
   commands_100:  "Terminal Master" — 100 commands
   commands_1000: "Command King" — 1000 commands
   first_evolve:  "Tiến hoá!" — complete first pet
   night_owl:     "Cú đêm" — code sau 2h sáng
   early_bird:    "Chim sớm" — code trước 6h sáng
   ```

7. [ ] **Achievement toast notifications:**
   - Slide-in từ góc phải
   - Icon + title + description
   - Auto-hide sau 5 giây
   - Queue system nếu nhiều achievement unlock cùng lúc

## Test Criteria

- [ ] XP tăng đúng rate từ mỗi source
- [ ] Level up trigger đúng
- [ ] Streak count chính xác
- [ ] Evolution flow hoạt động
- [ ] Achievements unlock đúng điều kiện

---

Next Phase: → Phase 10 (Integration & Testing)
