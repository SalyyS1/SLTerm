# Phase 01: Setup & Dependencies

Status: ⬜ Pending
Dependencies: None

## Objective

Cài đặt dependencies cần thiết và tạo folder structure cho Pet System + Discord RPC.

## Implementation Steps

1. [ ] **Install pokesprite-spritesheet**
   - `npm install pokesprite-spritesheet` (hoặc copy CSS/sprites vào `public/`)
   - Import CSS spritesheet vào frontend build

2. [ ] **Install discord-rpc** cho Go backend
   - `go get github.com/hugolgst/rich-go` (Discord RPC library cho Go)
   - Hoặc custom IPC client nếu cần lightweight hơn

3. [ ] **Tạo frontend folder structure:**

   ```
   frontend/app/view/pet/
   ├── pet-overlay.tsx          # Canvas renderer chính
   ├── pet-overlay.scss         # Styles cho overlay + speech bubbles
   ├── pet-hud.tsx              # HUD (level, XP bar, streak)
   ├── pet-selector.tsx         # UI chọn pet
   ├── pet-model.ts             # Jotai atoms + state management
   ├── pet-behaviors.ts         # AI behaviors (walk, run, jump, idle...)
   ├── pet-dialogue.ts          # Dialogue system + health reminders
   ├── pet-sprites.ts           # Sprite loader + animation engine
   ├── pet-grab.ts              # Grab & drop interaction
   └── pet-types.ts             # TypeScript type definitions
   ```

4. [ ] **Tạo Go backend package:**

   ```
   pkg/petengine/
   ├── petengine.go             # XP calculation, level up logic
   ├── petstore.go              # Pet data persistence (JSON)
   ├── session.go               # Session tracking (active time, commands)
   └── types.go                 # Go struct definitions

   pkg/discordrpc/
   ├── discordrpc.go            # Discord IPC connection + presence
   └── presence.go              # Presence state builder
   ```

5. [ ] **Tạo i18n keys cho pet dialogues:**
   - `frontend/i18n/locales/en/pet.json`
   - `frontend/i18n/locales/vi/pet.json`

6. [ ] **Tạo config files:**
   - Schema cho pet settings trong `schema/settings.json`
   - Default pet presets

## Files to Create

| Path                               | Purpose                         |
| ---------------------------------- | ------------------------------- |
| `frontend/app/view/pet/`           | Toàn bộ frontend pet components |
| `pkg/petengine/`                   | Go backend pet logic            |
| `pkg/discordrpc/`                  | Go backend Discord RPC          |
| `frontend/i18n/locales/*/pet.json` | Pet dialogue translations       |

## Test Criteria

- [ ] Dev server chạy không lỗi sau khi thêm dependencies
- [ ] Folder structure đầy đủ
- [ ] pokesprite CSS load được trong browser

---

Next Phase: → Phase 02 (Pet Data Layer)
