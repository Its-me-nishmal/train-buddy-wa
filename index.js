import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import http from 'http';

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

// Global state to expose login QR code via web endpoint
let latestQrData = null;
let botConnectionStatus = 'Disconnected'; // 'Disconnected', 'QR_Ready', 'Connected'

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
            '--disable-gpu',
            '--single-process',
            '--disable-extensions',
            '--disable-component-extensions-with-background-pages',
            '--mute-audio',
            '--js-flags=--max-old-space-size=150',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        ]
    }
});

// Generate QR Code for login
client.on('qr', (qr) => {
    latestQrData = qr;
    botConnectionStatus = 'QR_Ready';
    console.log('\n[WhatsApp Bot] Scan the QR code below to connect your WhatsApp account:\n');
    qrcode.generate(qr, { small: true });
});

// Bot is ready
client.on('ready', () => {
    latestQrData = null;
    botConnectionStatus = 'Connected';
    console.log('\n=====================================================');
    console.log(' [SUCCESS] Train Buddy WhatsApp Bot is Active and Ready!');
    console.log('=====================================================\n');
});

// Authenticated handler
client.on('authenticated', () => {
    latestQrData = null;
    botConnectionStatus = 'Connected';
    console.log('[WhatsApp Bot] Authenticated successfully!');
});

