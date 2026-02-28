# 💡 BRIEF: SLTerm Vibe System — Pet + Discord Rich Presence

**Ngày tạo:** 2026-02-28
**Brainstorm cùng:** Salyvn

---

## 1. VẤN ĐỀ CẦN GIẢI QUYẾT

Terminal hiện tại chỉ là công cụ — mở lên, gõ lệnh, tắt đi. Không có cảm xúc, không có lý do để user "muốn" mở terminal lên mỗi ngày. Trong khi đó, các ứng dụng gaming và social media đều sử dụng **progression systems** để giữ chân người dùng.

**Pain points:**

- Terminal buồn chán, không có personality
- Không ai biết bạn đang code gì (Discord trống trơn)
- Không có phần thưởng cho việc code chăm chỉ
- Không có lý do để quay lại terminal mỗi ngày

---

## 2. GIẢI PHÁP ĐỀ XUẤT

Biến SLTerm thành **"Vibecoding Terminal"** — terminal đầu tiên có hệ thống pet progression + Discord Rich Presence:

- **Pet system:** Con pet Pokémon/Shimeji sống trên terminal, **chạy nhảy tự do**, vuốt ve được, ngủ khi idle, nhảy mừng khi user code xong task — tăng XP và evolve khi đạt 100%
- **Discord Presence:** Hiển thị real-time đang code project gì, pet level bao nhiêu, theme đang dùng
- **Anime UI:** HUD hiển thị level, XP bar, streak — biến terminal thành game RPG

---

## 3. ĐỐI TƯỢNG SỬ DỤNG

- **Primary:** Developers trẻ (16-30 tuổi), yêu anime/game, thích customize workspace
- **Secondary:** Streamers code live, muốn terminal nhìn xịn xò trên stream

---

## 4. NGUỒN TÀI NGUYÊN

### Pet Assets:

