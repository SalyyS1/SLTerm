// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package petengine

import (
	"math/rand"
)

// DialogueCategory represents types of dialogues
type DialogueCategory string

const (
	DialogueRandom  DialogueCategory = "random"
	DialogueHealth  DialogueCategory = "health"
	DialogueLevelUp DialogueCategory = "levelup"
	DialogueCustom  DialogueCategory = "custom"
)

// DialogueResponse wraps a dialogue text with metadata
type DialogueResponse struct {
	Text string `json:"text"`
	Type string `json:"type"` // random, health, levelup, custom
}

// Built-in Vietnamese dialogues
var dialoguesVI = map[string][]string{
	"happy": {
		"Code xịn quá đại ca!",
		"Hôm nay vui ghê!",
		"Em cổ vũ đại ca! 💪",
		"Đại ca ngon lành quá!",
	},
	"neutral": {
		"Hmm...",
		"Code gì vậy ta?",
		"...",
		"Đại ca ơi~",
	},
	"sad": {
		"Vuốt ve em đi mà...",
		"Em buồn quá...",
		"Đại ca bỏ rơi em rồi 😢",
	},
	"hungry": {
		"Em đói rồi, nghỉ ăn đi mà!",
		"Bụng em kêu rồi nè 🍕",
		"Cho em ăn đê đại ca!",
	},
	"sleepy": {
		"Mắt em díp lại rồi...",
		"Zzzz...",
		"Em buồn ngủ quá...",
	},
	"grabbed": {
		"Aaaa đặt em xuống!",
		"Wheee~",
		"Chóng mặt quá!",
		"Em sợ cao!",
	},
	"petted": {
		"Hehe cưng quá~",
		"Em thích lắm!",
		"Nữa đi nữa đi! ❤️",
	},
	"levelup": {
		"LEVEL UP! Em lên level mới rồi nè! 🎉",
		"Yay! Lên level! Cảm ơn đại ca! ✨",
	},
}

// Built-in English dialogues
var dialoguesEN = map[string][]string{
	"happy": {
		"Your code looks great!",
		"What a great day!",
		"You got this! 💪",
		"Keep coding, you're awesome!",
	},
	"neutral": {
		"Hmm...",
		"What are we building?",
		"...",
		"Hey there~",
	},
	"sad": {
		"Pat me please...",
		"I'm feeling down...",
		"Don't forget about me 😢",
	},
	"hungry": {
		"I'm hungry, take a break!",
		"My tummy is growling 🍕",
		"Feed me please!",
	},
	"sleepy": {
		"My eyes are closing...",
		"Zzzz...",
		"I'm so sleepy...",
	},
	"grabbed": {
		"Aaa put me down!",
		"Wheee~",
		"I'm getting dizzy!",
		"I'm scared of heights!",
	},
	"petted": {
		"Hehe that tickles~",
		"I love it!",
		"More more more! ❤️",
	},
	"levelup": {
		"LEVEL UP! I reached a new level! 🎉",
		"Yay! Leveled up! Thank you! ✨",
	},
}

// Health reminder dialogues
var healthRemindersVI = map[string][]string{
	"sleep": {
		"3h sáng rồi đại ca ơi, ngủ đi mà...",
		"Khuya rồi, mai code tiếp nha~",
		"Em buồn ngủ quá, ngủ đi mà...",
	},
	"lunch": {
		"Giờ ăn trưa rồi, nghỉ tay ăn cơm đi nào!",
		"Ăn gì chưa đại ca?",
	},
	"dinner": {
		"Ăn tối chưa đại ca?",
		"Bữa tối rồi, nghỉ tay đi nào!",
	},
	"water": {
		"Uống nước đi đại ca, đừng khô héo!",
		"💧 Hydrate time!",
	},
	"eyes": {
		"Nhìn xa 20 giây cho mắt nghỉ ngơi nha~",
		"👀 Nghỉ mắt tí đi đại ca!",
	},
	"standup": {
		"Đứng dậy vận động tí đi nào!",
		"Ngồi lâu quá rồi, giãn cơ đi~",
	},
}

var healthRemindersEN = map[string][]string{
	"sleep": {
		"It's late, go to bed!",
		"You need sleep to code well tomorrow~",
		"Time to rest...",
	},
	"lunch": {
		"Lunch time! Take a break!",
		"Have you eaten yet?",
	},
	"dinner": {
		"Dinner time!",
		"Time for dinner, take a break!",
	},
	"water": {
		"Drink some water!",
		"💧 Stay hydrated!",
	},
	"eyes": {
		"Look away for 20 seconds!",
		"👀 Rest your eyes!",
	},
	"standup": {
		"Stand up and stretch!",
		"You've been sitting for a while~",
	},
}

// GetDialogue returns a random dialogue based on mood, hour, and language
func GetDialogue(mood string, hour int, lang string) DialogueResponse {
	store := GetStore()
	profile := store.GetProfile()

	// Check for health reminders first (higher priority)
	healthText := getHealthReminder(hour, lang)
	if healthText != "" {
		return DialogueResponse{Text: healthText, Type: string(DialogueHealth)}
	}

	// Check custom dialogues
	if profile != nil && len(profile.CustomDialogues) > 0 {
		for _, d := range profile.CustomDialogues {
			// Check mood filter
			if d.Mood != "" && d.Mood != mood {
				continue
			}
			// Check time filter
			if d.TimeFrom > 0 && (hour < d.TimeFrom || hour > d.TimeTo) {
				continue
			}
			// 30% chance to use custom
			if rand.Intn(100) < 30 {
				text := d.TextVI
				if lang == "en" {
					text = d.TextEN
				}
				if text != "" {
					return DialogueResponse{Text: text, Type: string(DialogueCustom)}
				}
			}
		}
	}

	// Default mood dialogues
	dialogues := dialoguesVI
	if lang == "en" {
		dialogues = dialoguesEN
	}

	texts, ok := dialogues[mood]
	if !ok || len(texts) == 0 {
		texts = dialogues["neutral"]
	}

	text := texts[rand.Intn(len(texts))]
	return DialogueResponse{Text: text, Type: string(DialogueRandom)}
}

// getHealthReminder checks if any health reminder should trigger
func getHealthReminder(hour int, lang string) string {
	reminders := healthRemindersVI
	if lang == "en" {
		reminders = healthRemindersEN
	}

	// Sleep reminder: 23:00 - 05:00
	if hour >= 23 || hour < 5 {
		texts := reminders["sleep"]
		if len(texts) > 0 {
			return texts[rand.Intn(len(texts))]
		}
	}

	// Lunch reminder: 12:00 - 13:00
	if hour == 12 {
		texts := reminders["lunch"]
		if len(texts) > 0 && rand.Intn(100) < 50 {
			return texts[rand.Intn(len(texts))]
		}
	}

	// Dinner reminder: 18:00 - 19:00
	if hour == 18 {
		texts := reminders["dinner"]
		if len(texts) > 0 && rand.Intn(100) < 50 {
			return texts[rand.Intn(len(texts))]
		}
	}

	// Water and eyes are handled by the frontend timer (interval-based)
	return ""
}