// Disconnected handler
client.on('disconnected', (reason) => {
    latestQrData = null;
    botConnectionStatus = 'Disconnected';
    console.log(`[WhatsApp Bot] Client disconnected! Reason: ${reason}`);
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
        if (chatContexts[sender]) {
            const idleTime = Date.now() - chatContexts[sender].lastActivity;
            if (idleTime > CONTEXT_TIMEOUT_MS && chatContexts[sender].history.length > 0) {
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
            const isMalayalamOrManglish = (text) => {
                const malayalamRegex = /[\u0D00-\u0D7F]/;
                const manglishKeywords = /\b(nale|nale\?|trainukal|edayil|ethokke|ninn|poyal|samayam|ethum|ethuka|ravile|vaikit|varum|unda|undo|illa|illa\?|pokum|ezhudha|paraya|eppo|eppozha|eppol|evide|evideya)\b/i;
                return malayalamRegex.test(text) || manglishKeywords.test(text);
            };
            if (isMalayalamOrManglish(prompt)) {
                await msg.reply('ക്ഷമിക്കണം, ഇന്നത്തെ നിങ്ങളുടെ പരിധി (50 ചോദ്യങ്ങൾ) കഴിഞ്ഞിരിക്കുന്നു. ദയവായി നാളെ വീണ്ടും ശ്രമിക്കുക.');
            } else {
                await msg.reply('Sorry, you have reached your daily limit of 50 queries. Please try again tomorrow.');
            }
            return;
        }

        // Initialize user context history if not present
        if (!chatContexts[sender]) {
            chatContexts[sender] = { history: [], lastActivity: Date.now(), processing: false };
        }

        // Concurrency Lock: Drop/Ignore spam queries if already processing a query for this user
        if (chatContexts[sender].processing) {
            console.log(`[Spam Blocked] Ignored concurrent request from ${sender}`);
            return;
        }
        chatContexts[sender].processing = true;

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

        // 1. Build the API target URL
        let url = `${API_URL}/api/assistant?prompt=${encodeURIComponent(promptWithContext)}`;
        if (activeTrain) {
            url += `&train=${activeTrain}`;
        }

        try {
            // Send "typing..." status indicator
            await chat.sendStateTyping();

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
                
                // Limit history to last 10 exchanges (20 messages) to maintain context
                if (chatContexts[sender].history.length > 20) {
                    chatContexts[sender].history.shift();
                    chatContexts[sender].history.shift();
                }
                chatContexts[sender].lastActivity = Date.now();
            } else {
                await msg.reply(data.error || 'ക്ഷമിക്കണം, എനിക്ക് നിങ്ങളുടെ ചോദ്യം മനസ്സിലാക്കാൻ കഴിഞ്ഞില്ല. ഒരു ട്രെയിൻ നമ്പറോ സ്റ്റേഷൻ പേരോ നൽകുക.');
            }
        } finally {
            if (chatContexts[sender]) {
                chatContexts[sender].processing = false;
            }
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

// Poll to intercept requests as early as possible to block high-memory resources
const interceptInterval = setInterval(async () => {
    if (client.pupPage) {
        clearInterval(interceptInterval);
        try {
            console.log('[Puppeteer] Page detected, enabling request interception to block images/media...');
            await client.pupPage.setRequestInterception(true);
            client.pupPage.on('request', (req) => {
                const resourceType = req.resourceType();
                // Abort images, media, and fonts to stay within Render's 512MB RAM limit
                if (resourceType === 'image' || resourceType === 'media' || resourceType === 'font') {
                    req.abort();
                } else {
                    req.continue();
                }
            });
        } catch (err) {
            console.error('[Puppeteer] Failed to set request interception:', err.message);
        }
    }
}, 50);

// Start a simple health check server for Render / health checks
const PORT = process.env.PORT || 10000;
const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'healthy', connectionStatus: botConnectionStatus, timestamp: new Date().toISOString() }));
    } else if (req.url === '/qr') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        
        let content = '';
        if (botConnectionStatus === 'Connected') {
            content = `
                <h1 style="color: #25d366;">WhatsApp Connected!</h1>
                <p>Train Buddy WhatsApp Bot is active and ready to assist you.</p>
                <div style="font-size: 60px; margin: 20px 0;">✅</div>
            `;
        } else if (botConnectionStatus === 'QR_Ready' && latestQrData) {
            const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(latestQrData)}`;
            content = `
                <h1>Scan WhatsApp QR Code</h1>
                <p>Open WhatsApp on your phone, go to Linked Devices, and scan the QR code below:</p>
                <img src="${qrImageUrl}" alt="WhatsApp QR Code" style="border: 2px solid #ccc; padding: 10px; border-radius: 8px; margin: 20px 0; max-width: 100%; height: auto;" />
                <p style="color: #666; font-size: 14px; animation: pulse 1.5s infinite;">⏳ Status: Waiting for scan...</p>
                <script>
                    // Auto-refresh the page every 15 seconds to fetch new QR if it changes
                    setTimeout(() => { window.location.reload(); }, 15000);
                </script>
            `;
        } else {
            content = `
                <h1>WhatsApp Bot Status</h1>
                <p>Current Status: <strong style="color: #e67e22;">${botConnectionStatus}</strong></p>
                <p>Initializing or waiting for WhatsApp Web to load. Please refresh in a few seconds...</p>
                <div style="font-size: 60px; margin: 20px 0; animation: spin 2s linear infinite;">⚙️</div>
                <script>
                    setTimeout(() => { window.location.reload(); }, 5000);
                </script>
            `;
        }

        res.end(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Train Buddy Bot - Login</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    @keyframes pulse {
                        0% { opacity: 0.6; }
                        50% { opacity: 1; }
                        100% { opacity: 0.6; }
                    }
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        min-height: 100vh;
                        background: #f0f2f5;
                        margin: 0;
                        text-align: center;
                    }
                    .card {
                        background: white;
                        padding: 30px;
                        border-radius: 12px;
                        box-shadow: 0 4px 20px rgba(0,0,0,0.08);
                        max-width: 400px;
                        width: 90%;
                    }
                    h1 { color: #128c7e; margin-top: 0; }
                    p { color: #4a4a4a; line-height: 1.5; }
                </style>
            </head>
            <body>
                <div class="card">
                    ${content}
                </div>
            </body>
            </html>
        `);
    } else {
        res.writeHead(404);
        res.end();
    }
});

server.listen(PORT, () => {
    console.log(`[Health Server] Listening on port ${PORT}`);
});