| Nguồn                                                                      | Loại                   | Ghi chú                                                      |
| -------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------ |
| [pokesprite-spritesheet](https://github.com/msikma/pokesprite-spritesheet) | Pokémon box sprites    | CSS class-based, MIT license (code only), sprites © Nintendo |
| Shimeji packs                                                              | Desktop mascot sprites | Import XML → compile thành action set                        |

### Điểm khác biệt so với các terminal khác:

- **Warp / Hyper / iTerm2** — Không có pet, không có progression
- **Tabby** — Có theme nhưng không có gamification
- **SLTerm** — Terminal DUY NHẤT có pet system + Discord integration

---

## 5. TÍNH NĂNG

### 🚀 Phase 1 — Pet System Core (MVP)

- [ ] Pet renderer (Canvas overlay trên terminal, z-index trên content)
- [ ] **Free-roaming AI** — Pet tự chạy nhảy, đi lại, ngồi nghỉ trên terminal
- [ ] **Pet behaviors:** WALK, RUN, JUMP, IDLE, SLEEP, CELEBRATE, SIT
- [ ] **User interaction:**
  - Hover pet → cursor thành `🤚 grab` (bàn tay mở)
  - Mousedown → cursor thành `✊ grabbing` (bàn tay nắm), pet bị nhấc lên, chân đạp đạp
  - Kéo di chuyển → pet lơ lửng theo chuột, mắt xoay xoay
  - Mouseup → thả pet rơi bụp xuống (gravity + bounce animation), pet lắc đầu choáng
  - Click nhẹ (không kéo) → vuốt ve, pet vui mừng nhảy nhót ❤️
- [ ] Pet state machine (ACTIVE → IDLE → SLEEPING → CELEBRATING)
- [ ] Sprite animation engine (frame-by-frame từ spritesheet)
- [ ] **💬 Pet Dialogue System (Speech Bubbles):**
  - [ ] Speech bubble UI (bong bóng chat nhỏ xinh phía trên pet)
  - [ ] **Z Z Z animation** khi pet ngủ
  - [ ] Random cute dialogues (ngẫu nhiên phát thoại đáng yêu)
  - [ ] **Health reminders theo giờ thực (UTC):**
    - 🌙 Sau 23h → _"3h sáng rồi đại ca ơi, ngủ đi mà..."_
    - 🍚 12h-13h → _"Giờ ăn trưa rồi, nghỉ tay ăn cơm đi nào!"_
    - 💧 Mỗi 1.5h → _"Uống nước đi đại ca, đừng khô héo!"_
    - 👀 Mỗi 45min → _"Nhìn xa 20 giây cho mắt nghỉ ngơi nha~"_
  - [ ] **Bilingual support (VI 🇻🇳 / EN 🇬🇧)** — tự detect theo `i18n` setting
  - [ ] **Custom messages** — user tự thêm/sửa câu thoại trong Settings
  - [ ] Mood-based dialogues (vui → nói nhiều, buồn → im lặng, đói → than thở)
- [ ] XP engine (passive: thời gian code, active: lệnh chạy)
- [ ] Pet data persistence (`.config/slterm/pet.json`)
- [ ] HUD overlay (Level, XP bar, streak counter)
- [ ] Pet sprite loader (pokesprite + Shimeji sprites)
- [ ] Pet selection UI (chọn pet từ danh sách có sẵn)

### 🎮 Phase 2 — Discord Rich Presence

- [ ] Discord RPC connection (discord-rpc hoặc custom IPC)
- [ ] Session timer (thời gian đã code)
- [ ] Project detection (tên folder / git repo)
- [ ] Pet info in presence (tên pet, level, %)
- [ ] Theme/mode mapping → Discord large image
- [ ] Rate-limit safe updates (debounce 15-30s)
- [ ] Auto reconnect khi Discord restart

### 🎁 Phase 3 — Evolution & Gamification

- [ ] Evolution flow (100% → animation → choose next pet)
- [ ] Achievement system (milestones, badges)
- [ ] Daily streak tracking
- [ ] Achievement toasts / notifications

### 💭 Phase 4 — Marketplace & Extensibility (Backlog)

- [ ] Pet pack marketplace (community-made packs)
- [ ] Shimeji XML import tool
- [ ] Custom pet sprite upload
- [ ] Leaderboard (opt-in)

---

## 6. KIẾN TRÚC KỸ THUẬT

### Quyết định: Tích hợp vào Go daemon hiện tại (`wavesrv`)

**Lý do:**

- Không cần spawn thêm process → tiết kiệm RAM
- Đã có WebSocket API sẵn → UI giao tiếp dễ dàng
- Đã có file persistence layer → lưu pet state nhanh
- Session tracking có thể hook vào command execution flow hiện có

### Architecture Overview:

```
┌─────────────────────────────────────────────┐
│                ELECTRON (UI)                │
│  ┌──────────┐ ┌──────────┐ ┌─────────────┐ │
│  │ Terminal  │ │ Pet      │ │ HUD Overlay │ │
│  │ (xterm)  │ │ Renderer │ │ (React)     │ │
│  └──────────┘ └──────────┘ └─────────────┘ │
│       ↕ WebSocket                           │
├─────────────────────────────────────────────┤
│             GO DAEMON (wavesrv)             │
│  ┌──────────┐ ┌──────────┐ ┌─────────────┐ │
│  │ Pet      │ │ Session  │ │ Discord     │ │
│  │ Engine   │ │ Tracker  │ │ RPC Client  │ │
│  └──────────┘ └──────────┘ └─────────────┘ │
│       ↕ File I/O                            │
│  ┌──────────────────────────────────────┐   │
│  │ .config/slterm-dev/pet.json         │   │
│  │ .config/slterm-dev/session.json     │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

### Frontend Components:

- `PetOverlay` — Canvas/CSS component renders pet sprite on terminal
- `PetHUD` — React component shows Level, XP bar, streak
- `PetSelector` — UI to choose/switch pet
- `DiscordStatus` — Settings panel to configure presence

### Backend Services (Go):

- `PetEngine` — XP calculation, level up, state transitions
- `SessionTracker` — Track active time, commands, idle detection
- `DiscordRPC` — Connect to Discord IPC, send presence updates
- `PetStore` — Persist pet data to JSON files

---

## 7. DATA MODELS

### PetInstance (pet.json)

```json
{
  "id": "uuid",
  "petId": "pikachu",
  "name": "Pikachu",
  "level": 7,
  "xp": 780,
  "xpToNext": 1000,
  "progress": 78,
  "mood": "happy",
  "state": "ACTIVE",
  "spawnedAt": "2026-02-28T10:00:00Z",
  "totalPlaytime": 3600
}
```

### PlayerProfile (profile.json)

```json
{
  "activePetId": "uuid",
  "completedPets": ["bulbasaur", "charmander"],
  "streakDays": 3,
  "totalFocusTime": 86400,
  "totalCommands": 1523,
  "achievements": ["first_pet", "streak_3"]
}
```

### Discord Presence Layout

```
┌────────────────────────────────┐
│ 🎮 SLTerm                     │
│ Coding: my-awesome-project     │
│ Pikachu ⚡ Lv.7 • 78%          │
│ ⏱️ 02:15:30 elapsed            │
│ [theme_icon]    [pet_icon]     │
└────────────────────────────────┘
```

---

## 8. XP SYSTEM

| Source                  | XP/unit      | Cap        |
| ----------------------- | ------------ | ---------- |
| Active coding (per min) | +2 XP        | 120/hr     |
| Command executed        | +5 XP        | 50 cmds/hr |
| Focus session (30min+)  | +50 XP       | 3x/day     |
| Daily login streak      | +25 × streak | -          |

**Level formula:** `xpToNext = 100 × level × 1.5`
**Evolution:** Pet reaches Level 10 → 100% → Evolution screen

---

## 9. ƯỚC TÍNH SƠ BỘ

| Phase                 | Thời gian | Độ phức tạp   |
| --------------------- | --------- | ------------- |
| Phase 1 — Pet System  | 1-2 tuần  | 🟡 Trung bình |
| Phase 2 — Discord RPC | 3-5 ngày  | 🟢 Dễ         |
| Phase 3 — Evolution   | 1 tuần    | 🟡 Trung bình |
| Phase 4 — Marketplace | 2-4 tuần  | 🔴 Phức tạp   |

### Rủi ro:

- **Discord RPC rate limit** — Cần debounce cẩn thận, max 1 update/15s
- **Project là open-source public** — Sprites dùng tự do, không lo bản quyền
- **Performance** — Canvas overlay trên terminal cần lightweight, không được lag typing

---

## 10. BƯỚC TIẾP THEO

→ Chạy `/plan` để tạo thiết kế chi tiết Phase 1 (Pet System) + Phase 2 (Discord RPC)
