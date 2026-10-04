const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 3000;
const isVercel = process.env.VERCEL === '1' || process.env.NOW_REGION != null || process.env.AWS_LAMBDA_FUNCTION_NAME != null;
const SESSIONS_FILE = isVercel ? path.join('/tmp', 'sessions.json') : path.join(__dirname, 'sessions.json');
const CONFIG_FILE = isVercel ? path.join('/tmp', 'config.json') : path.join(__dirname, 'config.json');

// Global memory data store (persists across warm serverless invocations)
global._retroSessions = global._retroSessions || {};
let sessions = global._retroSessions;

let config = {
    discordWebhook: '',
    serverName: 'Retro Roleplay AC',
    port: PORT
};
let sseClients = [];

// Load config
try {
    if (fs.existsSync(CONFIG_FILE)) {
        config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
    }
} catch (e) { }

// Load sessions
try {
    if (fs.existsSync(SESSIONS_FILE)) {
        const loaded = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
        Object.assign(sessions, loaded);
    }
} catch (e) { }

function saveSessions() {
    try {
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');
    } catch (e) {
        console.error('Save sessions error:', e);
    }
}

function saveConfig() {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    } catch (e) {
        console.error('Save config error:', e);
    }
}

// Broadcast SSE event to all connected web dashboard clients
function broadcastEvent(eventType, data) {
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    sseClients.forEach(client => {
        try {
            client.write(payload);
        } catch (e) { }
    });
}

// Send rich Discord embed
function sendDiscordWebhook(title, description, color = 0x8b5cf6, fields = []) {
    if (!config.discordWebhook || !config.discordWebhook.startsWith('http')) return;

    try {
        const url = new URL(config.discordWebhook);
        const postData = JSON.stringify({
            username: "Retro Roleplay Anti-Cheat",
            avatar_url: "https://i.imgur.com/kR1k7kP.png",
            embeds: [{
                title: title,
                description: description,
                color: color,
                fields: fields,
                footer: { text: "Retro Roleplay • Ocean Edition Forensic Suite" },
                timestamp: new Date().toISOString()
            }]
        });

        const req = http.request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        });
        req.on('error', () => { });
        req.write(postData);
        req.end();
    } catch (e) { }
}

// Helper to get local IP
function getLocalIpAddresses() {
    const interfaces = os.networkInterfaces();
    const addresses = [];
    for (const name of Object.keys(interfaces)) {
        for (const net of interfaces[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                addresses.push(net.address);
            }
        }
    }
    return addresses;
}

