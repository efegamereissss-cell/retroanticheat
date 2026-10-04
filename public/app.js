// ===================================================================
// RETRO ANTICHEAT — OCEAN EDITION (FRONTEND APP ENGINE)
// OVERLORD CYBER DARK THEME + NATIVE SOUND + REALTIME SSE
// ===================================================================

let allSessions = [];
let currentInspectedToken = null;
let currentInspectedSession = null;
let currentPin = "RETRO-XXXX";

// ================= THEME SWITCHER =================
function switchTheme(theme) {
    document.body.className = theme + '-theme';
    localStorage.setItem('retro_theme', theme);

    const btnCrimson = document.getElementById('btnSwitchCrimson');
    const btnPurple = document.getElementById('btnSwitchPurple');
    const btnCyan = document.getElementById('btnSwitchCyan');

    if (btnCrimson) btnCrimson.classList.toggle('active', theme === 'crimson');
    if (btnPurple) btnPurple.classList.toggle('active', theme === 'purple');
    if (btnCyan) btnCyan.classList.toggle('active', theme === 'cyan');

    const badge = document.getElementById('navGameBadge');
    if (badge) {
        if (theme === 'crimson') badge.innerText = 'CRIMSON';
        else if (theme === 'purple') badge.innerText = 'APPLE VIOLET';
        else if (theme === 'cyan') badge.innerText = 'CYBER CYAN';
    }
}

function initTheme() {
    const saved = localStorage.getItem('retro_theme') || 'crimson';
    switchTheme(saved);
}

// ================= KEYAUTH ADMIN AUTHENTICATION & TAMPER GUARD =================
let currentAuthToken = null;
let activeEventSource = null;
let isTamperTriggered = false;

function triggerTamperLock(reason = "Tersine Mühendislik veya DOM Müdahalesi Tespit Edildi!") {
    if (isTamperTriggered) return;
    isTamperTriggered = true;
    localStorage.removeItem('retro_admin_auth');
    currentAuthToken = null;

    playSound('alert');

    // Wipe body and show lock screen
    document.body.innerHTML = `
        <div class="tamper-lockout-screen">
            <i class="fa-solid fa-triangle-exclamation"></i>
            <h1>GÜVENLİK İHLALİ: TERSİNE MÜHENDİSLİK TESPİT EDİLDİ</h1>
            <p>${escapeHtml(reason)}<br>Giriş ekranı veya yetkili paneli doğrudan manipüle edilmeye çalışıldı. Sistem güvenliği için sayfa imha edildi.</p>
            <button class="btn btn-primary" style="margin-top: 15px; padding: 15px 30px; font-weight: 800; border-radius: 50px;" onclick="location.reload()">
                <i class="fa-solid fa-arrows-rotate"></i> Yeniden Başlat & Giriş Yap
            </button>
        </div>
    `;

    console.warn(`%c[RETRO AC SENTINEL] %c${reason}`, 'background: #ff0055; color: #fff; font-size: 16px; font-weight: bold; padding: 6px;', 'color: #00dfd8; font-size: 13px;');
    throw new Error('SECURITY_TAMPER_DETECTED: ' + reason);
}

function handleUnauthorized() {
    localStorage.removeItem('retro_admin_auth');
    currentAuthToken = null;
    const overlay = document.getElementById('authGateOverlay');
    const protectedApp = document.getElementById('protectedApp');
    const navProfile = document.getElementById('navAdminProfile');

    if (protectedApp) protectedApp.classList.add('locked');
    if (overlay) overlay.classList.remove('hidden');
    if (navProfile) navProfile.style.display = 'none';
    if (activeEventSource) {
        activeEventSource.close();
        activeEventSource = null;
    }
}

async function authFetch(url, options = {}) {
    const token = localStorage.getItem('retro_admin_auth');
    options.headers = options.headers || {};
    if (token) {
        options.headers['Authorization'] = `Bearer ${token}`;
        options.headers['x-admin-token'] = token;
    }
    const res = await fetch(url, options);
    if (res.status === 401 && !url.includes('/api/auth/')) {
        handleUnauthorized();
        throw new Error('UNAUTHORIZED');
    }
    return res;
}

function onAuthSuccess() {
    fetchStats();
    fetchSessions();
    initRealtimeEvents();
}

async function initAuth() {
    const input = document.getElementById('adminKeyInput');
    if (input && !input.dataset.bound) {
        input.dataset.bound = 'true';
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') performAdminLogin();
        });
        input.addEventListener('input', () => {
            playSound('click');
        });
    }

    const token = localStorage.getItem('retro_admin_auth');
    const overlay = document.getElementById('authGateOverlay');
    const protectedApp = document.getElementById('protectedApp');
    const navProfile = document.getElementById('navAdminProfile');

    if (!token) {
        if (overlay) overlay.classList.remove('hidden');
        if (protectedApp) protectedApp.classList.add('locked');
        if (navProfile) navProfile.style.display = 'none';
        return false;
    }

    try {
        const res = await fetch('/api/auth/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });
        const data = await res.json();
        if (data.valid) {
            currentAuthToken = token;
            if (overlay) overlay.classList.add('hidden');
            if (protectedApp) protectedApp.classList.remove('locked');
            if (navProfile) {
                navProfile.style.display = 'flex';
                const lbl = document.getElementById('navAdminName');
                if (lbl && data.user?.info?.username) lbl.innerText = data.user.info.username;
            }
            onAuthSuccess();
            return true;
        } else {
            localStorage.removeItem('retro_admin_auth');
            if (overlay) overlay.classList.remove('hidden');
            if (protectedApp) protectedApp.classList.add('locked');
            if (navProfile) navProfile.style.display = 'none';
            return false;
        }
    } catch (e) {
        if (overlay) overlay.classList.remove('hidden');
        if (protectedApp) protectedApp.classList.add('locked');
        return false;
    }
}

