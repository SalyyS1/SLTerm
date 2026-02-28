# SLTerm Codebase Scout Report
**Date:** 2026-02-27  
**Work Context:** `/mnt/d/Project/.15_PROJECT_WAVETERM`

---

## 1. BUILD OUTPUT VERIFICATION

### Timestamps
- **Source file (term-model.ts):** 2026-02-27 17:38:49
- **Dist files (index.html):** 2026-02-27 17:50:50
- **Dist directory:** 2026-02-27 17:50:49
- **Release/win-unpacked (app.asar):** 2026-02-27 17:53:00
- **Release executable:** 2026-02-27 17:55:00

### Status: **CURRENT AND UP-TO-DATE**
✅ Dist files are fresh (built ~12 minutes after source modification)
✅ Release artifacts are current (built after dist)
✅ win-unpacked contains current code packaged in app.asar

### Build Chain
```
Source files modified 17:38:49
  ↓ (12 min)
Dist built 17:50:49-50:50
  ↓ (3 min)
Release packaged 17:53:00
  ↓ (2 min)
Installer created 17:55:00
```

---

## 2. INPUT BATCHING WIRING

### References Found
1. **`InputBatcher` class definition** (`/mnt/d/Project/.15_PROJECT_WAVETERM/frontend/app/view/term/term-model.ts:47-80`)
   - Line 47-80: Complete InputBatcher implementation
   - Lines 44-45: `INPUT_BATCH_DELAY_MS = 5` constant
   - Batches input with 5ms delay, flushes on control chars

2. **InputBatcher instantiation** (`term-model.ts:127-130`)
   ```typescript
   this.inputBatcher = new InputBatcher((data) => {
       const b64data = stringToBase64(data);
       RpcApi.ControllerInputCommand(TabRpcClient, { blockid: this.blockId, inputdata64: b64data });
   });
   ```
   - Callback flushes to `RpcApi.ControllerInputCommand`
   - Uses base64 encoding for binary safety

3. **`sendDataToController` wrapper** (`term-model.ts:490-492`)
   ```typescript
   sendDataToController(data: string) {
       this.inputBatcher.write(data);
   }
   ```
   - Delegates directly to InputBatcher.write()

4. **Multi-input handler** (`term-model.ts:481-488`)
   ```typescript
   multiInputHandler(data: string) {
       const tvms = getAllBasicTermModels();
       for (const tvm of tvms) {
           if (tvm != this) {
               tvm.sendDataToController(data);
           }
       }
   }
   ```
   - Broadcasts to all terminal models

### Usage Points
- `sendDataToController` is invoked in:
  - `handleTerminalKeydown` (lines 684, 690, 700, 718, 711)
  - Context menu handlers (implied from structure)
  - Terminal input events

### Status: **PROPERLY WIRED**
✅ InputBatcher instantiated correctly with callback
✅ `sendDataToController` calls batcher.write()
✅ Batching callback sends to ControllerInputCommand RPC
✅ 5ms batch delay configured

---

## 3. ACTION QUEUE IN EMAIN

### References Found

**File:** `/mnt/d/Project/.15_PROJECT_WAVETERM/emain/emain-window.ts`

#### Queue Definition (Line 143)
```typescript
private actionQueue: WindowActionQueueEntry[];
```
- Type: `WindowActionQueueEntry[]` (lines 113-130)
- Supports: switchtab, createtab, closetab, switchworkspace operations

#### Queue Internal Methods

1. **`_queueActionInternal`** (lines 486-502)
   - Deduplicates at position [1] (next action slot)
   - Preserves destructive ops (closetab) in queue
   - Triggers `processActionQueue()` if queue was empty
   - Lines 487-495: Smart deduplication logic
   
2. **`processActionQueue`** (lines 514-583)
   - Serializes operations from queue[0] to completion
   - Shift-pops from front after each operation completes (line 580)
   - While loop (line 515) processes entire queue
   - Comprehensive error handling (lines 577-581)

#### Queue Entry Points

1. **Tab switching** (lines 359-369, calls at 356, 368)
   - `setActiveTab()` queues switchtab operation
   
2. **Tab creation** (lines 478-480)
   - `queueCreateTab()` queues createtab operation
   
3. **Tab closing** (lines 482-484)
   - `queueCloseTab()` queues closetab operation
   
