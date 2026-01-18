import { nativeAds } from './ads.js';

const API_URL = "https://y-i-t-i-o.onrender.com"; // Change to your Render URL
let activeSwiper = null;
let currentCategory = "All";

const SEEN_LIMIT = 50;
const SEEN_KEY = "yitio-seen-history";
const PREMIUM_CHECK_INTERVAL = 30000; // 30 seconds
let premiumCheckInterval = null;
let isMuted = true; // Start muted by default

// --- HISTORY TRACKING ---
function getSeenList() {
    try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"); } 
    catch { return []; }
}

function trackSeenVideo(url) {
    let seen = getSeenList();
    seen = seen.filter(u => u !== url);
    seen.push(url);
    if (seen.length > SEEN_LIMIT) seen.shift();
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
}

// --- THEME CONFIG ---
const themesList = [
    {id: "theme-dark",  top: "#000", bottom: "#000"},
    {id: "theme-blue",  top: "#001f3f", bottom: "#003366"},
    {id: "theme-purple", top: "#2d004d", bottom: "#3d0066"},
    {id: "theme-green", top: "#003300", bottom: "#004d00"},
    {id: "theme-red",   top: "#330000", bottom: "#4d0000"},
    {id: "theme-amber", top: "#332100", bottom: "#4d3000"}
];

// --- VIDEO LOGIC ---
function getPlatformClass(platform) {
    switch(platform) {
        case 'YouTube': return 'youtube-badge';
        case 'Facebook': return 'facebook-badge';
        case 'Instagram': return 'instagram-badge';
        default: return '';
    }
}

// --- CORE FEED LOGIC ---
async function loadFeed(cat) {
    currentCategory = cat;
    const feed = document.getElementById('feed');
    
    feed.innerHTML = '<div class="swiper-slide" style="display:flex; align-items:center; justify-content:center;"><h3>Loading videos...</h3></div>';
    
    // Update active category button
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('active', b.innerText === cat));

    try {
        const res = await fetch(`${API_URL}/api/videos?category=${encodeURIComponent(cat)}`);
        let data = await res.json();

        if (data && data.length > 0) {
            const seenList = getSeenList();
            const uniqueData = data.filter(item => !seenList.includes(item.url));
            if (uniqueData.length > 0) data = uniqueData;
        }
        
        if (!data || data.length === 0) {
            feed.innerHTML = '<div class="swiper-slide" style="display:flex; align-items:center; justify-content:center;"><h3>No videos found</h3></div>';
            return;
        }

        feed.innerHTML = data.map(item => {
            // Add autoplay parameter to URL
            let embedUrl = item.embed_url || item.url;
            if (embedUrl.includes('?')) {
                embedUrl += '&autoplay=1';
            } else {
                embedUrl += '?autoplay=1';
            }
            
            return `
            <div class="swiper-slide">
                <div class="video-container">
                    <iframe 
                        class="video-iframe" 
                        src="${embedUrl}&mute=${isMuted ? 1 : 0}"
                        frameborder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowfullscreen
                        loading="lazy"
                        autoplay>
                    </iframe>
                    <div class="platform-badge ${getPlatformClass(item.platform)}">
                        ${item.platform}
                    </div>
                </div>
            </div>
        `}).join('');

        if (activeSwiper) activeSwiper.destroy(true, true);
        activeSwiper = new Swiper('#swiper', { 
            direction: 'vertical', 
            mousewheel: true,
            on: {
                reachEnd: function () {
                    setTimeout(() => loadFeed(currentCategory), 1000);
                },
                slideChange: function () {
                    const activeSlide = this.slides[this.activeIndex];
                    const iframe = activeSlide.querySelector('iframe');
                    if (iframe && iframe.src) trackSeenVideo(iframe.src);
                    maybeShowAd(); 
                },
                init: function() {
                    const activeSlide = this.slides[this.activeIndex];
                    if(activeSlide) {
                        const iframe = activeSlide.querySelector('iframe');
                        if (iframe && iframe.src) trackSeenVideo(iframe.src);
                    }
                }
            }
        });
        
    } catch(e) { 
        console.error("Error loading feed:", e);
        feed.innerHTML = '<div class="swiper-slide" style="display:flex; align-items:center; justify-content:center;"><h3>Connection Error</h3></div>'; 
    }
}