async function performAdminLogin() {
    playSound('click');
    const input = document.getElementById('adminKeyInput');
    const statusBox = document.getElementById('authStatusBox');
    const submitBtn = document.getElementById('btnAuthSubmit');
    const overlay = document.getElementById('authGateOverlay');
    const protectedApp = document.getElementById('protectedApp');
    const navProfile = document.getElementById('navAdminProfile');

    const key = (input && input.value.trim()) || '';
    if (!key) {
        if (statusBox) {
            statusBox.className = 'auth-status-box error';
            statusBox.style.display = 'block';
            statusBox.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Lütfen KeyAuth lisans anahtarınızı girin!';
        }
        return;
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="btn-content-label"><i class="fa-solid fa-spinner fa-spin"></i> KeyAuth Doğrulanıyor...</span>';
    }
    if (statusBox) statusBox.style.display = 'none';

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key })
        });
        const data = await res.json();

        if (data.success) {
            playSound('success');
            currentAuthToken = data.token;
            localStorage.setItem('retro_admin_auth', data.token);

            if (statusBox) {
                statusBox.className = 'auth-status-box success';
                statusBox.style.display = 'block';
                statusBox.innerHTML = '<i class="fa-solid fa-circle-check"></i> Lisans Doğrulandı! Yönetim Paneli Açılıyor...';
            }

            setTimeout(() => {
                if (overlay) overlay.classList.add('hidden');
                if (protectedApp) protectedApp.classList.remove('locked');
                if (navProfile) navProfile.style.display = 'flex';
                showToast('🔑 KeyAuth ile yetkili girişi başarılı!', 'success');
                appendConsoleLog('YETKİLİ GİRİŞİ', `KeyAuth lisansı ile yetkili paneli açıldı.`, 'badge-accept');
                onAuthSuccess();
            }, 600);
        } else {
            playSound('alert');
            if (statusBox) {
                statusBox.className = 'auth-status-box error';
                statusBox.style.display = 'block';
                statusBox.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> ${escapeHtml(data.message || 'Geçersiz Lisans Anahtarı!')}`;
            }
        }
    } catch (e) {
        playSound('alert');
        if (statusBox) {
            statusBox.className = 'auth-status-box error';
            statusBox.style.display = 'block';
            statusBox.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> Sunucuyla iletişim kurulamadı!';
        }
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<span class="btn-glow-layer"></span><span class="btn-content-label"><i class="fa-solid fa-bolt"></i> Paneli Aç (Giriş Yap)</span>';
        }
    }
}

function toggleKeyVisibility() {
    const input = document.getElementById('adminKeyInput');
    const icon = document.getElementById('toggleKeyIcon');
    if (!input || !icon) return;

    if (input.type === 'password') {
        input.type = 'text';
        icon.className = 'fa-solid fa-eye-slash';
    } else {
        input.type = 'password';
        icon.className = 'fa-solid fa-eye';
    }
}

async function performAdminLogout() {
    if (!confirm('Yetkili oturumunu kapatmak istediğinize emin misiniz?')) return;
    playSound('click');

    const token = localStorage.getItem('retro_admin_auth');
    if (token) {
        try {
            await fetch('/api/auth/logout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token })
            });
        } catch (e) { }
    }

    localStorage.removeItem('retro_admin_auth');
    currentAuthToken = null;
    if (activeEventSource) {
        activeEventSource.close();
        activeEventSource = null;
    }

    const overlay = document.getElementById('authGateOverlay');
    const protectedApp = document.getElementById('protectedApp');
    const navProfile = document.getElementById('navAdminProfile');
    const input = document.getElementById('adminKeyInput');
    const statusBox = document.getElementById('authStatusBox');

    if (input) input.value = '';
    if (statusBox) statusBox.style.display = 'none';
    if (navProfile) navProfile.style.display = 'none';
    if (protectedApp) protectedApp.classList.add('locked');
    if (overlay) overlay.classList.remove('hidden');

    showToast('Oturum kapatıldı.', 'info');
}

// ================= ANTI-TAMPER SENTINEL (DOM & REVERSE-ENGINEERING WATCHDOG) =================
function initAntiTamperSentinel() {
    const observer = new MutationObserver(() => {
        if (currentAuthToken) return;

        const overlayEl = document.getElementById('authGateOverlay');
        const protectedEl = document.getElementById('protectedApp');

        if (!overlayEl || !document.body.contains(overlayEl)) {
            triggerTamperLock("Giriş kapısı DOM'dan silinmeye çalışıldı.");
            return;
        }

        const style = window.getComputedStyle(overlayEl);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || overlayEl.classList.contains('hidden')) {
            triggerTamperLock("Giriş kapısı CSS ile gizlenmeye çalışıldı.");
            return;
        }

        if (protectedEl && !protectedEl.classList.contains('locked')) {
            triggerTamperLock("Yetkisiz panel kilidi açılmaya çalışıldı.");
            return;
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden']
    });

    // Keyboard Shortcuts Interceptor
    window.addEventListener('keydown', (e) => {
        if (currentAuthToken) return;

        if (e.key === 'F12') {
            e.preventDefault();
            playSound('alert');
            showToast('⚠️ F12 Geliştirici Araçları bu ekranda engellenmiştir.', 'danger');
            return false;
        }

        if (e.ctrlKey && e.shiftKey && ['I', 'i', 'J', 'j', 'C', 'c'].includes(e.key)) {
            e.preventDefault();
            playSound('alert');
            showToast('⚠️ Geliştirici Araçları kısayolları kilitlidir.', 'danger');
            return false;
        }

        if (e.ctrlKey && (e.key === 'u' || e.key === 'U')) {
            e.preventDefault();
            playSound('alert');
            return false;
        }
    }, true);

    // Prevent context menu on login screen
    window.addEventListener('contextmenu', (e) => {
        if (!currentAuthToken) {
            e.preventDefault();
            playSound('click');
            showToast('🛡️ Retro AC Sentinel: Sağ tık menüsü kilitlidir.', 'info');
            return false;
        }
    });
}

// ================= 3D INTERACTIVE TILT FOR LOGIN CARD =================
function initCard3DTilt() {
    const card = document.getElementById('authGateCard');
    const overlay = document.getElementById('authGateOverlay');
    if (!card || !overlay) return;

    overlay.addEventListener('mousemove', (e) => {
        if (overlay.classList.contains('hidden')) return;
        const rect = card.getBoundingClientRect();
        const cardX = rect.left + rect.width / 2;
        const cardY = rect.top + rect.height / 2;
        const deltaX = (e.clientX - cardX) / (rect.width / 2);
        const deltaY = (e.clientY - cardY) / (rect.height / 2);

        // Smooth subtle 3D tilt for wide cockpit
        const rotY = Math.max(-1, Math.min(1, deltaX)) * 3.5;
        const rotX = -Math.max(-1, Math.min(1, deltaY)) * 3.5;

        card.style.transform = `perspective(1200px) rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg) scale3d(1.006, 1.006, 1.006)`;
    });

    overlay.addEventListener('mouseleave', () => {
        card.style.transform = 'perspective(1200px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
    });

    // Update Live HUD Clock
    function updateHudClock() {
        const el = document.getElementById('authHudClock');
        if (!el) return;
        const now = new Date();
        el.innerText = now.toTimeString().split(' ')[0];
    }
    setInterval(updateHudClock, 1000);
    updateHudClock();
}

// ================= WEB AUDIO API FEEDBACK CHIMES =================
let audioCtx = null;
function getAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    return audioCtx;
}

function playSound(type) {
    try {
        const ctx = getAudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        const now = ctx.currentTime;
        if (type === 'click') {
            osc.frequency.setValueAtTime(800, now);
            osc.frequency.exponentialRampToValueAtTime(400, now + 0.05);
            gain.gain.setValueAtTime(0.08, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
            osc.start(now);
            osc.stop(now + 0.05);
        } else if (type === 'success') {
            osc.frequency.setValueAtTime(523.25, now); // C5
            osc.frequency.setValueAtTime(659.25, now + 0.08); // E5
            osc.frequency.setValueAtTime(783.99, now + 0.16); // G5
            gain.gain.setValueAtTime(0.12, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
            osc.start(now);
            osc.stop(now + 0.35);
        } else if (type === 'alert') {
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(880, now);
            osc.frequency.setValueAtTime(440, now + 0.12);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
            osc.start(now);
            osc.stop(now + 0.3);
        }
    } catch (e) { }
}

// ================= TOAST NOTIFICATIONS =================
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// ================= TERMINAL ACTIVITY CONSOLE =================
function appendConsoleLog(tag, message, badgeClass = 'badge-sys') {
    const consoleBody = document.getElementById('consoleLogs');
    if (!consoleBody) return;
    const now = new Date();
    const timeStr = `[${now.toTimeString().split(' ')[0]}]`;

    const line = document.createElement('div');
    line.className = 'log-line';
    line.innerHTML = `
        <span class="log-time">${timeStr}</span>
        <span class="log-badge ${badgeClass}">[${tag}]</span>
        <span class="log-text">${escapeHtml(message)}</span>
    `;
    consoleBody.appendChild(line);
    consoleBody.scrollTop = consoleBody.scrollHeight;
}

function clearConsoleLogs() {
    const c = document.getElementById('consoleLogs');
    if (c) c.innerHTML = '';
    appendConsoleLog('SİSTEM', 'Log akışı temizlendi.');
}

// ================= API CALLS & DATA FETCHING =================
async function fetchStats() {
    try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        
        const elTotal = document.getElementById('valTotalScans');
        const elBanned = document.getElementById('valBannedScans');
        const elClean = document.getElementById('valCleanScans');
        const elDeclined = document.getElementById('valDeclinedScans');

        if (elTotal) elTotal.innerText = data.total;
        if (elBanned) elBanned.innerText = data.banned;
        if (elClean) elClean.innerText = data.clean;
        if (elDeclined) elDeclined.innerText = data.declined;

        if (data.serverIps && data.serverIps.length > 0) {
            const ip = data.serverIps[0];
            updateSuspectInstructionTemplate(ip, data.port);
        }
    } catch (e) {
        console.error('fetchStats error:', e);
    }
}

async function fetchSessions() {
    if (!currentAuthToken) return;
    try {
        const res = await authFetch('/api/sessions');
        allSessions = await res.json();
        renderSessionsTable(allSessions);
    } catch (e) {
        console.error('fetchSessions error:', e);
    }
}

// ================= PIN & SESSION CREATION =================
async function generateQuickPin() {
    playSound('click');
    const suspectInput = document.getElementById('txtSuspectName');
    const adminInput = document.getElementById('txtAdminName');

    const sName = (suspectInput && suspectInput.value.trim()) || 'Şüpheli Oyuncu';
    const aName = (adminInput && adminInput.value.trim()) || 'Admin';
    const pin = `RETRO-${Math.floor(1000 + Math.random() * 9000)}`;

    try {
        const res = await authFetch('/api/sessions/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: pin,
                suspectName: sName,
                adminName: aName
            })
        });
        await res.json();

        currentPin = pin;
        const lblPin = document.getElementById('lblCurrentPin');
        if (lblPin) lblPin.innerText = pin;

        // Auto copy PIN to clipboard
        navigator.clipboard.writeText(pin);
        playSound('success');

        showToast(`✅ Yeni PIN Oluşturuldu ve Kopyalandı: <strong>${pin}</strong> (${escapeHtml(sName)})`, 'success');
        appendConsoleLog('PIN OLUŞTURULDU', `Yeni PIN: ${pin} (${sName}) oluşturuldu ve panoya kopyalandı.`, 'badge-pin');

        fetchStats();
        fetchSessions();
    } catch (e) {
        showToast('PIN oluşturulurken hata meydana geldi!', 'danger');
    }
}

function copyCurrentPin() {
    if (currentPin && currentPin !== 'RETRO-XXXX') {
        navigator.clipboard.writeText(currentPin);
        playSound('success');
        showToast(`📋 PIN Kopyalandı: <strong>${currentPin}</strong>`, 'success');
    } else {
        generateQuickPin();
    }
}

function copySuspectInviteText() {
    const pin = currentPin !== 'RETRO-XXXX' ? currentPin : `RETRO-${Math.floor(1000 + Math.random() * 9000)}`;
    const host = window.location.hostname || '127.0.0.1';
    const port = window.location.port || '3000';

    const text = `🚨 [RETRO ROLEPLAY - ADLİ HİLE KONTROLÜ]\n\nYetkili ekibimiz tarafından adli ekran denetimi talep edilmiştir.\nLütfen RetroAC_Scanner.exe uygulamasını açarak aşağıdaki PIN kodunu girin ve [ACCESS] butonuna basın:\n\n👉 DENETİM KODUNUZ (PIN): ${pin}\n\nİndirme Linki: http://${host}:${port}/download/scanner\n(Kontrolden çıkmak veya reddetmek kalıcı sunucu uzaklaştırma sebebidir!)`;

    navigator.clipboard.writeText(text);
    playSound('success');
    showToast('📋 Şüpheliye iletilecek davet metni panoya kopyalandı!', 'success');
    appendConsoleLog('METİN KOPYALANDI', `Şüpheliye gönderilecek davet mesajı kopyalandı (PIN: ${pin}).`, 'badge-pin');
}