4. **Workspace switching** (lines 336-357)
   - `switchWorkspace()` queues switchworkspace operation

#### Event Handlers

- IPC: "set-active-tab" → `setActiveTab()` (lines 694-698)
- IPC: "create-tab" → `queueCreateTab()` (lines 707-715)
- IPC: "close-tab" → `queueCloseTab()` (lines 724-733)
- IPC: "switch-workspace" → `switchWorkspace()` (lines 735-741)

### Status: **WELL-IMPLEMENTED**
✅ Queue initialized in constructor (line 190)
✅ Deduplication prevents rapid re-queueing (lines 487-495)
✅ Serial processing prevents race conditions (line 515 while loop)
✅ Proper shift-pop semantics (line 580)
✅ Error handling for each operation (try-catch at 577)

---

## 4. SHELL PROC STATUS RACE CONDITION

### References Found

**File:** `/mnt/d/Project/.15_PROJECT_WAVETERM/frontend/app/view/term/term-model.ts`

#### Field Declarations
1. **Line 109:** `shellProcFullStatus: jotai.PrimitiveAtom<BlockControllerRuntimeStatus>;`
2. **Line 110:** `shellProcStatus: jotai.Atom<string>;`
3. **Line 111:** `shellProcStatusUnsubFn: () => void;`
4. **Line 117:** `shellProcStatusReceived: boolean;` ⚠️ Track flag

#### Initial Status Fetch (Lines 364-368)
```typescript
const initialShellProcStatus = services.BlockService.GetControllerStatus(blockId);
initialShellProcStatus.then((rts) => {
    this.updateShellProcStatus(rts);
    this.shellProcStatusReceived = true;
});
```
- **ASYNC without await** - race window exists
- Event subscription added immediately after (line 369)
- Flag set only after promise resolves (async)

#### Event Subscription (Lines 369-377)
```typescript
this.shellProcStatusUnsubFn = waveEventSubscribe({
    eventType: "controllerstatus",
    scope: WOS.makeORef("block", blockId),
    handler: (event) => {
        let bcRTS: BlockControllerRuntimeStatus = event.data;
        this.updateShellProcStatus(bcRTS);
        this.shellProcStatusReceived = true;
    },
});
```
- Fires if status arrives before initial fetch completes

#### Status Atom (Lines 378-381)
```typescript
this.shellProcStatus = jotai.atom((get) => {
    const fullStatus = get(this.shellProcFullStatus);
    return fullStatus?.shellprocstatus ?? "init";
});
```
- Computed from `fullProcStatus` (can be null initially)

#### Update Method (Lines 522-530)
```typescript
updateShellProcStatus(fullStatus: BlockControllerRuntimeStatus) {
    if (fullStatus == null) return;
    const curStatus = globalStore.get(this.shellProcFullStatus);
    if (curStatus == null || curStatus.version < fullStatus.version) {
        globalStore.set(this.shellProcFullStatus, fullStatus);
    }
}
```
- Version-based conflict resolution

#### Usage of `shellProcStatusReceived` Flag
1. **Line 218:** In `viewText` atom - checks before reading status
   ```typescript
   const fullShellProcStatus = get(this.shellProcFullStatus);  // after check
   ```

2. **Lines 737-744:** In `handleTerminalKeydown`
   ```typescript
   if (this.shellProcStatusReceived && 
       (shellProcStatus == "done" || shellProcStatus == "init") && 
       keyutil.checkKeyPressed(waveEvent, "Enter")) {
       fireAndForget(() => this.forceRestartController());
   }
   ```
   - Guards against missing initial status

#### Restart Methods

1. **`forceRestartController`** (Lines 761-777)
   - Line 762: Checks `isRestarting` guard
   - Lines 766, 771: Sends `ControllerDestroyCommand` then `ControllerResyncCommand`
   - Awaits both RPC calls

2. **`restartSessionWithDurability`** (Lines 779-795)
   - Similar pattern with SetMeta first

### Status: **MITIGATED WITH FLAG, BUT RACE WINDOW EXISTS**
⚠️ **Issues:**
- Race window between constructor and initial fetch completion (lines 364-368 not awaited)
- Event subscription active during fetch (line 369)
- `shellProcStatusReceived` is false until promise resolves
- Code guards at line 218 and 737, but initial state could be stale

