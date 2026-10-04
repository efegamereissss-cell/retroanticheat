const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const url = require('url');

const PORT = process.env.PORT || 3000;
const isVercel = process.env.VERCEL === '1' || process.env.NOW_REGION != null || process.env.AWS_LAMBDA_FUNCTION_NAME != null;
const SESSIONS_FILE = isVercel ? path.join('/tmp', 'sessions.json') : path.join(__dirname, 'sessions.json');
const CONFIG_FILE = isVercel ? path.join('/tmp', 'config.json') : path.join(__dirname, 'config.json');

// Global memory data store (persists across warm serverless invocations)
global._retroSessions = global._retroSessions || {};
let sessions = global._retroSessions;

// Auth session tokens
global._retroAuthTokens = global._retroAuthTokens || {};
let authTokens = global._retroAuthTokens;

let config = {
    discordWebhook: '',
    serverName: 'Retro Roleplay AC',
    port: PORT
};
let sseClients = [];

// ================= KEYAUTH LICENSE VERIFICATION =================
function callKeyAuth(postData, callback) {
    const req = https.request('https://keyauth.win/api/1.2/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData),
            'User-Agent': 'KeyAuth-NodeJS'
        }
    }, res => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
            try {
                const json = JSON.parse(body);
                callback(null, json);
            } catch (e) {
                callback(e, null);
            }
        });
    });

    req.on('error', err => callback(err, null));
    req.write(postData);
    req.end();
}

function verifyLicenseKey(licenseKey, clientIp, callback) {
    if (!licenseKey || typeof licenseKey !== 'string') {
        return callback(false, "Lütfen bir lisans anahtarı girin.");
    }
    const cleanKey = licenseKey.trim();

    // Master key bypass (backup for owner)
    if (cleanKey === 'retro_master_2026' || cleanKey === 'retroadmin') {
        return callback(true, "Master Anahtar ile Giriş Yapıldı", { key: cleanKey, plan: "Owner / Full Access" });
    }

    const appName = "retroac";
    const ownerId = "2T6QmVtm9P";
    const version = "1.0";

    const initParams = `type=init&name=${encodeURIComponent(appName)}&ownerid=${encodeURIComponent(ownerId)}&version=${encodeURIComponent(version)}`;

    callKeyAuth(initParams, (err, initData) => {
        if (err || !initData) {
            return callback(false, "KeyAuth sunucusuna bağlanılamadı. Lütfen internetinizi kontrol edin.");
        }
        if (!initData.success || !initData.sessionid) {
            return callback(false, initData.message || "KeyAuth uygulaması başlatılamadı.");
        }

        const sessionId = initData.sessionid;
        // KeyAuth requires HWID to be >= 20 characters
        const hwid = crypto.createHash('sha256').update(`retroac_${cleanKey}_${clientIp || 'browser'}`).digest('hex');

        const licenseParams = `type=license&key=${encodeURIComponent(cleanKey)}&sessionid=${encodeURIComponent(sessionId)}&name=${encodeURIComponent(appName)}&ownerid=${encodeURIComponent(ownerId)}&hwid=${encodeURIComponent(hwid)}`;

        callKeyAuth(licenseParams, (err2, licData) => {
            if (err2 || !licData) {
                return callback(false, "KeyAuth doğrulaması sırasında bağlantı koptu.");
            }
            if (licData.success) {
                return callback(true, licData.message || "Giriş Başarılı!", licData.info || {});
            } else {
                return callback(false, licData.message || "Geçersiz Lisans Anahtarı!");
            }
        });
    });
}

function getAuthTokenFromRequest(req) {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7).trim();
    }
    const customHeader = req.headers['x-admin-token'];
    if (customHeader) return customHeader.trim();

    try {
        const parsed = url.parse(req.url, true);
        if (parsed.query && parsed.query.token) return parsed.query.token;
    } catch (e) { }
    return null;
}

function checkAdminAuth(req) {
    const token = getAuthTokenFromRequest(req);
    if (!token) return false;
    return !!authTokens[token];
}

function sendUnauthorized(res, msg = "Yetkisiz Erişim! KeyAuth lisans anahtarı ile giriş zorunludur.") {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        error: "UNAUTHORIZED",
        message: msg,
        timestamp: new Date().toISOString()
    }));
}

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
try {
    const tmpFile = path.join('/tmp', 'sessions.json');
    if (fs.existsSync(tmpFile)) {
        const loaded = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
        Object.assign(sessions, loaded);
    }
} catch (e) { }

function saveSessions() {
    let saved = false;
    try {
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');
        saved = true;
    } catch (e) { }
    if (!saved) {
        try {
            const tmpFile = path.join('/tmp', 'sessions.json');
            fs.writeFileSync(tmpFile, JSON.stringify(sessions, null, 2), 'utf8');
        } catch (e) {
            console.error('Save sessions error:', e);
        }
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
        if (!checkAdminAuth(req)) {
            return sendUnauthorized(res, "SSE yetkili akışına bağlanmak için lisans doğrulaması gereklidir.");
        }
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
    
    // POST /api/auth/login
    if (pathname === '/api/auth/login' && req.method === 'POST') {
        readJsonBody(req, body => {
            const key = (body.key || body.licenseKey || '').trim();
            const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
            verifyLicenseKey(key, clientIp, (success, message, info) => {
                if (success) {
                    const token = 'retro_auth_' + crypto.randomBytes(16).toString('hex');
                    authTokens[token] = {
                        key: key,
                        info: info,
                        createdAt: Date.now()
                    };
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: true, token, message, info }));
                } else {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message }));
                }
            });
        });
        return;
    }

    // POST /api/auth/verify
    if (pathname === '/api/auth/verify' && req.method === 'POST') {
        readJsonBody(req, body => {
            const token = body.token;
            if (token && authTokens[token]) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ valid: true, user: authTokens[token] }));
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ valid: false }));
        });
        return;
    }

    // POST /api/auth/logout
    if (pathname === '/api/auth/logout' && req.method === 'POST') {
        readJsonBody(req, body => {
            if (body.token) delete authTokens[body.token];
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true }));
        });
        return;
    }

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
        if (!checkAdminAuth(req)) return sendUnauthorized(res);
        const list = Object.values(sessions).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(list));
    }

    // GET /api/sessions/:token
    if (pathname.startsWith('/api/sessions/') && req.method === 'GET') {
        if (!checkAdminAuth(req)) return sendUnauthorized(res);
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
        if (!checkAdminAuth(req)) return sendUnauthorized(res);
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
        if (!checkAdminAuth(req)) return sendUnauthorized(res);
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
        if (!checkAdminAuth(req)) return sendUnauthorized(res);
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
