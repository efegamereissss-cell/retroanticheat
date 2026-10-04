# 🛡️ Retro Roleplay Anti-Cheat — Ocean Edition

> **MTA:SA 1.6 Adli Ekran Denetimi & Hile Tespit Platformu**  
> Ocean Anti-Cheat mimarisinden esinlenilmiş, Vercel Serverless ve Node.js altyapısı ile çalışan üst düzey web yönetim paneli ve C# adli tarayıcı istemcisi.

---

## 🚀 Özellikler

* **Overlord Cyber Dark Arayüzü:** Crimson Red, Apple Violet ve Cyber Cyan olmak üzere 3 farklı neon tema.
* **MTA Ana Menü Arka Planı:** Orijinal Multi Theft Auto atmosferini yaşatan sinematik hero bölümü.
* **Tek Tıkla PIN Oluşturma:** Yetkili tek tuşla `RETRO-XXXX` PIN'i oluşturur, panoya kopyalar ve oyuncuya gönderilecek davet mesajını otomatik hazırlar.
* **C# Native İstemci (`RetroAC_Scanner.exe`):** Kurulum gerektirmeyen standalone adli tarayıcı. Vercel sunucusuna HTTPS üzerinden anında bağlanır.
* **Derin Adli Tarama Motoru:**
  * **Kara Liste Tespiti:** `Nexida.exe`, `justicescales.exe`, `storksoftware.exe`, `lnixsoftware.exe`, `lnix.exe`, `mtasacheat.exe`, `cheatmta.exe`, `mtasancheat.exe` vb.
  * **Windows BAM (Background Activity Moderator):** Oyuncunun kontrol öncesi sildiği programların Windows kayıt defterindeki saat/tarih damgalarını yakalar!
  * **Makro & Otomasyon Radarı:** AutoHotkey, TinyTask, OPAutoClicker, Sekmeme scriptleri ve pencere başlıkları.
  * **Oyun Modülleri & DLL Kancaları:** MTA ve GTA SA kök dizinindeki yetkisiz modüller ve enjeksiyonlar.
  * **Çalışan Süreçler & Orijinal PE İsimleri:** İsmi değiştirilmiş (svchost, discord vb.) hileleri PE başlığından yakalar.
* **5 Sekmeli Adli Denetim Penceresi:** Risk skoru, sistem telemetrisi ve detaylı bulgu listeleri.
* **Tek Tıkla MTA Ban Komutu:** `ban [Oyuncu] Hile_Kullanimi_RetroAC` komutunu doğrudan panoya kopyalar.
* **Adli Rapor İndirme (.txt):** Tüm kanıtları tek tıkla resmi yetkili raporu olarak kaydeder.

---

## ⚡ Vercel'e Dağıtım (Deployment)

1. Bu depoyu GitHub hesabınıza aktarın (`https://github.com/efagamereissss-cell/retroanticheat.git`).
2. [Vercel](https://vercel.com) paneline gidin ve **Add New Project** diyerek `retroanticheat` deposunu seçin.
3. Framework Preset: **Other** olarak bırakın.
4. **Deploy** butonuna tıklayın!
5. Siteniz saniyeler içinde `https://retroanticheat.vercel.app` (veya size atanan domain) üzerinden 7/24 yayına girecektir!

---

## 💻 Yerel Olarak Çalıştırma

```bash
# Projeyi başlatın
node server.js

# Veya Windows üzerinde hazır batch dosyasını çalıştırın:
BASLAT_WEB_PANEL.bat
```

Panel varsayılan olarak `http://localhost:3000` üzerinden açılır.

---

© 2026 Retro Roleplay. All rights reserved.