✅ **Mitigations:**
- Version-based conflict resolution (line 527)
- `shellProcStatusReceived` flag gates certain actions (line 737-738)
- Default to "init" status (line 380)

---

## 5. THEME/BACKGROUND SETTINGS

### References Found

**File:** `/mnt/d/Project/.15_PROJECT_WAVETERM/frontend/app/view/waveconfig/setting-controls.tsx`

#### `writeSetting` Function (Lines 17-25)
```typescript
export async function writeSetting(key: string, value: any): Promise<void> {
    console.log(`writeSetting: key="${key}" value=`, value);
    try {
        const result = await RpcApi.SetConfigCommand(TabRpcClient, { [key]: value } as any);
        console.log(`writeSetting: key="${key}" success`, result);
    } catch (e) {
        console.error(`writeSetting failed for key="${key}":`, e);
    }
}
```
- Calls `RpcApi.SetConfigCommand`
- No return value validation
- Logs success but doesn't validate config was applied

#### Setting Components Using `writeSetting`

1. **ToggleSetting** (Line 29)
   ```typescript
   onChange={(v) => writeSetting(settingKey, v)}
   ```
   - Inline arrow function (performance concern)

2. **NumberSetting** (Line 45)
   ```typescript
   onChange={(e) => writeSetting(settingKey, Number(e.target.value))}
   ```
   - Inline arrow function

3. **TextSetting** (Line 63)
   ```typescript
   onChange={(e) => writeSetting(settingKey, e.target.value || null)}
   ```
   - Inline arrow function

4. **SliderSetting** (Line 87)
   ```typescript
   onChange={(e) => writeSetting(settingKey, Number(e.target.value))}
   ```
   - Inline arrow function

5. **ColorSetting** (Line 109)
   ```typescript
   onChange={(e) => writeSetting(settingKey, e.target.value)}
   ```
   - Inline arrow function

#### Term-Model Theme References

In `/mnt/d/Project/.15_PROJECT_WAVETERM/frontend/app/view/term/term-model.ts`:

- **Line 278:** `termThemeNameAtom` computed from settings
- **Line 278-282:** Gets override or defaults to `DefaultTermTheme`
- **Line 755-759:** `setTerminalTheme()` method
  ```typescript
  setTerminalTheme(themeName: string) {
      RpcApi.SetMetaCommand(TabRpcClient, {
          oref: WOS.makeORef("block", this.blockId),
          meta: { "term:theme": themeName },
      });
  }
  ```
  - Uses `SetMetaCommand` not `SetConfigCommand`
  - Sets block-level meta, not global setting

#### Background Picker References

**File:** `/mnt/d/Project/.15_PROJECT_WAVETERM/frontend/app/view/waveconfig/background-picker.tsx`

- Line 262: `writeSetting("tab:preset", key)`
- Line 269: `writeSetting("tab:preset", null)`
- Line 321: `writeSetting("tab:preset", key)`

#### Font Picker References

**File:** `/mnt/d/Project/.15_PROJECT_WAVETERM/frontend/app/view/waveconfig/font-picker.tsx`

- Line 206: `writeSetting("term:fontfamily", font)`
- Line 211: `writeSetting("term:fontfamily", customFont.trim())`

### Status: **FIRE-AND-FORGET WITH WEAK ERROR HANDLING**
⚠️ **Issues:**
- `writeSetting` doesn't await or validate response (line 20)
- Multiple inline arrow functions in setting components (5+ instances)
- No debouncing for rapid setting changes
- Inline arrows recreated on every render (performance regression)
- SetMeta vs SetConfig inconsistency (theme uses meta, settings use config)

✅ **Mitigations:**
- Try-catch error handling present (line 22-24)
- Console logging for debugging (lines 18, 21, 23)

---

## 6. DUPLICATE CODE PATTERNS IN TERM-MODEL.TS

### RPC Call Pattern

**File:** `/mnt/d/Project/.15_PROJECT_WAVETERM/frontend/app/view/term/term-model.ts`

#### SetMetaCommand Pattern (Used 11+ times)
```typescript
RpcApi.SetMetaCommand(TabRpcClient, {
    oref: WOS.makeORef("block", this.blockId),
    meta: { /* property */ },
});
```

