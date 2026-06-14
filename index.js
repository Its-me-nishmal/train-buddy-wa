import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import fs from 'fs';

// Programmatically load .env configuration if present
if (fs.existsSync('.env')) {
    const envConfig = fs.readFileSync('.env', 'utf-8');
    for (const line of envConfig.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            const [key, ...valueParts] = trimmed.split('=');
            const value = valueParts.join('=').trim();
            if (key) {
                process.env[key.trim()] = value;
            }
        }
    }
}

const API_URL = (process.env.TRAIN_BUDDY_API_URL || 'http://localhost:3000').replace(/\/+$/, '');

const getChromePath = () => {
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        return process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    // Auto-detect standard Google Chrome on Windows
    const winPaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    ];
    for (const p of winPaths) {
        if (fs.existsSync(p)) {
            console.log(`[WhatsApp Bot] Using detected Chrome binary at: ${p}`);
            return p;
        }
    }
    return undefined;
};

console.log('=====================================================');
console.log('   Train Buddy WhatsApp Bot Integration');
console.log(`   Target API URL: ${API_URL}`);
console.log('=====================================================');

// Initialize the WhatsApp Web client
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        executablePath: getChromePath(),
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
});

// Generate QR Code for login
client.on('qr', (qr) => {
    console.log('\n[WhatsApp Bot] Scan the QR code below to connect your WhatsApp account:\n');
    qrcode.generate(qr, { small: true });
});

// Bot is ready
client.on('ready', () => {
    console.log('\n=====================================================');
    console.log(' [SUCCESS] Train Buddy WhatsApp Bot is Active and Ready!');
    console.log('=====================================================\n');
});

// Rate limit tracker (50 chats per user per day)
const rateLimits = {};
const DAILY_LIMIT = 50;

// Conversational context tracker (keeps history of last 3 exchanges per user, clears after 10m of inactivity)
const chatContexts = {};
const CONTEXT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// Memory Cleanup: Remove old rate limit records from previous days to prevent RAM leaks
const pruneOldRateLimits = (today) => {
    for (const sender in rateLimits) {
        if (rateLimits[sender].date !== today) {
            delete rateLimits[sender];
        }
    }
};

// Memory Cleanup: Remove idle conversational histories
const pruneOldContexts = () => {
    const now = Date.now();
    for (const sender in chatContexts) {
        if (now - chatContexts[sender].lastActivity > CONTEXT_TIMEOUT_MS) {
            delete chatContexts[sender];
        }
    }
};

