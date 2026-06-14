# Train Buddy WhatsApp Bot Integration

This project is a standalone WhatsApp bot that integrates with your **Train Buddy API Suite**. It listens to incoming messages, queries your Train Buddy AI Assistant, and replies natively on WhatsApp.

## Features
* **Modern ES Modules (ESM)** architecture.
* **Scan to Log In**: Generates a QR Code in your terminal using `qrcode-terminal` for easy authentication.
* **Persistent Sessions**: Uses `LocalAuth` so you only have to scan the QR code once.
* **Group Chat Aware**: Responds to direct messages automatically, and only responds in group chats when tagged/mentioned (e.g. `@bot`).
* **Auto-translates & formats** via the Train Buddy Core engine.

---

## Getting Started

### 1. Prerequisites
Make sure you have Node.js 18+ installed on your system.

### 2. Install Dependencies
Navigate to this directory in your terminal and run:
```bash
npm install
```

### 3. Configure API URL
Open the `.env` file and set the base URL of your active Train Buddy API.
* For local testing: `http://localhost:3000`
* For production: `https://your-vercel-domain.vercel.app`

```env
TRAIN_BUDDY_API_URL=https://train-buddy.vercel.app
```

### 4. Start the Bot
Run the start script:
```bash
npm start
```
1. Scan the generated QR Code using your WhatsApp mobile app (**Settings** -> **Linked Devices** -> **Link a Device**).
2. Once connected, your bot will log: `[SUCCESS] Train Buddy WhatsApp Bot is Active and Ready!`.
3. Try sending a message like *"where is train 16608?"* or in Malayalam: *"ട്രെയിൻ 16608 എവിടെയാണ്?"*.