**Occurrences:**
1. Line 498-501: term:mode setting
2. Line 755-759: term:theme setting
3. Line 780-783: term:durable setting (in restartSessionWithDurability)
4. Line 962-966: term:transparency = null
5. Line 973-977: term:transparency = 0.5
6. Line 984-988: term:transparency = 0
7. Line 998-1002: term:fontsize override
8. Line 1011-1015: term:fontsize = null
9. Line 1040-1044: term:allowbracketedpaste = null
10. Line 1051-1055: term:allowbracketedpaste = true
11. Line 1062-1066: term:allowbracketedpaste = false
12. Line 1083-1087: cmd:clearonstart = true
13. Line 1094-1098: cmd:clearonstart = false
14. Line 1111-1115: cmd:runonstart = true
15. Line 1122-1126: cmd:runonstart = false
16. Line 1139-1143: term:conndebug = null
17. Line 1150-1154: term:conndebug = "info"
18. Line 1161-1165: term:conndebug = "debug"

**Pattern Opportunity:** Extract to helper function
```typescript
private setBlockMeta(key: string, value: any) {
    RpcApi.SetMetaCommand(TabRpcClient, {
        oref: WOS.makeORef("block", this.blockId),
        meta: { [key]: value },
    });
}
```
Would eliminate 18 lines of repetition.

#### ControllerCommand Pattern (4 occurrences)
1. Line 129: `ControllerInputCommand` (initial)
2. Line 766: `ControllerDestroyCommand`
3. Line 771: `ControllerResyncCommand`
4. Line 784: `ControllerDestroyCommand`
5. Line 789: `ControllerResyncCommand`

#### Duplicate Event Handlers
- Lines 176-178: Click to switch to terminal mode
- Lines 189-191: Click to switch to Wave App mode
- Both use similar inline arrow closures

### Duplicate Atom Definitions
- Lines 278-282: `termThemeNameAtom` (computed from override)
- Line 290-298: `blockBg` (computed from theme)
- Both re-compute on deps change (no memoization)

### Status: **MODERATE DUPLICATION, EASY TO REFACTOR**
⚠️ **Issues:**
- 18 instances of identical SetMetaCommand pattern
- Event handler structure repeated (lines 176-191)
- No reusable helper for meta updates

✅ **Mitigations:**
- Code is functional and correct despite duplication
- Clear pattern enables easy refactoring

---

## 7. PERFORMANCE HOTSPOTS

### Inline Arrow Functions in JSX

**File:** `/mnt/d/Project/.15_PROJECT_WAVETERM/frontend/app/view/waveconfig/setting-controls.tsx`

Multiple setting components have inline onChange handlers:

1. **ToggleSetting (Line 29)**
   ```typescript
   onChange={(v) => writeSetting(settingKey, v)}
   ```
   - Recreated on every render
   - No memoization of onChange callback

2. **NumberSetting (Line 45)**
   ```typescript
   onChange={(e) => writeSetting(settingKey, Number(e.target.value))}
   ```
   - Runs on every number input change
   - No debounce

3. **TextSetting (Line 63)**
   ```typescript
   onChange={(e) => writeSetting(settingKey, e.target.value || null)}
   ```
   - Sends RPC call on every keystroke
   - No debounce

4. **SliderSetting (Line 87)**
   ```typescript
   onChange={(e) => writeSetting(settingKey, Number(e.target.value))}
   ```
   - Fires for every slider pixel movement
   - **High frequency** - needs debounce (should be 100-200ms)

5. **ColorSetting (Line 109)**
   ```typescript
   onChange={(e) => writeSetting(settingKey, e.target.value)}
   ```
   - Fires on every color picker change
   - No debounce

6. **RestartRequiredSetting (Line 150)**
   ```typescript
   onChange={(v) => writeSetting(settingKey, v)}
   ```
   - Same as ToggleSetting

### Event Listener Performance

**File:** `/mnt/d/Project/.15_PROJECT_WAVETERM/frontend/app/view/term/termwrap.ts`

1. **Paste Handler (Line 255)**
   ```typescript
   this.connectElem.addEventListener("paste", pasteHandler, true);
   ```
   - Bound handler (line 254), properly cleaned up (lines 256-259)
   - ✅ Correct pattern

2. **IME Composition Events (Lines 318-320)**
   ```typescript
   textareaElem.addEventListener("compositionstart", this.handleCompositionStart);
   textareaElem.addEventListener("compositionupdate", this.handleCompositionUpdate);
   textareaElem.addEventListener("compositionend", this.handleCompositionEnd);
   ```
   - Bound handlers, cleanup in dispose function (lines 331-340)
   - ✅ Proper cleanup