// HTTP Server
const server = http.createServer((req, res) => {
    // CORS headers for all requests
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        return res.end();
    }

    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = urlObj.pathname;

    // ================= STATIC FILES =================
    if (pathname === '/' || pathname === '/index.html') {
        return serveFile(res, path.join(__dirname, 'public', 'index.html'), 'text/html');
    }

    // Serve Scanner Binary download explicitly
    if (pathname === '/download/scanner' || pathname === '/api/download/scanner') {
        let scannerPath = path.join(__dirname, 'public', 'RetroAC_Scanner.exe');
        if (!fs.existsSync(scannerPath)) {
            scannerPath = path.join(__dirname, '..', 'retro_ac_csharp', 'Bin', 'RetroAC_Scanner.exe');
        }
        if (fs.existsSync(scannerPath)) {
            res.setHeader('Content-Disposition', 'attachment; filename="RetroAC_Scanner.exe"');
            return serveFile(res, scannerPath, 'application/octet-stream');
        }
    }

    // Serve any file from public/ directory
    const cleanPath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    const staticFilePath = path.join(__dirname, 'public', cleanPath);
    if (fs.existsSync(staticFilePath) && fs.statSync(staticFilePath).isFile()) {
        const ext = path.extname(staticFilePath).toLowerCase();
        const mimeTypes = {
            '.html': 'text/html',
            '.css': 'text/css',
            '.js': 'application/javascript',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon',
            '.webp': 'image/webp',
            '.mp4': 'video/mp4',
            '.exe': 'application/octet-stream'
        };
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        return serveFile(res, staticFilePath, contentType);
    }

    // ================= REAL-TIME SSE STREAM =================
    if (pathname === '/api/events') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });
        res.write(`data: ${JSON.stringify({ type: 'connected', time: new Date() })}\n\n`);
        sseClients.push(res);

        req.on('close', () => {
            sseClients = sseClients.filter(c => c !== res);
        });
        return;
    }

    // ================= API ENDPOINTS =================
    
    // GET /api/stats
    if (pathname === '/api/stats' && req.method === 'GET') {
        let total = 0, banned = 0, clean = 0, declined = 0;
        Object.values(sessions).forEach(s => {
            total++;
            if (s.verdict === 'BLACKLIST_CHEAT_DETECTED' || s.riskScore >= 60) banned++;
            else if (s.verdict === 'CLEAN') clean++;
            if (s.status === 'DECLINED') declined++;
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            total, banned, clean, declined,
            serverIps: getLocalIpAddresses(),
            port: PORT,
            activeCount: Object.keys(sessions).length
        }));
    }

    // GET /api/sessions
    if (pathname === '/api/sessions' && req.method === 'GET') {
        const list = Object.values(sessions).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(list));
    }

    // GET /api/sessions/:token
    if (pathname.startsWith('/api/sessions/') && req.method === 'GET') {
        const token = pathname.split('/')[3]?.toUpperCase();
        if (token && sessions[token]) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(sessions[token]));
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: "Session not found" }));
    }

    // POST /api/sessions/create
    if (pathname === '/api/sessions/create' && req.method === 'POST') {
        readJsonBody(req, body => {
            const token = body.token || `RETRO-${Math.floor(1000 + Math.random() * 9000)}`;
            const suspectName = body.suspectName || 'Şüpheli Oyuncu';
            const adminName = body.adminName || 'Admin';

            const newSession = {
                token: token,
                suspectName: suspectName,
                adminName: adminName,
                status: 'WAITING', // WAITING, ACCEPTED, SCANNING, COMPLETED, DECLINED
                riskScore: 0,
                verdict: 'PENDING',
                createdAt: new Date().toLocaleString('tr-TR'),
                report: null
            };

            sessions[token] = newSession;
            saveSessions();

            broadcastEvent('session_created', newSession);
            sendDiscordWebhook("⚠️ Yeni Hile Kontrolü Başlatıldı!",
                `**Şüpheli:** ${suspectName}\n**Yetkili:** ${adminName}\n**Oluşturulan PIN:** \`${token}\``,
                0x8b5cf6);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, session: newSession }));
        });
        return;
    }

    // DELETE /api/sessions (Clear all)
    if (pathname === '/api/sessions' && req.method === 'DELETE') {
        sessions = {};
        saveSessions();
        broadcastEvent('sessions_cleared', {});
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true }));
    }

    // ================= CLIENT SCANNER ENDPOINTS =================

    // POST /api/client/heartbeat
    if (pathname === '/api/client/heartbeat' && req.method === 'POST') {
        readJsonBody(req, body => {
            const token = (body.token || '').toUpperCase();
            const status = body.status || 'UNKNOWN';
            const hostname = body.hostname || 'PC';
            const username = body.username || 'User';

            if (!sessions[token]) {
                sessions[token] = {
                    token: token,
                    suspectName: `${username} (${hostname})`,
                    adminName: 'Otomatik',
                    status: status,
                    riskScore: 0,
                    verdict: 'PENDING',
                    createdAt: new Date().toLocaleString('tr-TR'),
                    report: null
                };
            } else {
                sessions[token].status = status;
                if (!sessions[token].suspectName.includes(hostname)) {
                    sessions[token].suspectName = `${sessions[token].suspectName} (${hostname}\\${username})`;
                }
            }

            saveSessions();
            broadcastEvent('client_heartbeat', {
                token,
                status,
                suspectName: sessions[token].suspectName,
                hostname,
                username,
                time: new Date().toLocaleTimeString('tr-TR')
            });

            if (status === 'ACCEPTED') {
                sendDiscordWebhook("🟢 Şüpheli Hile Kontrolünü Onayladı!",
                    `**Şüpheli:** ${sessions[token].suspectName}\n**PIN:** \`${token}\`\nOyuncu ACCESS verdi, derin tarama başladı!`,
                    0x10b981);
            } else if (status === 'DECLINED') {
                sendDiscordWebhook("🚨 HİLE KONTROLÜ REDDEDİLDİ (DECLINE)!",
                    `**Şüpheli:** ${sessions[token].suspectName}\n**PIN:** \`${token}\`\nOyuncu kontrolü reddetti! Kalıcı ban uygulanmalıdır.`,
                    0xef4444);
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
        });
        return;
    }

    // POST /api/client/report
    if (pathname === '/api/client/report' && req.method === 'POST') {
        readJsonBody(req, body => {
            const token = (body.token || '').toUpperCase();
            const report = body.report;

            if (!report) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: "No report provided" }));
            }

            if (!sessions[token]) {
                sessions[token] = {
                    token: token,
                    suspectName: `${report.SystemInfo?.Username || 'Bilinmiyor'} (${report.SystemInfo?.Hostname || 'PC'})`,
                    adminName: 'Otomatik',
                    createdAt: new Date().toLocaleString('tr-TR')
                };
            }

            sessions[token].status = 'COMPLETED';
            sessions[token].riskScore = report.RiskScore || 0;
            sessions[token].verdict = report.Verdict || 'CLEAN';
            sessions[token].verdictText = report.VerdictText || 'TEMİZ';
            sessions[token].report = report;

            saveSessions();

            broadcastEvent('report_received', {
                token: token,
                session: sessions[token]
            });

            let color = 0x10b981;
            let title = `✔ Temiz Oyuncu Denetimi: ${sessions[token].suspectName}`;
            if (report.Verdict === 'BLACKLIST_CHEAT_DETECTED') {
                color = 0xdc2626;
                title = `🚨 KARA LİSTE HİLE TESPİT EDİLDİ: ${sessions[token].suspectName}`;
            } else if (report.RiskScore >= 60) {
                color = 0xef4444;
                title = `⚠️ Hile / Makro Tespit Edildi: ${sessions[token].suspectName}`;
            }

            sendDiscordWebhook(title,
                `**Token:** \`${token}\`\n**Risk Skoru:** %${report.RiskScore}\n**Sonuç:** ${report.VerdictText}\n**Bulunan Tehdit Sayısı:** ${report.DetectionsCount}\n**Tarama Süresi:** ${report.ScanDuration}`,
                color);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
        });
        return;
    }

    // POST /api/settings/discord
    if (pathname === '/api/settings/discord' && req.method === 'POST') {
        readJsonBody(req, body => {
            config.discordWebhook = (body.webhook || '').trim();
            saveConfig();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, webhook: config.discordWebhook }));
        });
        return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: "Endpoint not found" }));
});

function serveFile(res, filePath, contentType) {
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            return res.end('File Not Found');
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
}

function readJsonBody(req, callback) {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
        try {
            const data = JSON.parse(body || '{}');
            callback(data);
        } catch (e) {
            callback({});
        }
    });
}

if (require.main === module) {
    server.listen(PORT, '0.0.0.0', () => {
        console.log('===========================================================');
        console.log('  🛡️ RETRO ROLEPLAY - ANTI-CHEAT WEB PLATFORM (OCEAN ED.)');
        console.log('===========================================================');
        console.log(`[+] Web Dashboard Sunucusu Dinleniyor:`);
        console.log(`    👉 Local:    http://localhost:${PORT}`);
        getLocalIpAddresses().forEach(ip => {
            console.log(`    👉 Network:  http://${ip}:${PORT}  (Oyuncular için)`);
        });
        console.log('===========================================================');
    });
}

module.exports = server;
