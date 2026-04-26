# 📌 PinMyAI

**PinMyAI** is a browser extension that lets you bookmark specific parts of ChatGPT conversations and jump back to them instantly - no more endless scrolling through long chats.

![Chrome Extension](https://img.shields.io/badge/platform-Chrome-blue)
![Version](https://img.shields.io/badge/version-1.0.0-green)
![Status](https://img.shields.io/badge/status-active-brightgreen)

---

## 🎯 What problem does it solve?

When you’re having a deep conversation with AI, this probably happens:

1. The AI mentions a term you don’t understand  
2. You ask: “What is XXX?”  
3. You get a detailed explanation  
4. Now you want to go back… but the chat is 10+ screens long 😫  

**PinMyAI acts like bookmarks for your conversation** — select, pin, and jump back anytime.

---

## ✨ Features

### 📌 Add a Pin
- Select any text in an AI response  
- Click the 📌 button that appears  
- Give it a name (auto-filled with the first ~20 characters)

### 📂 Pin Panel
- Open from the 📌 icon in the top-right  
- See all pins in the current conversation  
- Rename or delete pins  
- Sort by: newest, oldest, or conversation order  

### 🌐 Cross-conversation navigation
- View pins from all chats  
- Click a pin from another chat → choose:
  - Open in new tab  
  - Open in current tab  
  - Cancel  

### 🎯 Precise jump
- Jumps to the **exact text location**, not just the message  
- Smooth highlight animation (light blue, ~5 seconds)

---

## 🚀 Installation

### Load as an unpacked extension (dev mode)

1. Clone or download this repo  
2. Open Chrome and go to `chrome://extensions/`  
3. Turn on **Developer mode** (top right)  
4. Click **Load unpacked**  
5. Select the project folder  

### Chrome Web Store

> Coming soon

---

## 🛠 Supported platforms

| Platform | Status |
|----------|--------|
| ChatGPT | ✅ Fully supported |
| Claude | 🚧 Planned |
| DeepSeek | 🚧 Planned |

> Note: This version focuses on ChatGPT for a more polished experience. Support for other platforms will come later.

---

## 🎮 How to use

### Add a pin
1. Select text in an AI response  
2. Click the 📌 button  
3. Name it (or just save)  
4. It shows up instantly in the panel  

### Jump to a pin
- **Same chat**: click to jump + highlight  
- **Different chat**: choose how to open it  

### Manage pins
- Open the panel from the 📌 icon  
- ✏️ Rename  
- 🗑️ Delete (with confirmation)  
- Change sorting: time / conversation order  

---

## 🧩 Project structure

```text
├── manifest.json       # Extension config
├── content.js          # Core logic (DOM + pin handling)
├── background.js       # Background script (tab handling)
├── styles.css          # UI styles (panel, button, highlight)
└── icons/              # Icons