// --- PREMIUM VERIFICATION ---
async function verifyPremiumStatus() {
    try {
        const tg = window.Telegram.WebApp;
        const initData = tg.initData;
        
        if (!initData) {
            console.log("No initData available, using localStorage");
            const isPremium = localStorage.getItem("isPremium") === "true";
            updatePremiumUI(isPremium);
            return isPremium;
        }
        
        const response = await fetch(`${API_URL}/api/user-data`, {
            headers: {
                'X-Telegram-Init-Data': initData
            }
        });
        
        const data = await response.json();
        
        if (data.premium) {
            localStorage.setItem("isPremium", "true");
            localStorage.setItem("premiumExpires", data.expires_at);
            updatePremiumUI(true);
            stopPremiumChecking();
            return true;
        } else {
            localStorage.removeItem("isPremium");
            localStorage.removeItem("premiumExpires");
            updatePremiumUI(false);
            return false;
        }
    } catch (error) {
        console.log("Error verifying premium:", error);
        const isPremium = localStorage.getItem("isPremium") === "true";
        updatePremiumUI(isPremium);
        return isPremium;
    }
}

function startPremiumChecking(userId) {
    stopPremiumChecking();
    
    checkPremiumStatus(userId);
    
    premiumCheckInterval = setInterval(() => {
        checkPremiumStatus(userId);
    }, PREMIUM_CHECK_INTERVAL);
}

function stopPremiumChecking() {
    if (premiumCheckInterval) {
        clearInterval(premiumCheckInterval);
        premiumCheckInterval = null;
    }
}

async function checkPremiumStatus(userId) {
    try {
        const response = await fetch(`${API_URL}/api/check-premium?user_id=${userId}`);
        const data = await response.json();
        
        if (data.is_premium) {
            localStorage.setItem("isPremium", "true");
            localStorage.setItem("premiumExpires", data.expires_at);
            updatePremiumUI(true);
            stopPremiumChecking();
            
            const statusEl = document.getElementById('paymentStatus');
            if (statusEl) {
                statusEl.textContent = "✅ Premium activated! Refreshing...";
                statusEl.style.color = "#4CAF50";
                
                setTimeout(() => {
                    loadFeed(currentCategory);
                    closePremium();
                }, 2000);
            }
            
            return true;
        }
        return false;
    } catch (error) {
        console.log("Error checking premium status:", error);
        return false;
    }
}

function updatePremiumUI(isPremium) {
    const premiumBtn = document.querySelector('.premium-btn-menu');
    if (premiumBtn) {
        if (isPremium) {
            premiumBtn.innerText = "⭐ PREMIUM ACTIVE";
            premiumBtn.style.background = "#4CAF50";
            premiumBtn.style.color = "white";
            premiumBtn.disabled = true;
            premiumBtn.onclick = null;
        } else {
            premiumBtn.innerText = "UPGRADE NOW";
            premiumBtn.style.background = "white";
            premiumBtn.style.color = "#ff4757";
            premiumBtn.disabled = false;
            premiumBtn.onclick = openPremium;
        }
    }
    
    const buyBtn = document.getElementById('btnBuy');
    if (buyBtn) {
        if (isPremium) {
            buyBtn.innerText = "⭐ PREMIUM ACTIVE";
            buyBtn.style.background = "#4CAF50";
            buyBtn.disabled = true;
        } else {
            buyBtn.innerText = "Go Premium";
            buyBtn.style.background = "#ffd700";
            buyBtn.disabled = false;
        }
    }
    
    const indicator = document.getElementById('premiumIndicator');
    if (indicator) {
        indicator.style.display = isPremium ? 'block' : 'none';
    }
    
    if (isPremium) {
        hideAd();
    }
}

