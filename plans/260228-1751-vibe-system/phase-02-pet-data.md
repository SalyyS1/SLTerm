# Phase 02: Pet Data Layer (Go Backend)

Status: ⬜ Pending
Dependencies: Phase 01

## Objective

Xây dựng backend engine cho pet: lưu trữ, XP, state transitions, và WebSocket API để frontend giao tiếp.

## Implementation Steps

1. [ ] **Định nghĩa Go structs** (`pkg/petengine/types.go`)

   ```go
   type PetInstance struct {
       ID          string    `json:"id"`
       PetID       string    `json:"petId"`       // "pikachu", "bulbasaur"...
       Name        string    `json:"name"`
       Level       int       `json:"level"`
       XP          int       `json:"xp"`
       XPToNext    int       `json:"xpToNext"`
       Progress    float64   `json:"progress"`    // 0-100
       Mood        string    `json:"mood"`         // happy, neutral, sad, hungry, sleepy
       State       string    `json:"state"`        // ACTIVE, IDLE, SLEEPING, CELEBRATING
       SpawnedAt   time.Time `json:"spawnedAt"`
       TotalPlaytime int64   `json:"totalPlaytime"`
   }

   type PlayerProfile struct {
       ActivePetID   string   `json:"activePetId"`
       CompletedPets []string `json:"completedPets"`
       StreakDays    int       `json:"streakDays"`
       TotalFocusTime int64   `json:"totalFocusTime"`
       TotalCommands  int     `json:"totalCommands"`
       Achievements  []string `json:"achievements"`
       LastActiveDate string  `json:"lastActiveDate"`
   }
   ```

2. [ ] **Implement PetStore** (`pkg/petengine/petstore.go`)
   - Load/Save pet.json từ config dir
   - Load/Save profile.json
   - Thread-safe read/write với mutex

3. [ ] **Implement PetEngine** (`pkg/petengine/petengine.go`)
   - `AddXP(amount int)` → tính level up
   - `UpdateMood()` → dựa trên thời gian, activity
   - `UpdateState(newState string)` → state transitions
   - `CheckEvolution()` → pet đạt max level?
   - Level formula: `xpToNext = 100 × level × 1.5`

4. [ ] **Implement SessionTracker** (`pkg/petengine/session.go`)
   - Track active time kể từ khi terminal mở
   - Count commands executed
   - Detect idle (no activity > 5 min)
   - Periodic XP tick (mỗi phút +2 XP khi active)

5. [ ] **Register WebSocket RPC commands:**
   - `pet:getState` → trả về PetInstance hiện tại
   - `pet:getProfile` → trả về PlayerProfile
   - `pet:selectPet` → chọn pet mới
   - `pet:interact` → vuốt ve / feed (tăng mood)
   - `pet:addXP` → manual XP (cho testing)
   - `pet:getDialogue` → lấy câu thoại ngẫu nhiên

6. [ ] **Hook vào command execution flow:**
   - Khi user chạy lệnh trong terminal → gọi `pet:addXP(5)`
   - Khi terminal idle 5 phút → gọi `pet:updateState("IDLE")`

7. [ ] **Auto-save:**
   - Save pet state mỗi 30 giây
   - Save khi app close (graceful shutdown)

8. [ ] **Init pet engine khi wavesrv start:**
   - Load saved state
   - Start session tracker goroutine
   - Start XP ticker goroutine

## Files to Create/Modify

| Path                         | Action | Purpose                    |
| ---------------------------- | ------ | -------------------------- |
| `pkg/petengine/types.go`     | NEW    | Go struct definitions      |
| `pkg/petengine/petstore.go`  | NEW    | JSON persistence           |
| `pkg/petengine/petengine.go` | NEW    | XP + level + mood logic    |
| `pkg/petengine/session.go`   | NEW    | Session tracking           |
| `pkg/wshrpc/`                | MODIFY | Register pet RPC commands  |
| `cmd/server/main-server.go`  | MODIFY | Init pet engine on startup |

## Test Criteria

- [ ] Pet state persists across app restart
- [ ] XP tăng khi chạy commands
- [ ] Level up hoạt động đúng formula
- [ ] Mood thay đổi theo thời gian
- [ ] WebSocket commands trả về data đúng

---

Next Phase: → Phase 03 (Pet Renderer)