function updateSuspectInstructionTemplate(ip, port) {
    const host = ip || window.location.hostname || '127.0.0.1';
    const p = port || window.location.port || '3000';
    const pre = document.getElementById('preSuspectInstructions');
    if (pre) {
        pre.innerText = `1. Oyuncuya verilecek indirme linki: http://${host}:${p}/download/scanner\n2. Oyuncu uygulamayı açıp PIN'i girecek.\n3. ACCESS (Onayla) dediğinde tüm süreçler, makrolar ve BAM geçmişi burada canlı olarak listelenecektir!`;
    }
}

// ================= TABLE RENDERING =================
function renderSessionsTable(list) {
    const tbody = document.getElementById('sessionsTableBody');
    if (!tbody) return;

    if (!list || list.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-row">
                <td colspan="7">
                    <div class="empty-state">
                        <div class="empty-icon"><i class="fa-solid fa-shield-halved"></i></div>
                        <div class="empty-text">Henüz denetim kaydı bulunmuyor.</div>
                        <div class="empty-sub">Yukarıdaki "TEK TIKLA PIN OLUŞTUR" butonuyla yeni bir hile denetimi başlatın.</div>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    let html = '';
    list.forEach(s => {
        let badgeClass = 'badge-waiting';
        let badgeText = '⏳ KOD BEKLENİYOR';

        if (s.status === 'ACCEPTED') {
            badgeClass = 'badge-scanning';
            badgeText = '⚡ ONAYLADI - TARANIYOR...';
        } else if (s.status === 'DECLINED') {
            badgeClass = 'badge-declined';
            badgeText = '✖ REDDETTİ (KAÇTI)';
        } else if (s.status === 'COMPLETED') {
            if (s.verdict === 'BLACKLIST_CHEAT_DETECTED') {
                badgeClass = 'badge-blacklist';
                badgeText = '🚨 KARA LİSTE BULUNDU';
            } else if (s.riskScore >= 60) {
                badgeClass = 'badge-cheat';
                badgeText = '⚠️ HİLE BULUNDU';
            } else {
                badgeClass = 'badge-clean';
                badgeText = '✔ TEMİZ';
            }
        }

        let riskClass = 'clean';
        let riskText = `%${s.riskScore || 0}`;
        if (s.verdict === 'BLACKLIST_CHEAT_DETECTED') {
            riskClass = 'high';
            riskText = '%100 KARA LİSTE';
        } else if (s.riskScore >= 60) {
            riskClass = 'high';
            riskText = `%${s.riskScore} KRİTİK`;
        } else if (s.riskScore >= 20) {
            riskClass = 'medium';
            riskText = `%${s.riskScore} ŞÜPHELİ`;
        }

        html += `
            <tr class="clickable-row" onclick="inspectSession('${s.token}')">
                <td><span class="token-pill">${s.token}</span></td>
                <td>
                    <div class="suspect-info">
                        <span class="suspect-name">${escapeHtml(s.suspectName)}</span>
                        <span class="suspect-sub">Token: ${s.token}</span>
                    </div>
                </td>
                <td><span class="admin-name">${escapeHtml(s.adminName || 'Admin')}</span></td>
                <td><span class="status-badge-table ${badgeClass}">${badgeText}</span></td>
                <td><span class="risk-pill ${riskClass}">${riskText}</span></td>
                <td style="font-family: var(--font-mono); color: rgba(255,255,255,0.4); font-size: 11px;">${s.createdAt || '-'}</td>
                <td style="text-align: right;" onclick="event.stopPropagation()">
                    <div class="action-btns">
                        <button class="btn-inspect" onclick="inspectSession('${s.token}')">
                            <i class="fa-solid fa-magnifying-glass"></i> İncele
                        </button>
                        <button class="btn-ban" onclick="copyBanCommandFor('${s.suspectName}')">
                            <i class="fa-solid fa-gavel"></i> Ban
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
    refreshHoverTargets();
}

function filterSessionsTable() {
    const q = document.getElementById('tableSearchInput')?.value.toLowerCase().trim() || '';
    if (!q) {
        renderSessionsTable(allSessions);
        return;
    }

    const filtered = allSessions.filter(s => {
        return (s.token && s.token.toLowerCase().includes(q)) ||
               (s.suspectName && s.suspectName.toLowerCase().includes(q)) ||
               (s.status && s.status.toLowerCase().includes(q)) ||
               (s.verdict && s.verdict.toLowerCase().includes(q));
    });
    renderSessionsTable(filtered);
}

async function clearAllSessions() {
    if (!confirm("Tüm denetim geçmişini temizlemek istediğinize emin misiniz?")) return;
    try {
        await authFetch('/api/sessions', { method: 'DELETE' });
        showToast('🗑 Tüm denetim kayıtları temizlendi.', 'info');
        fetchStats();
        fetchSessions();
    } catch (e) { }
}

// ================= FORENSIC INSPECTION MODAL =================
function inspectSession(token) {
    const s = allSessions.find(item => item.token === token);
    if (!s) return;

    currentInspectedToken = token;
    currentInspectedSession = s;
    playSound('click');

    const rep = s.report;
    const elName = document.getElementById('modalSuspectName');
    const elSub = document.getElementById('modalSuspectSub');
    if (elName) elName.innerText = `${s.suspectName}`;
    if (elSub) elSub.innerText = `Token (PIN): ${s.token} • Yetkili: ${s.adminName} • Tarih: ${s.createdAt}`;

    // Risk Badge
    const riskBadge = document.getElementById('modalRiskBadge');
    const riskNum = document.getElementById('modalRiskNumber');
    const riskLbl = document.getElementById('modalRiskLabel');

    if (s.verdict === 'BLACKLIST_CHEAT_DETECTED' || s.riskScore >= 60) {
        if (riskBadge) riskBadge.className = 'modal-risk-badge high';
        if (riskNum) riskNum.innerText = `%${s.riskScore}`;
        if (riskLbl) riskLbl.innerText = s.verdict === 'BLACKLIST_CHEAT_DETECTED' ? 'KARA LİSTE TESPİT' : 'HİLE TESPİT';
    } else {
        if (riskBadge) riskBadge.className = 'modal-risk-badge';
        if (riskNum) riskNum.innerText = `%${s.riskScore}`;
        if (riskLbl) riskLbl.innerText = s.riskScore === 0 ? 'TEMİZ' : 'DÜŞÜK RİSK';
    }

    // Telemetry
    const mtaEl = document.getElementById('telemMtaStatus');
    const osEl = document.getElementById('telemOs');
    const ramEl = document.getElementById('telemRam');
    const durEl = document.getElementById('telemDuration');

    if (mtaEl) mtaEl.innerText = rep?.GameInfo?.MtaStatus || 'MTA Açık Değil';
    if (osEl) osEl.innerText = rep?.SystemInfo?.OS || '-';
    if (ramEl) ramEl.innerText = rep?.SystemInfo?.Ram || '-';
    if (durEl) durEl.innerText = rep?.ScanDuration || '-';

    // Populate Tabs
    populateDetectionsTab(rep?.Detections || []);
    populateMacrosTab(rep?.Detections || []);
    populateBamTab(rep?.BamExecutions || []);
    populateDllsTab(rep?.LoadedDlls || []);
    populateProcsTab(rep?.Processes || []);

    // Show modal
    const inspectModal = document.getElementById('inspectModal');
    if (inspectModal) inspectModal.classList.add('active');
    refreshHoverTargets();
}

function closeInspectModal() {
    const inspectModal = document.getElementById('inspectModal');
    if (inspectModal) inspectModal.classList.remove('active');
}

function switchModalTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));

    const activeBtn = Array.from(document.querySelectorAll('.tab-btn')).find(b => {
        const oc = b.getAttribute('onclick') || '';
        return oc.includes(tabId);
    });
    if (activeBtn) activeBtn.classList.add('active');
    const targetPane = document.getElementById(tabId);
    if (targetPane) targetPane.classList.add('active');
}

function populateDetectionsTab(detections) {
    const countEl = document.getElementById('countDetections');
    if (countEl) countEl.innerText = detections.length;
    const tbody = document.getElementById('modalDetectionsBody');
    if (!tbody) return;

    if (detections.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:30px; color:rgba(255,255,255,0.4);">✔ Herhangi bir zararlı tehdit veya kara liste yazılımı bulunamadı.</td></tr>';
        return;
    }

    tbody.innerHTML = detections.map(d => {
        const isBl = d.IsBlacklist || d.ThreatLevel === 'KARA LİSTE';
        const color = isBl ? '#ef4444' : (d.ThreatLevel === 'KRİTİK' ? '#f43f5e' : '#f59e0b');
        return `
            <tr style="${isBl ? 'background: rgba(239, 68, 68, 0.12);' : ''}">
                <td><strong style="color: ${color};">${escapeHtml(d.ThreatLevel)}</strong></td>
                <td style="color: var(--accent); font-weight: 700;">${escapeHtml(d.Category)}</td>
                <td>
                    <strong style="color: #ffffff;">${escapeHtml(d.Title)}</strong>
                    <div style="font-size: 11px; color: rgba(255,255,255,0.5); margin-top: 3px;">${escapeHtml(d.Description)}</div>
                </td>
                <td style="font-family: var(--font-mono); font-size: 11px; color: rgba(255,255,255,0.4); word-break: break-all;">${escapeHtml(d.FilePath || '-')}</td>
            </tr>
        `;
    }).join('');
}

function populateMacrosTab(detections) {
    const macros = (detections || []).filter(d => {
        const cat = (d.Category || '').toLowerCase();
        const title = (d.Title || '').toLowerCase();
        const desc = (d.Description || '').toLowerCase();
        return cat.includes('makro') || cat.includes('otomasyon') ||
               title.includes('makro') || title.includes('autohotkey') ||
               title.includes('clicker') || title.includes('tinytask') ||
               title.includes('sekmeme') || title.includes('c-bug') ||
               title.includes('fast deagle') || desc.includes('makro') ||
               desc.includes('autoclicker');
    });

    const countEl = document.getElementById('countMacros');
    if (countEl) countEl.innerText = macros.length;
    const tbody = document.getElementById('modalMacrosBody');
    if (!tbody) return;

    if (macros.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:30px; color:rgba(255,255,255,0.4);">✔ Herhangi bir AutoHotkey, oto-tıklayıcı veya makro scripti tespit edilmedi.</td></tr>';
        return;
    }

    tbody.innerHTML = macros.map(m => `
        <tr style="background: rgba(245, 158, 11, 0.08);">
            <td><strong style="color: #f59e0b;">${escapeHtml(m.ThreatLevel)}</strong></td>
            <td style="color: #fde68a;">${escapeHtml(m.Category)}</td>
            <td>
                <strong style="color: #ffffff;">${escapeHtml(m.Title)}</strong>
                <div style="font-size: 11px; color: rgba(255,255,255,0.5);">${escapeHtml(m.Description)}</div>
            </td>
            <td style="font-family: var(--font-mono); font-size: 11px; color: #cbd5e1; word-break: break-all;">${escapeHtml(m.FilePath || '-')}</td>
        </tr>
    `).join('');
}

function populateBamTab(bamList) {
    const countEl = document.getElementById('countBam');
    if (countEl) countEl.innerText = bamList.length;
    const tbody = document.getElementById('modalBamBody');
    if (!tbody) return;

    if (bamList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:30px; color:rgba(255,255,255,0.4);">✔ Windows BAM adli kayıtlarında silinmiş/geçmişte çalıştırılmış şüpheli hile bulunamadı.</td></tr>';
        return;
    }

    tbody.innerHTML = bamList.map(b => `
        <tr style="${b.IsBlacklisted ? 'background: rgba(239, 68, 68, 0.12);' : ''}">
            <td><strong style="color: ${b.IsBlacklisted ? '#ef4444' : '#ffffff'};">${escapeHtml(b.FileName)}</strong></td>
            <td style="font-family: var(--font-mono); font-size: 12px; color: rgba(255,255,255,0.6);">${escapeHtml(b.ExecutionTime)}</td>
            <td><span class="status-badge-table ${b.IsBlacklisted ? 'badge-blacklist' : 'badge-cheat'}">${b.IsBlacklisted ? '🚨 KARA LİSTE' : 'ŞÜPHELİ HİLE'}</span></td>
            <td style="font-family: var(--font-mono); font-size: 11px; color: rgba(255,255,255,0.4); word-break: break-all;">${escapeHtml(b.FullPath)}</td>
        </tr>
    `).join('');
}

function populateDllsTab(dllList) {
    const countEl = document.getElementById('countDlls');
    if (countEl) countEl.innerText = dllList.length;
    const tbody = document.getElementById('modalDllsBody');
    if (!tbody) return;

    if (dllList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px; color:rgba(255,255,255,0.4);">✔ MTA/GTA oyun sürecine bağlı şüpheli DLL enjeksiyonu tespit edilmedi.</td></tr>';
        return;
    }

    tbody.innerHTML = dllList.map(dll => `
        <tr style="${dll.IsSuspicious ? 'background: rgba(239, 68, 68, 0.1);' : ''}">
            <td style="color: var(--accent);">${escapeHtml(dll.ProcessName)}</td>
            <td><strong style="color: ${dll.IsSuspicious ? '#ef4444' : '#ffffff'};">${escapeHtml(dll.ModuleName)}</strong></td>
            <td><span class="status-badge-table ${dll.IsSuspicious ? 'badge-cheat' : 'badge-clean'}">${dll.IsSuspicious ? '🚨 ' + dll.ThreatLevel : 'Temiz'}</span></td>
            <td style="font-family: var(--font-mono); font-size: 11px; color: rgba(255,255,255,0.6);">${dll.Size ? (dll.Size / 1024).toFixed(1) + ' KB' : '-'}</td>
            <td style="font-family: var(--font-mono); font-size: 11px; color: rgba(255,255,255,0.4); word-break: break-all;">${escapeHtml(dll.FilePath)}</td>
        </tr>
    `).join('');
}

function populateProcsTab(procs) {
    const countEl = document.getElementById('countProcs');
    if (countEl) countEl.innerText = procs.length;
    const tbody = document.getElementById('modalProcsBody');
    if (!tbody) return;

    if (procs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px; color:rgba(255,255,255,0.4);">Süreç listesi alınamadı.</td></tr>';
        return;
    }

    tbody.innerHTML = procs.map(p => `
        <tr style="${p.IsSuspicious ? 'background: rgba(239, 68, 68, 0.1);' : ''}">
            <td style="font-family: var(--font-mono); color: rgba(255,255,255,0.5);">${p.Pid}</td>
            <td><strong style="color: ${p.IsSuspicious ? '#ef4444' : '#ffffff'};">${escapeHtml(p.ProcessName)}</strong></td>
            <td style="color: rgba(255,255,255,0.7);">${escapeHtml(p.OriginalName || '-')}</td>
            <td><span class="status-badge-table ${p.IsSuspicious ? 'badge-cheat' : 'badge-clean'}">${p.IsSuspicious ? '🚨 ' + p.SuspiciousReason : 'Normal'}</span></td>
            <td style="font-family: var(--font-mono); font-size: 11px; color: rgba(255,255,255,0.4); word-break: break-all;">${escapeHtml(p.FilePath || '-')}</td>
        </tr>
    `).join('');
}

// Ban Command Copying
function copyCurrentBanCommand() {
    if (!currentInspectedSession) return;
    const pName = currentInspectedSession.suspectName.split(' ')[0].replace(/[^a-zA-Z0-9_]/g, '');
    const cmd = `ban ${pName} Hile_Kullanimi_RetroAC`;
    navigator.clipboard.writeText(cmd);
    playSound('success');
    showToast(`🔨 MTA Ban Komutu Kopyalandı:<br><code>${cmd}</code>`, 'success');
}

function copyBanCommandFor(suspect) {
    const pName = (suspect || 'Oyuncu').split(' ')[0].replace(/[^a-zA-Z0-9_]/g, '');
    const cmd = `ban ${pName} Hile_Kullanimi_RetroAC`;
    navigator.clipboard.writeText(cmd);
    playSound('success');
    showToast(`🔨 MTA Ban Komutu Kopyalandı:<br><code>${cmd}</code>`, 'success');
}

// Export Text Report
function exportReportTxt() {
    if (!currentInspectedSession) return;
    const s = currentInspectedSession;
    const rep = s.report;

    let txt = `========================================================================\n`;
    txt += `          RETRO ROLEPLAY - ADLİ EKRAN KONTROL & HİLE RAPORU\n`;
    txt += `========================================================================\n\n`;
    txt += `Şüpheli Oyuncu: ${s.suspectName}\n`;
    txt += `Token (PIN): ${s.token}\n`;
    txt += `Sorumlu Yetkili: ${s.adminName}\n`;
    txt += `Tarih: ${s.createdAt}\n`;
    txt += `Risk Skoru: %${s.riskScore}\n`;
    txt += `Sonuç: ${s.verdictText || s.verdict}\n\n`;

    if (rep?.SystemInfo) {
        txt += `--- SİSTEM TELEMETRİSİ ---\n`;
        txt += `Bilgisayar: ${rep.SystemInfo.Hostname} (${rep.SystemInfo.Username})\n`;
        txt += `İşletim Sistemi: ${rep.SystemInfo.OS}\n`;
        txt += `RAM: ${rep.SystemInfo.Ram}\n`;
        txt += `Yerel IP: ${rep.SystemInfo.LocalIp}\n\n`;
    }

    if (rep?.Detections && rep.Detections.length > 0) {
        txt += `--- TESPİT EDİLEN TEHDİTLER (${rep.Detections.length}) ---\n`;
        rep.Detections.forEach(d => {
            txt += `[${d.ThreatLevel}] [${d.Category}] ${d.Title}\n    Açıklama: ${d.Description}\n    Konum: ${d.FilePath}\n\n`;
        });
    }

    if (rep?.BamExecutions && rep.BamExecutions.length > 0) {
        txt += `--- WINDOWS BAM ADLİ GEÇMİŞ (SİLİNMİŞ HİLELER) ---\n`;
        rep.BamExecutions.forEach(b => {
            txt += `Dosya: ${b.FileName} | Son Çalıştırma: ${b.ExecutionTime}\n    Yol: ${b.FullPath}\n\n`;
        });
    }

    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `RetroAC_Rapor_${s.token}_${pNameClean(s.suspectName)}.txt`;
    a.click();
}

function pNameClean(name) {
    return (name || 'Oyuncu').replace(/[^a-zA-Z0-9_]/g, '_');
}

// ================= MODAL CONTROLS =================
function openDiscordModal() {
    playSound('click');
    const m = document.getElementById('discordModal');
    if (m) m.classList.add('active');
}
function closeDiscordModal() {
    const m = document.getElementById('discordModal');
    if (m) m.classList.remove('active');
}

async function saveDiscordSettings() {
    const whInput = document.getElementById('txtDiscordWebhook');
    const wh = (whInput && whInput.value.trim()) || '';
    try {
        await authFetch('/api/settings/discord', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ webhook: wh })
        });
        showToast('⚙ Discord webhook ayarları kaydedildi!', 'success');
        closeDiscordModal();
    } catch (e) {
        showToast('Webhook kaydedilirken hata oluştu!', 'danger');
    }
}

function openDownloadModal() {
    playSound('click');
    const m = document.getElementById('downloadModal');
    if (m) m.classList.add('active');
}
function closeDownloadModal() {
    const m = document.getElementById('downloadModal');
    if (m) m.classList.remove('active');
}

// Close modals when clicking backdrop
window.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        e.target.classList.remove('active');
    }
});

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ================= REAL-TIME EVENT STREAM (SSE) =================
function initRealtimeEvents() {
    if (!currentAuthToken) return;
    if (activeEventSource) {
        activeEventSource.close();
        activeEventSource = null;
    }

    const evtSource = new EventSource('/api/events?token=' + encodeURIComponent(currentAuthToken));
    activeEventSource = evtSource;

    evtSource.addEventListener('session_created', (e) => {
        const s = JSON.parse(e.data);
        appendConsoleLog('PIN OLUŞTURULDU', `'${s.suspectName}' için yeni PIN oluşturuldu: ${s.token}`, 'badge-pin');
        fetchStats();
        fetchSessions();
    });

    evtSource.addEventListener('client_heartbeat', (e) => {
        const data = JSON.parse(e.data);
        if (data.status === 'ACCEPTED') {
            playSound('alert');
            showToast(`🟢 <strong>${escapeHtml(data.suspectName)}</strong> denetimi ONAYLADI! Derin tarama başladı...`, 'success');
            appendConsoleLog('ONAY VERİLDİ', `'${data.suspectName}' kontrolü ONAYLADI! (PC: ${data.hostname}\\${data.username}) Tarama başladı...`, 'badge-accept');
        } else if (data.status === 'DECLINED') {
            playSound('alert');
            showToast(`🚨 <strong>${escapeHtml(data.suspectName)}</strong> denetimi REDDETTİ!`, 'danger');
            appendConsoleLog('REDDETTİ', `'${data.suspectName}' kontrolü REDDETTİ! Kalıcı ban uygulanmalıdır.`, 'badge-danger');
        }
        fetchStats();
        fetchSessions();
    });

    evtSource.addEventListener('report_received', (e) => {
        const data = JSON.parse(e.data);
        const s = data.session;
        playSound('alert');

        if (s.verdict === 'BLACKLIST_CHEAT_DETECTED') {
            showToast(`🚨 <strong>KARA LİSTE HİLE TESPİT EDİLDİ!</strong><br>${escapeHtml(s.suspectName)} (Risk: %100)`, 'danger');
            appendConsoleLog('KARA LİSTE TESPİTİ', `🚨 '${s.suspectName}' bilgisayarında KARA LİSTE hilesi tespit edildi! (Risk: %100)`, 'badge-danger');
        } else if (s.riskScore >= 60) {
            showToast(`⚠️ <strong>Hile / Makro Tespit Edildi!</strong><br>${escapeHtml(s.suspectName)} (Risk: %${s.riskScore})`, 'danger');
            appendConsoleLog('HİLE TESPİTİ', `'${s.suspectName}' bilgisayarında hile veya makro bulundu! (Risk: %${s.riskScore})`, 'badge-danger');
        } else {
            showToast(`✔ <strong>${escapeHtml(s.suspectName)}</strong> taraması bitti: Temiz!`, 'success');
            appendConsoleLog('RAPOR GELDİ', `'${s.suspectName}' adli taraması tamamlandı: ${s.verdictText}`, 'badge-accept');
        }

        fetchStats();
        fetchSessions();

        // If currently viewing this session, live reload it!
        if (currentInspectedToken === s.token) {
            inspectSession(s.token);
        }
    });

    evtSource.addEventListener('sessions_cleared', () => {
        fetchStats();
        fetchSessions();
    });

    evtSource.onerror = () => {
        // Auto-reconnects
    };
}

// ================= CUSTOM APPLE CYBER DUAL CURSOR ENGINE =================
function initAppleCyberCursor() {
    const dot = document.getElementById('cursorDot');
    const ring = document.getElementById('cursorRing');
    if (!dot || !ring) return;

    let mouseX = window.innerWidth / 2;
    let mouseY = window.innerHeight / 2;
    let ringX = mouseX;
    let ringY = mouseY;
    let lastSparkTime = 0;

    document.addEventListener('mousemove', (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;

        dot.style.left = mouseX + 'px';
        dot.style.top = mouseY + 'px';
        dot.style.opacity = '1';
        ring.style.opacity = '1';

        // Stardust spark generator on mouse velocity
        const now = performance.now();
        if (now - lastSparkTime > 80) {
            spawnCursorSpark(mouseX, mouseY);
            lastSparkTime = now;
        }
    });

    document.addEventListener('mouseleave', () => {
        dot.style.opacity = '0';
        ring.style.opacity = '0';
    });

    document.addEventListener('mousedown', () => {
        ring.classList.add('clicking');
        playSound('click');
    });

    document.addEventListener('mouseup', () => {
        ring.classList.remove('clicking');
    });

    // Inertia spring lerp loop
    function renderCursor() {
        const ease = 0.18;
        ringX += (mouseX - ringX) * ease;
        ringY += (mouseY - ringY) * ease;

        ring.style.left = ringX.toFixed(2) + 'px';
        ring.style.top = ringY.toFixed(2) + 'px';

        requestAnimationFrame(renderCursor);
    }
    requestAnimationFrame(renderCursor);

    // Hover Target Listeners
    function attachHoverTargets() {
        document.querySelectorAll('a, button, input, .faq-q, .feature-card, .status-card, .stat-card, .switcher-btn, .ocean-table tbody tr, .pin-display-wrapper').forEach(el => {
            if (el.dataset.cursorBound) return;
            el.dataset.cursorBound = 'true';

            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                el.addEventListener('mouseenter', () => {
                    dot.classList.add('text-mode');
                    ring.classList.add('text-mode');
                });
                el.addEventListener('mouseleave', () => {
                    dot.classList.remove('text-mode');
                    ring.classList.remove('text-mode');
                });
            } else {
                el.addEventListener('mouseenter', () => {
                    ring.classList.add('hover');
                    dot.classList.add('hover');
                });
                el.addEventListener('mouseleave', () => {
                    ring.classList.remove('hover');
                    dot.classList.remove('hover');
                });
            }
        });
    }

    attachHoverTargets();
    document.addEventListener('mouseover', attachHoverTargets);
}

function spawnCursorSpark(x, y) {
    if (Math.random() > 0.45) return;
    const spark = document.createElement('div');
    spark.className = 'cursor-spark';
    const offsetX = (Math.random() - 0.5) * 16;
    const offsetY = (Math.random() - 0.5) * 16;
    spark.style.left = (x + offsetX) + 'px';
    spark.style.top = (y + offsetY) + 'px';
    document.body.appendChild(spark);
    setTimeout(() => spark.remove(), 600);
}

// ================= SCROLL PROGRESS & REVEAL =================
window.addEventListener('scroll', () => {
    const n = document.getElementById('nav');
    const p = document.getElementById('scrollProgress');
    if (n) n.classList.toggle('scrolled', window.scrollY > 50);
    if (p) {
        const docHeight = document.body.scrollHeight - window.innerHeight;
        p.style.width = docHeight > 0 ? (window.scrollY / docHeight * 100) + '%' : '0%';
    }
});

// ================= FAQ ACCORDION =================
function bindFaqEvents() {
    document.querySelectorAll('.faq-q').forEach(q => {
        q.onclick = () => {
            const item = q.parentElement;
            const isActive = item.classList.contains('active');
            document.querySelectorAll('.faq-item').forEach(e => e.classList.remove('active'));
            if (!isActive) item.classList.add('active');
        };
    });
}

// ================= INITIAL LOAD =================
window.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initAppleCyberCursor();
    initCard3DTilt();
    initAntiTamperSentinel();
    initAuth();
    bindFaqEvents();

    window.revealObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) entry.target.classList.add('visible');
        });
    }, { threshold: 0.08 });
    document.querySelectorAll('.reveal').forEach(el => window.revealObserver.observe(el));

    // Polling fallback every 6 seconds ONLY if authenticated
    setInterval(() => {
        if (currentAuthToken) {
            fetchStats();
            fetchSessions();
        }
    }, 6000);
});
