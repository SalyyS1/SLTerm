# SLTerm Vibe System — Implementation Plan (Electron + Go)

## 0. Goal

Anime/vibe terminal with:

- Pet overlay (Shimeji format + Pokémon pixel)
- Pet progression → 100% → achievement → switch pet
- Themes, backgrounds, fun UI
- Windows-first

---

## 1. Architecture

### Electron (UI)

- WaveTerm core terminal
- Canvas overlay → render pet
- Theme & background system
- Achievement UI + pet picker

### Go Daemon (Local Service)

- Store state (pet, XP, achievements)
- Progression rules engine
- WebSocket API → realtime events

### Data Packs

```
/pets
  /<pet-id>
    manifest.json
    sprites.png
    frames.json | actions.xml
```

---

## 2. Repo Structure

```
apps/desktop        # Electron
services/vibed      # Go daemon
packages/pet-sdk    # shared types + validators
data/user           # runtime data
```

---

## 3. IPC (WebSocket)

### Commands

- state.get
- pet.list
- pet.spawn / pet.dismiss
- pet.feed
- pet.setActive
- achievement.list

### Events

- pet.stateChanged
- stats.updated
- achievement.unlocked

---

## 4. Data Model

### PetInstance

- id
- petId
- xp
- progress (0–100)
- mood
- hunger / energy
- spawnedAt

### PlayerProfile

- activePetId
- completedPets[]
- achievements[]
- stats { activeMinutes, commandsRun, streak }

### Storage

SQLite → `%APPDATA%/SLTerm/vibe/`

---

## 5. Progression Rules (MVP)

- +1 XP / 60s active
- +0.2 XP / command
- Daily streak bonus
- Daily XP cap

### Completion

Progress = 100%
→ Unlock achievement
→ Move pet to completed
→ Prompt select new pet

---

## 6. Pet Packs

### Manifest (common)

```
{
  "id": "pikachu",
  "type": "pokemon | shimeji",
  "name": "Pikachu",
  "preview": "preview.png"
}
```

### Pokémon Pack

- spritesheet
- frames.json (atlas + duration)
- behavior → internal engine

### Shimeji Pack (MVP)

- Parse XML
- Map → idle / walk / jump / sleep
- Compile → actions.compiled.json

---

## 7. Renderer (Electron)

- Canvas overlay
- requestAnimationFrame loop
- Sprite atlas animation
- Movement:
  - clamp to pet zone
  - turn at edges

### Interaction

- Click → Feed / Pet / Dismiss
- Drag (v2)

---

## 8. UI Features

- Multiple pets
- Particle effects
- Daily quests
- Pet marketplace (import zip)
- Video background + blur

---

## 9. Milestones

### Sprint 1

- Go daemon + WS
- Electron overlay placeholder
- State storage

### Sprint 2

- Pokémon pack loader
- XP system
- Progress UI

### Sprint 3

- Achievements
- Completed pet flow

### Sprint 4

- Shimeji import (basic mapping)

### Sprint 5

- Theme gallery
- Background system
- Interaction polish

---

## 10. Brainstorm Hooks

- Success command → pet celebrate
- Error → pet sad
- Idle → sleep
- Focus streak → bonus XP
- Rare pet unlocks
- Seasonal events

---

## 11. Decisions Needed

- Pet zone: top bar / bottom bar
- Progress speed (fast vs slow)
- Storage: JSON (simple) or SQLite (scalable)