// --- UI & THEME FUNCTIONS ---
function toggleMenu() { 
    document.getElementById('menuPanel').classList.toggle('open'); 
}

function applyTheme(themeId) {
    themesList.forEach(t => document.body.classList.remove(t.id));
    if(themeId !== "theme-dark") document.body.classList.add(themeId);
    localStorage.setItem("yitio-theme", themeId);
}

function toggleMute() {
    isMuted = !isMuted;
    
    // Update mute button icon
    const muteBtn = document.querySelector('.top-bar button:last-child');
    if (muteBtn) {
        muteBtn.textContent = isMuted ? '🔇' : '🔊';
    }
    
    // Update all iframes
    const iframes = document.querySelectorAll('.video-iframe');
    iframes.forEach(iframe => {
        const src = iframe.src;
        // Update mute parameter in URL
        if (src.includes('mute=')) {
            const newSrc = src.replace(/mute=[0-1]/, `mute=${isMuted ? 1 : 0}`);
            iframe.src = newSrc;
        } else if (src.includes('?')) {
            iframe.src = src + `&mute=${isMuted ? 1 : 0}`;
        } else {
            iframe.src = src + `?mute=${isMuted ? 1 : 0}`;
        }
    });
}

async function shareBot() {
    const shareData = {
        title: 'Y.I.F.I.O',
        text: '🎬 Watch endless YouTube Shorts, Facebook, and Instagram Reels all in one place! No more switching between apps! 🔥',
        url: 'https://t.me/YIFIO_bot'
    };
    try {
        if (navigator.share) {
            await navigator.share(shareData);
        } else {
            await navigator.clipboard.writeText(`${shareData.text} ${shareData.url}`);
            alert('Link & Text copied to clipboard!');
        }
    } catch (err) { console.log('Error sharing:', err); }
}

// --- ADS LOGIC ---
let adIndex = Number(localStorage.getItem("adIndex") || 0);
let currentAdLink = null;
let actionCount = Number(localStorage.getItem("actionCount") || 0);

function getNextAd() {
    const ad = nativeAds[adIndex % nativeAds.length];
    adIndex++;
    localStorage.setItem("adIndex", adIndex);
    return ad;
}

function showAd() {
    const isPremium = localStorage.getItem("isPremium") === "true";
    if (isPremium) return;
    
    const ad = getNextAd();
    if (!ad) return;
    currentAdLink = ad.action; 
    document.getElementById("adImage").src = ad.image;
    document.getElementById("adTitle").innerText = ad.title;
    document.getElementById("adSubtitle").innerText = ad.subtitle;
    document.getElementById("nativeAd").classList.remove("hidden");
}

function hideAd(event) {
    if (event) event.stopPropagation(); 
    document.getElementById("nativeAd").classList.add("hidden");
}

function maybeShowAd() {
    const isPremium = localStorage.getItem("isPremium") === "true";
    if (isPremium) {
        hideAd();
        return;
    }
    
    actionCount++;
    localStorage.setItem("actionCount", actionCount);
    if (actionCount % 3 === 0) {
        showAd();
    } else {
        hideAd();
    }
}

// --- PREMIUM MODAL FUNCTIONS ---
function openPremium() {
    document.getElementById('menuPanel').classList.remove('open');
    document.getElementById('premiumModal').classList.add('active');
}

function closePremium() {
    document.getElementById('premiumModal').classList.remove('active');
}

