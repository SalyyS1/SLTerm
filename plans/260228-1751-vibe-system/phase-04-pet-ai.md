# Phase 04: Pet AI & Free-Roaming

Status: ⬜ Pending
Dependencies: Phase 03

## Objective

Pet tự di chuyển trên terminal: đi lại ngẫu nhiên, ngồi nghỉ, nhảy, ngủ khi idle. Sử dụng behavior tree đơn giản.

## Implementation Steps

1. [ ] **Behavior AI engine** (`pet-behaviors.ts`)
   - Decision loop chạy mỗi 2-5 giây
   - Random chọn hành vi tiếp theo dựa trên mood + state

2. [ ] **Movement system:**
   - Pet đi bộ từ trái → phải (hoặc ngược lại) trên đáy terminal
   - Tốc độ: walk = 30px/s, run = 80px/s
   - Boundary: pet không đi ra ngoài terminal block
   - Pet tự đổi hướng khi chạm biên

3. [ ] **Behavior weights (tỷ lệ xác suất):**

   ```
   IDLE:      30% — đứng yên, nhìn quanh
   WALK:      25% — đi bộ random direction
   SIT:       15% — ngồi xuống nghỉ
   JUMP:      10% — nhảy tại chỗ
   RUN:        5% — chạy nhanh qua terminal
   SLEEP:     10% — nằm ngủ (khi mood = sleepy)
   CELEBRATE:  5% — nhảy mừng (khi vừa lên level)
   ```

4. [ ] **State transitions:**

   ```
   User typing → Pet IDLE (ngồi xem user code)
   User idle 5min → Pet SLEEP (z z z)
   Level up → Pet CELEBRATE (3 giây) → IDLE
   Late night → Pet yawn → SLEEP
   ```

5. [ ] **Mood affects behavior:**
   - `happy` → nhiều JUMP, CELEBRATE hơn
   - `neutral` → balanced
   - `sad` → nhiều SIT, IDLE
   - `sleepy` → nhiều SLEEP
   - `hungry` → di chuyển chậm, nhiều SIT

6. [ ] **Gravity system:**
   - Pet luôn đứng trên "mặt đất" (đáy terminal hoặc bottom edge)
   - Khi jump: tween Y lên → rơi xuống
   - Easing function cho chuyển động tự nhiên

7. [ ] **Idle detection hook:**
   - Kết nối với Go backend session tracker
   - `onIdle()` → pet chuyển sang SLEEP
   - `onActive()` → pet thức dậy, CELEBRATE nhẹ

8. [ ] **Random timing variation:**
   - Mỗi behavior kéo dài random 2-8 giây
   - Tránh lặp lại pattern → cảm giác "sống"

## Test Criteria

- [ ] Pet di chuyển tự nhiên, không giật lag
- [ ] Pet không đi ra ngoài terminal
- [ ] Pet ngủ khi user idle
- [ ] Pet thức dậy khi user quay lại
- [ ] Mood ảnh hưởng hành vi đúng

---

Next Phase: → Phase 05 (Grab & Drop)
