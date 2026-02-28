# Phase 10: Integration & Testing

Status: ⬜ Pending
Dependencies: ALL previous phases

## Objective

Kết nối tất cả hệ thống lại, end-to-end testing, performance tuning, và sẵn sàng release.

## Implementation Steps

1. [ ] **End-to-End flow test:**
   - Mở SLTerm → Pet spawn → HUD hiện → Discord update
   - Code 5 phút → XP tăng → Pet nói chuyện
   - Idle 5 phút → Pet ngủ → Discord "AFK"
   - Quay lại → Pet thức → Discord "Coding"

2. [ ] **Performance profiling:**
   - Canvas render: target < 3% CPU
   - Memory: pet system < 50MB RAM
   - Discord RPC: < 1 update/15s
   - No typing lag (< 16ms response)

3. [ ] **Edge cases:**
   - Discord không mở → fail silently
   - Pet data corrupted → reset to default
   - Window resize → pet reposition
   - Multiple tabs → pet chỉ hiện 1 tab active
   - App crash → pet data saved (auto-save)

4. [ ] **Cross-platform check:**
   - Windows: Discord IPC named pipe
   - macOS: Discord IPC unix socket (nếu cần)
   - Linux: Discord IPC unix socket (nếu cần)

5. [ ] **Settings validation:**
   - Tất cả pet settings có default values
   - Toggle on/off không crash
   - Custom dialogues validate input

6. [ ] **i18n completeness:**
   - Tất cả strings có bản VI + EN
   - Pet dialogues test cả 2 ngôn ngữ
   - Settings labels đều có translation

7. [ ] **Build & Package test:**
   - `task build:backend` pass
   - `task package` pass
   - Packaged app chạy pet system đúng

8. [ ] **User documentation:**
   - Cập nhật README với pet feature
   - Thêm screenshots/GIF demo
   - Changelog entry

## Test Criteria

- [ ] Full flow hoạt động mượt mà
- [ ] No memory leaks sau 2 giờ sử dụng
- [ ] No console errors
- [ ] App khởi động < 3 giây (không chậm hơn trước)
- [ ] `task package` thành công

---

🎉 DONE — SLTerm Vibe System Ready!