async function goPremium() {
    console.log("Starting premium purchase flow...");
    const tg = window.Telegram.WebApp;
    const btn = document.getElementById('btnBuy');
    const statusEl = document.getElementById('paymentStatus');
    
    const userId = tg.initDataUnsafe?.user?.id;
    
    if (!userId) {
        statusEl.textContent = "❌ Please open in Telegram app to purchase";
        statusEl.style.color = "#ff4444";
        return;
    }
    
    btn.innerText = "Opening Telegram...";
    btn.disabled = true;
    statusEl.textContent = "Opening Telegram for payment...";
    statusEl.style.color = "#ffd700";
    
    try {
        if (tg.openLink) {
            const botLink = `https://t.me/YIFIO_bot?start=premium_${userId}`;
            tg.openLink(botLink);
            tg.close();
        } else {
            const botLink = `https://t.me/YIFIO_bot?start=premium_${userId}`;
            window.open(botLink, '_blank');
        }
        
        statusEl.textContent = "✅ Opened Telegram. Complete purchase in chat, then return here...";
        
        startPremiumChecking(userId);
        
        setTimeout(() => {
            stopPremiumChecking();
            if (localStorage.getItem("isPremium") !== "true") {
                statusEl.textContent = "❌ Purchase timeout. Please try again.";
                btn.innerText = "Go Premium";
                btn.disabled = false;
            }
        }, 600000);
        
    } catch (error) {
        console.error("Error opening Telegram:", error);
        statusEl.textContent = "❌ Error opening Telegram. Please try again.";
        btn.innerText = "Go Premium";
        btn.disabled = false;
    }
}

function addManualPremiumCheck() {
    const premiumCard = document.querySelector('.premium-card');
    if (premiumCard) {
        const checkBtn = document.createElement('button');
        checkBtn.className = 'btn-check';
        checkBtn.innerHTML = '🔄 Check Premium Status';
        checkBtn.style.cssText = `
            background: transparent;
            color: #4CAF50;
            border: 1px solid #4CAF50;
            padding: 10px;
            width: 100%;
            border-radius: 8px;
            margin-top: 10px;
            cursor: pointer;
        `;
        checkBtn.onclick = async () => {
            const statusEl = document.getElementById('paymentStatus');
            statusEl.textContent = "Checking status...";
            statusEl.style.color = "#ffd700";
            
            const verified = await verifyPremiumStatus();
            if (verified) {
                statusEl.textContent = "✅ Premium is active!";
                statusEl.style.color = "#4CAF50";
            } else {
                statusEl.textContent = "❌ No active premium found";
                statusEl.style.color = "#ff4444";
            }
        };
        
        premiumCard.appendChild(checkBtn);
    }
}

// --- TELEGRAM WEBAPP INIT ---
function initTelegramWebApp() {
    const tg = window.Telegram.WebApp;
    if (tg && tg.expand) {
        tg.expand();
        tg.enableClosingConfirmation();
        
        const user = tg.initDataUnsafe?.user;
        if (user) {
            console.log("Y.I.F.I.O User ID:", user.id);
        }
    }
}

// --- INITIALIZATION ---
window.onload = async () => {
    initTelegramWebApp();
    
    await verifyPremiumStatus();
    
    // Setup Categories
    const categories = ["All", "YouTube", "Facebook", "Instagram"];
    document.getElementById('catBar').innerHTML = categories.map(c => 
        `<button class="cat-btn" onclick="loadFeed('${c}')">${c}</button>`
    ).join('');
    
    // Setup Themes
    document.getElementById('themeGrid').innerHTML = themesList.map(t => `
        <div class="theme-circle" onclick="applyTheme('${t.id}')">
            <div style="background:${t.top}"></div>
            <div style="background:${t.bottom}"></div>
        </div>
    `).join('');

    // Load Saved Theme & Initial Feed
    const savedTheme = localStorage.getItem("yitio-theme") || "theme-dark";
    applyTheme(savedTheme);
    loadFeed("All");
    
    addManualPremiumCheck();
};

// --- GLOBAL EXPOSURE ---
window.loadFeed = loadFeed;
window.toggleMenu = toggleMenu;
window.toggleMute = toggleMute;
window.applyTheme = applyTheme;
window.shareBot = shareBot;
window.hideAd = hideAd;
window.openPremium = openPremium;
window.closePremium = closePremium;
window.goPremium = goPremium;
window.verifyPremiumStatus = verifyPremiumStatus;

window.handleAdClick = (event) => {
    if (!event.target.classList.contains('close-ad-btn')) {
        if (typeof currentAdLink === 'function') currentAdLink();
        else if (typeof currentAdLink === "string") window.open(currentAdLink, '_blank');
        hideAd();
    }
};
