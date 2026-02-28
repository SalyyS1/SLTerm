# Plan: SLTerm Vibe System — Pet + Discord RPC

Created: 2026-02-28
Status: 🟡 In Progress

## Overview

Biến SLTerm thành "Vibecoding Terminal" — terminal đầu tiên có pet Pokémon/Shimeji chạy nhảy tự do, speech bubbles đáng yêu, health reminders, và Discord Rich Presence.

## Tech Stack

- **Frontend:** React + Canvas overlay + CSS sprites (pokesprite-spritesheet)
- **Backend:** Go daemon (wavesrv) — Pet engine, Session tracker, Discord RPC
- **Assets:** pokesprite-spritesheet, Shimeji packs
- **i18n:** Vietnamese + English (tận dụng i18next hiện có)

## Phases

| Phase | Name                        | Status     | Tasks | Est.     |
| ----- | --------------------------- | ---------- | ----- | -------- |
| 01    | Setup & Dependencies        | ⬜ Pending | 6     | 0.5 ngày |
| 02    | Pet Data Layer (Go)         | ⬜ Pending | 8     | 1 ngày   |
| 03    | Pet Renderer (Frontend)     | ⬜ Pending | 10    | 2 ngày   |
| 04    | Pet AI & Free-Roaming       | ⬜ Pending | 8     | 1.5 ngày |
| 05    | Grab & Drop + Interaction   | ⬜ Pending | 7     | 1 ngày   |
| 06    | Dialogue & Health Reminders | ⬜ Pending | 9     | 1.5 ngày |
| 07    | HUD & Pet Selection UI      | ⬜ Pending | 8     | 1 ngày   |
| 08    | Discord Rich Presence       | ⬜ Pending | 10    | 1.5 ngày |
| 09    | XP & Progression System     | ⬜ Pending | 7     | 1 ngày   |
| 10    | Integration & Testing       | ⬜ Pending | 8     | 1 ngày   |

**Tổng:** ~81 tasks | Ước tính: ~12 ngày

## Quick Commands

- Start Phase 1: `/code phase-01`
- Check progress: `/next`
- Save context: `/save-brain`
