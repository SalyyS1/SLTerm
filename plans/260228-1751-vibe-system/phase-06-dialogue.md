# Phase 06: Dialogue System & Health Reminders

Status: ⬜ Pending
Dependencies: Phase 04

## Objective

Pet nói chuyện qua speech bubbles đáng yêu, nhắc nhở sức khoẻ theo giờ thực, hỗ trợ Tiếng Việt + Tiếng Anh, và user customize được messages.

## Implementation Steps

1. [ ] **Speech Bubble UI** (`pet-dialogue.ts` + `pet-overlay.scss`)
   - Bong bóng chat nhỏ xinh phía trên đầu pet
   - Style: rounded corners, tail pointer xuống pet
   - Auto-hide sau 4-6 giây
   - Fade-in / fade-out animation
   - Max width: 200px, text wraps

2. [ ] **Z Z Z Sleep Animation:**
   - Khi pet state = SLEEP → hiện chữ "Z" bay lên
   - 3 chữ Z kích thước khác nhau, float lên xéo
   - CSS keyframe animation, loop liên tục
   - Disappear khi pet thức dậy

3. [ ] **Random Cute Dialogues (mood-based):**

   ```
   HAPPY:
   - "Code xịn quá đại ca!" / "Your code looks great!"
   - "Hôm nay vui ghê!" / "What a great day!"
   - "Em cổ vũ đại ca! 💪" / "You got this! 💪"

   NEUTRAL:
   - "..." / "..."
   - "Hmm..." / "Hmm..."
   - "Code gì vậy ta?" / "What are we building?"

   SAD:
   - "Đại ca ơi, vuốt ve em đi..." / "Pat me please..."
   - "Em buồn quá..." / "I'm feeling down..."

   HUNGRY:
   - "Em đói rồi, nghỉ ăn đi mà!" / "I'm hungry, take a break!"
   - "Bụng em kêu rồi nè 🍕" / "My tummy is growling 🍕"

   SLEEPY:
   - "Mắt em díp lại rồi..." / "My eyes are closing..."
   - "Zzzz..." / "Zzzz..."
   ```

4. [ ] **Health Reminders (time-based UTC):**

   ```ts
   const HEALTH_REMINDERS = [
     {
       id: "sleep",
       condition: (hour) => hour >= 23 || hour < 5,
       interval: 30 * 60 * 1000, // 30 phút
       vi: ["3h sáng rồi đại ca ơi, ngủ đi mà...", "Khuya rồi, mai code tiếp nha~"],
       en: ["It's late, go to bed!", "You need sleep to code well tomorrow~"],
     },
     {
       id: "lunch",
       condition: (hour) => hour >= 12 && hour < 13,
       interval: 20 * 60 * 1000,
       vi: ["Giờ ăn trưa rồi, nghỉ tay ăn cơm đi nào!", "Ăn gì chưa đại ca?"],
       en: ["Lunch time! Take a break!", "Have you eaten yet?"],
     },
     {
       id: "water",
       condition: () => true, // Luôn nhắc
       interval: 90 * 60 * 1000, // 1.5h
       vi: ["Uống nước đi đại ca, đừng khô héo!", "💧 Hydrate time!"],
       en: ["Drink some water!", "💧 Stay hydrated!"],
     },
     {
       id: "eyes",
       condition: () => true,
       interval: 45 * 60 * 1000,
       vi: ["Nhìn xa 20 giây cho mắt nghỉ ngơi nha~", "👀 20-20-20 rule!"],
       en: ["Look away for 20 seconds!", "👀 Rest your eyes!"],
     },
   ];
   ```

5. [ ] **Dialogue scheduler:**
   - Random dialogue mỗi 30-90 giây (khi pet ACTIVE)
   - Health reminders check mỗi phút
   - Không spam: max 1 bubble mỗi 20 giây
   - Priority: Health reminder > Mood dialogue > Random

6. [ ] **i18n integration:**
   - Detect ngôn ngữ từ `i18n` setting hiện có
   - Pet dialogues trong `frontend/i18n/locales/vi/pet.json` và `en/pet.json`
   - Fallback: English nếu ngôn ngữ không support

7. [ ] **Custom Messages (Settings UI):**
   - Thêm mục "Pet Messages" trong Settings → Pet
   - User thêm/sửa/xoá câu thoại custom
   - Lưu vào `.config/slterm/pet-dialogues.json`
   - Custom messages xen lẫn với built-in messages

8. [ ] **Level-up dialogue:**
   - Khi pet lên level → special dialogue:
   - "LEVEL UP! Em lên Lv.8 rồi nè! 🎉"
   - Speech bubble lớn hơn, có sparkle effect ✨

9. [ ] **Dialogue history (optional):**
   - Log 20 câu thoại gần nhất
   - User click pet → xem lại history (tooltip popup)

## Test Criteria

- [ ] Speech bubbles hiện/ẩn đúng timing
- [ ] Z Z Z animation khi ngủ
- [ ] Health reminders đúng giờ (test bằng thay đổi system time)
- [ ] Tiếng Việt / Tiếng Anh switch đúng
- [ ] Custom messages hoạt động
- [ ] Không spam quá nhiều dialogue

---

Next Phase: → Phase 07 (HUD & Selection UI)