3. **Blur Handler (Line 329)**
   ```typescript
   textareaElem.addEventListener("blur", blurHandler);
   ```
   - Inline arrow function at line 323-328
   - Cleanup at lines 332-335
   - ✅ Proper cleanup

4. **Focus Listener (Line 448)**
   ```typescript
   this.terminal.textarea.addEventListener("focus", focusFn);
   ```
   - Caller responsible for cleanup
   - ⚠️ No explicit cleanup registration

### useEffect/Atom Dependencies

**File:** `/mnt/d/Project/.15_PROJECT_WAVETERM/frontend/app/view/term/term-model.ts`

1. **Lines 411-416:** `termBPMUnsubFn` subscription
   ```typescript
   this.termBPMUnsubFn = globalStore.sub(this.termBPMAtom, () => {
       if (this.termRef.current?.terminal) {
           const allowBPM = globalStore.get(this.termBPMAtom) ?? true;
           this.termRef.current.terminal.options.ignoreBracketedPasteMode = !allowBPM;
       }
   });
   ```
   - Subscription-based (not useEffect)
   - Properly cleaned up in dispose() (line 560)
   - ✅ Correct pattern for Jotai

2. **Line 278-282:** `termThemeNameAtom` derivation
   ```typescript
   this.termThemeNameAtom = useBlockAtom(blockId, "termthemeatom", () => {
       return jotai.atom<string>((get) => {
           return get(getOverrideConfigAtom(this.blockId, "term:theme")) ?? DefaultTermTheme;
       });
   });
   ```
   - Uses `useBlockAtom` hook
   - Memoized by default
   - ✅ Correct pattern

### React Component Search

**File:** `/mnt/d/Project/.15_PROJECT_WAVETERM/frontend/app/view/term/term.tsx`

1. **Lines 259-260:** Search callbacks with useCallback
   ```typescript
   searchProps.onPrev = React.useCallback(() => executeSearch(searchVal, "previous"), [executeSearch, searchVal]);
   searchProps.onNext = React.useCallback(() => executeSearch(searchVal, "next"), [executeSearch, searchVal]);
   ```
   - ✅ Proper memoization

2. **Lines 261-265:** Scrollbar observer callbacks
   ```typescript
   const onScrollbarShowObserver = React.useCallback(() => { ... }, []);
   const onScrollbarHideObserver = React.useCallback(() => { ... }, []);
   ```
   - ✅ Memoized with proper deps

### Status: **PERFORMANCE ISSUES IN SETTINGS UI**
⚠️ **Critical Issues:**
- 6 inline onChange handlers in setting components (setting-controls.tsx)
- SliderSetting missing debounce (high-frequency RPC calls)
- TextSetting missing debounce (RPC on every keystroke)
- No React.useCallback wrapping for setting handlers

✅ **Well-Implemented:**
- Event cleanup in termwrap.ts
- Search callbacks properly memoized
- Atom subscriptions properly disposed
- Jotai atoms use proper derivation pattern

---

## Summary Table

| Category | Status | Severity | Files Affected |
|----------|--------|----------|-----------------|
| Build Output | Current & Fresh | ✅ None | dist/, release/ |
| Input Batching | Properly Wired | ✅ None | term-model.ts |
| Action Queue | Well-Implemented | ✅ None | emain-window.ts |
| Shell Status Race | Mitigated, Window Exists | ⚠️ Medium | term-model.ts |
| Theme Settings | Fire-and-Forget | ⚠️ Medium | setting-controls.tsx |
| Duplicate Code | Easy to Refactor | ⚠️ Low | term-model.ts (18 SetMeta calls) |
| Performance Hotspots | Settings UI Needs Optimization | ⚠️ High | setting-controls.tsx (6 inline handlers) |

---

## Unresolved Questions

1. **Race Condition Impact:** What's the actual user-facing impact of the shell status race window? Is it observable in practice?
2. **Config vs Meta:** Why does theme use `SetMetaCommand` while other settings use `SetConfigCommand`? Is this intentional?
3. **Debounce Strategy:** Are there plans to add debouncing to setting inputs, or is the current fire-and-forget acceptable?
4. **Build Timing:** Is the 2-minute delta between dist and release build intentional (installer generation)?

