# Phase 08: Discord Rich Presence

Status: ⬜ Pending
Dependencies: Phase 02

## Objective

Kết nối SLTerm với Discord để hiển thị real-time: đang code gì, pet level bao nhiêu, session timer.

## Implementation Steps

1. [ ] **Discord IPC Client** (`pkg/discordrpc/discordrpc.go`)
   - Connect to Discord IPC socket (named pipe trên Windows)
   - Handshake với Discord Application ID
   - Auto-reconnect khi Discord restart
   - Fail silently nếu Discord không mở

2. [ ] **Tạo Discord Application:**
   - Tạo app tại https://discord.com/developers/applications
   - Lấy Application ID
   - Upload assets (pet icons, theme icons)
   - Lưu Application ID vào config

3. [ ] **Presence Builder** (`pkg/discordrpc/presence.go`)

   ```go
   type PresenceData struct {
       Details     string  // "Coding: my-project"
       State       string  // "Pikachu ⚡ Lv.7 • 78%"
       LargeImage  string  // Theme icon key
       LargeText   string  // Theme name
       SmallImage  string  // Pet icon key
       SmallText   string  // Pet name
       StartTime   int64   // Session start Unix timestamp
   }
   ```

4. [ ] **Project detection:**
   - Detect tên project từ tab title hoặc CWD
   - Fallback: "Using SLTerm"
   - `Details: "Coding: {projectName}"`

5. [ ] **Pet info in presence:**
   - `State: "{petName} ⚡ Lv.{level} • {progress}%"`
   - `SmallImage: "pet_{petId}"` (pokémon icon trên Discord)

6. [ ] **Session timer:**
   - `StartTimestamp` = thời điểm mở SLTerm
   - Discord tự hiển thị "elapsed: 02:15:30"

7. [ ] **Presence states:**

   ```
   WORKING   → Details: "Coding: projectName"
   IDLE      → Details: "AFK — Pet đang ngủ 💤"
   FOCUS     → Details: "🎯 Focus Mode"
   LEVEL_UP  → State: "🎉 Pet just leveled up!"  (tạm 30s)
   ```

8. [ ] **Rate-limit safe updates:**
   - Debounce: chỉ update khi có thay đổi thực sự
   - Min interval: 15 giây giữa 2 lần update
   - Chỉ update khi: project change, pet change, level up, idle↔active

9. [ ] **Frontend settings** (`pet-model.ts` hoặc Settings)
   - `discord:enabled` toggle — bật/tắt Discord Presence
   - `discord:showProject` toggle — ẩn tên project nếu muốn
   - `discord:showPet` toggle — ẩn pet info

10. [ ] **Go daemon integration:**
    - Start Discord RPC goroutine khi wavesrv start (nếu enabled)
    - Subscribe to pet state changes → update presence
    - Subscribe to tab/project changes → update presence
    - Graceful disconnect khi app close

## Files to Create/Modify

| Path                                               | Action                        |
| -------------------------------------------------- | ----------------------------- |
| `pkg/discordrpc/discordrpc.go`                     | NEW                           |
| `pkg/discordrpc/presence.go`                       | NEW                           |
| `cmd/server/main-server.go`                        | MODIFY — init Discord RPC     |
| `frontend/app/view/waveconfig/settings-visual.tsx` | MODIFY — add Discord settings |

## Test Criteria

- [ ] Discord hiện "Playing SLTerm" khi app mở
- [ ] Project name hiển thị đúng
- [ ] Pet info + level hiển thị đúng
- [ ] Timer chạy đúng
- [ ] Auto-reconnect khi Discord restart
- [ ] Không crash khi Discord đóng

---

Next Phase: → Phase 09 (XP & Progression)