// Handle incoming messages
client.on('message', async (msg) => {
    try {
        const chat = await msg.getChat();
        
        // Handle only private chats to avoid group spam, unless explicitly mentioned in a group
        const isMentioned = msg.mentionedIds && msg.mentionedIds.includes(client.info.wid._serialized);
        if (chat.isGroup && !isMentioned) {
            return;
        }

        // Clean the incoming text
        let prompt = msg.body ? msg.body.trim() : '';
        if (chat.isGroup && isMentioned) {
            // Remove the bot mention tag from the prompt string if in group
            const mentionPrefix = `@${client.info.wid.user}`;
            prompt = prompt.replace(mentionPrefix, '').trim();
        }

        if (!prompt) return;

        // Skip responding to status messages or automated triggers
        if (prompt.startsWith('!') || prompt.startsWith('.')) return;

        // Rate Limiting Check (Daily limit of 50 chats per user)
        const today = new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata' });
        const sender = msg.from;

        // Check if there was an active session that has now timed out
        let sessionWasCleared = false;
        if (chatContexts[sender]) {
            const idleTime = Date.now() - chatContexts[sender].lastActivity;
            if (idleTime > CONTEXT_TIMEOUT_MS && chatContexts[sender].history.length > 0) {
                sessionWasCleared = true;
                delete chatContexts[sender];
            }
        }

        // Prune old records to free up memory before allocating new limits
        pruneOldRateLimits(today);
        pruneOldContexts();

        if (!rateLimits[sender] || rateLimits[sender].date !== today) {
            rateLimits[sender] = { count: 0, date: today };
        }

        if (rateLimits[sender].count >= DAILY_LIMIT) {
            console.log(`[Rate Limited] Blocked query from ${sender} (Reached daily limit of ${DAILY_LIMIT})`);
            await msg.reply('ക്ഷമിക്കണം, ഇന്നത്തെ നിങ്ങളുടെ പരിധി (50 ചോദ്യങ്ങൾ) കഴിഞ്ഞിരിക്കുന്നു. ദയവായി നാളെ വീണ്ടും ശ്രമിക്കുക.');
            return;
        }

        // Notify user if session has been cleared due to inactivity
        if (sessionWasCleared) {
            await msg.reply('⚠️ Session auto-cleared!');
        }

        // Initialize user context history if not present
        if (!chatContexts[sender]) {
            chatContexts[sender] = { history: [], lastActivity: Date.now() };
        }

        // Try to identify a 5-digit train number from current prompt or history
        let activeTrain = null;
        const currentTrainMatch = prompt.match(/\b\d{5}\b/);
        if (currentTrainMatch) {
            activeTrain = currentTrainMatch[0];
        } else {
            // Scan history backwards for a train number
            for (let i = chatContexts[sender].history.length - 1; i >= 0; i--) {
                const histMatch = chatContexts[sender].history[i].text.match(/\b\d{5}\b/);
                if (histMatch) {
                    activeTrain = histMatch[0];
                    break;
                }
            }
        }

        // Format prompt with history for context-aware responses
        let promptWithContext = prompt;
        if (chatContexts[sender].history.length > 0) {
            const historyText = chatContexts[sender].history
                .map(item => `${item.role === 'user' ? 'User' : 'Assistant'}: ${item.text}`)
                .join('\n');
            promptWithContext = `Previous Conversation History:\n${historyText}\n\nUser: ${prompt}`;
        }

        // Increment count for this user
        rateLimits[sender].count += 1;
        console.log(`[Message Received] From: ${sender} | Count: ${rateLimits[sender].count}/${DAILY_LIMIT} | Active Train: ${activeTrain || 'None'} | Query: "${prompt}"`);

        // Send "typing..." status indicator
        await chat.sendStateTyping();

        // 1. Build the API target URL
        let url = `${API_URL}/api/assistant?prompt=${encodeURIComponent(promptWithContext)}`;
        if (activeTrain) {
            url += `&train=${activeTrain}`;
        }

        // 2. Fetch answer from the Train Buddy serverless endpoint
        const response = await fetch(url);
        if (!response.ok) {
            console.error(`[API Error] Status Code: ${response.status}`);
            await msg.reply('മറുപടി ലഭിക്കുന്നതിൽ തടസ്സം നേരിട്ടു. ദയവായി അല്പം കഴിഞ്ഞ് വീണ്ടും ശ്രമിക്കുക. (API connection failed)');
            return;
        }

        const data = await response.json();
        
        if (data.success && data.response) {
            console.log(`[Reply Sent] To: ${msg.from} | Response: "${data.response}"`);
            await msg.reply(data.response);

            // Save exchange to history
            chatContexts[sender].history.push({ role: 'user', text: prompt });
            chatContexts[sender].history.push({ role: 'assistant', text: data.response });
            
            // Limit history to last 3 exchanges (6 messages) to avoid bloat
            if (chatContexts[sender].history.length > 6) {
                chatContexts[sender].history.shift();
                chatContexts[sender].history.shift();
            }
            chatContexts[sender].lastActivity = Date.now();
        } else {
            await msg.reply(data.error || 'ക്ഷമിക്കണം, എനിക്ക് നിങ്ങളുടെ ചോദ്യം മനസ്സിലാക്കാൻ കഴിഞ്ഞില്ല. ഒരു ട്രെയിൻ നമ്പറോ സ്റ്റേഷൻ പേരോ നൽകുക.');
        }

    } catch (error) {
        console.error('[Bot Error Handler]:', error.message);
        try {
            await msg.reply('Train Buddy temporarily encountered an issue. Please try again.');
        } catch (replyErr) {
            console.error('Failed to send fallback reply:', replyErr.message);
        }
    }
});

// Start the client
client.initialize();
