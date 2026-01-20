import { nativeAds } from './ads.js';

const API_URL = "https://y-i-t-i-o.onrender.com";
let activeSwiper = null;

const SEEN_LIMIT = 50;
const SEEN_KEY = "yitio-seen-history";
const PREMIUM_CHECK_INTERVAL = 30000;
let premiumCheckInterval = null;

// Track video states
let videoStates = new Map(); // url -> {isPlaying: bool, iframe: element, isMuted: bool}
let hasUserInteracted = false; // Track if user has touched the screen yet

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

// --- VIDEO CONTROL FUNCTIONS ---

function playVideo(iframe) {
    if (iframe && iframe.contentWindow) {
        try {
            iframe.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
            
            // If user hasn't interacted, ensure it stays muted to allow autoplay
            // If they HAVE interacted, we ensure it's unmuted.
            if (hasUserInteracted) {
                unmuteVideo(iframe);
            }

            videoStates.set(iframe.src, { ...videoStates.get(iframe.src), isPlaying: true, iframe: iframe });
            
            // Show play indicator
            showIndicator(iframe, 'play');
        } catch (e) {
            console.log("Could not play video");
        }
    }
}

function pauseVideo(iframe) {
    if (iframe && iframe.contentWindow) {
        try {
            iframe.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*');
            videoStates.set(iframe.src, { ...videoStates.get(iframe.src), isPlaying: false, iframe: iframe });
            
            // Show pause indicator
            showIndicator(iframe, 'pause');
        } catch (e) {
            console.log("Could not pause video");
        }
    }
}

function unmuteVideo(iframe) {
    if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage('{"event":"command","func":"unMute","args":""}', '*');
        iframe.contentWindow.postMessage('{"event":"command","func":"setVolume","args":[100]}', '*');
    }
}

function showIndicator(iframe, type) {
    const container = iframe.closest('.video-container');
    if (container) {
        const indicator = container.querySelector('.play-indicator');
        if (indicator) {
            indicator.classList.remove('pause', 'play');
            indicator.classList.add(type);
            // Remove class after animation to allow re-triggering
            setTimeout(() => indicator.classList.remove(type), 600); 
        }
    }
}

// Forcefully pause ALL videos in the DOM except the specific one passed
function pauseAllOthers(activeIframe) {
    const allIframes = document.querySelectorAll('.video-iframe');
    allIframes.forEach(iframe => {
        if (iframe !== activeIframe) {
            // Send pause command directly
            if (iframe.contentWindow) {
                iframe.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*');
            }
        }
    });
}

function toggleVideoPlayback(iframe) {
    if (!iframe) return;
    
    // First interaction logic: If this is the first tap, just unmute and ensure playing
    if (!hasUserInteracted) {
        hasUserInteracted = true;
        unmuteVideo(iframe);
        playVideo(iframe);
        return;
    }

    // Normal logic: Toggle play/pause
    const currentState = videoStates.get(iframe.src);
    // We assume if we don't have state, it might be playing (since we autoplay)
    if (currentState && currentState.isPlaying) {
        pauseVideo(iframe);
    } else {
        playVideo(iframe);
    }
}

// --- CORE FEED LOGIC ---
async function loadFeed() {
    const feed = document.getElementById('feed');
    
    // Only show loading if empty
    if(feed.innerHTML === "") {
        feed.innerHTML = '<div class="swiper-slide" style="display:flex; align-items:center; justify-content:center;"><h3>Loading videos...</h3></div>';
    }

    try {
        const res = await fetch(`${API_URL}/api/videos?category=YouTube`);
        let data = await res.json();

        if (data && data.length > 0) {
            const seenList = getSeenList();
            const uniqueData = data.filter(item => !seenList.includes(item.url));
            if (uniqueData.length > 0) data = uniqueData;
        }
        
        if (!data || data.length === 0) {
            // Don't overwrite if we already have videos, just return
            if(feed.querySelector('iframe')) return;
            feed.innerHTML = '<div class="swiper-slide" style="display:flex; align-items:center; justify-content:center;"><h3>No videos found</h3></div>';
            return;
        }

        const slidesHTML = data.map(item => {
            let embedUrl = item.embed_url || item.url;
            
            // FIX 1: Start with mute=1 to bypass browser autoplay restrictions.
            // We enable JS API (enablejsapi=1) to control it later.
            const params = 'autoplay=1&mute=1&enablejsapi=1&playsinline=1&controls=0&showinfo=0&modestbranding=1&rel=0';
            
            if (embedUrl.includes('?')) {
                embedUrl += `&${params}`;
            } else {
                embedUrl += `?${params}`;
            }
            
            return `
            <div class="swiper-slide">
                <div class="video-container">
                    <iframe 
                        class="video-iframe" 
                        src="${embedUrl}"
                        frameborder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowfullscreen
                        loading="lazy"
                        style="pointer-events: none;">
                    </iframe>
                    <div class="touch-overlay" onclick="handleVideoTap(this)"></div>
                    <div class="play-indicator"></div>
                </div>
            </div>
        `}).join('');

        // If it's a refill (infinite scroll), append. If first load, replace.
        if (activeSwiper && feed.querySelector('.video-iframe')) {
             activeSwiper.appendSlide(slidesHTML); // This would require parsing HTML string to nodes, simplifying for now:
             // For simplicity in this specific implementation context, we will rebuild activeSwiper or append to innerHTML
             // Since Swiper is delicate with innerHTML updates, let's just replace for now to ensure stability based on previous code
             feed.innerHTML = slidesHTML;
        } else {
             feed.innerHTML = slidesHTML;
        }

        if (activeSwiper) activeSwiper.destroy(true, true);
        
        // Initialize Swiper
        activeSwiper = new Swiper('#swiper', { 
            direction: 'vertical',
            slidesPerView: 1,
            spaceBetween: 0,
            mousewheel: true,
            speed: 400,
            // Prevent Swiper from stealing clicks on the overlay
            preventClicks: false,
            preventClicksPropagation: false,
            on: {
                reachEnd: function () {
                    // console.log("End reached, loading more...");
                    // setTimeout(() => loadFeed(), 1000); // Optional: Infinite scroll logic
                },
                slideChangeTransitionStart: function () {
                     // FIX 2: Pause EVERYTHING immediately when slide starts changing
                    const currentSlide = this.slides[this.activeIndex];
                    const currentIframe = currentSlide.querySelector('iframe');
                    pauseAllOthers(currentIframe);
                },
                slideChange: function () {
                    // Play current video
                    const currentSlide = this.slides[this.activeIndex];
                    const currentIframe = currentSlide.querySelector('iframe');
                    
                    if (currentIframe) {
                        // Ensure others are definitely paused
                        pauseAllOthers(currentIframe);
                        
                        // Play the new one
                        playVideo(currentIframe);
                        
                        if (currentIframe.src) {
                            trackSeenVideo(currentIframe.src);
                        }
                    }
                    
                    maybeShowAd();
                },
                init: function() {
                    // Play first video on load
                    const firstSlide = this.slides[0];
                    if(firstSlide) {
                        const iframe = firstSlide.querySelector('iframe');
                        if (iframe) {
                            // Ensure others paused
                            pauseAllOthers(iframe);
                            
                            if (iframe.src) trackSeenVideo(iframe.src);
                            
                            // Slight delay to ensure iframe is ready for postMessage
                            setTimeout(() => {
                                playVideo(iframe);
                            }, 500);
                        }
                    }
                }
            }
        });
        
    } catch(e) { 
        console.error("Error loading feed:", e);
        // Only show error if feed is empty
        if(feed.innerHTML === "") {
            feed.innerHTML = '<div class="swiper-slide" style="display:flex; align-items:center; justify-content:center;"><h3>Connection Error</h3></div>'; 
        }
    }
}

// Handle video tap for play/pause
function handleVideoTap(overlayElement) {
    const container = overlayElement.closest('.video-container');
    const iframe = container.querySelector('iframe');
    toggleVideoPlayback(iframe);
}

// Global listener to capture the very first interaction anywhere on the page
document.addEventListener('click', () => {
    if (!hasUserInteracted) {
        hasUserInteracted = true;
        // Find the currently active slide's iframe and unmute it
        if (activeSwiper) {
            const currentSlide = activeSwiper.slides[activeSwiper.activeIndex];
            if (currentSlide) {
                const iframe = currentSlide.querySelector('iframe');
                unmuteVideo(iframe);
            }
        }
    }
}, { once: true }); // Only run once

// --- PREMIUM VERIFICATION ---
async function verifyPremiumStatus() {
    try {
        const tg = window.Telegram.WebApp;
        const initData = tg.initData;
        
        if (!initData) {
            const isPremium = localStorage.getItem("isPremium") === "true";
            updatePremiumUI(isPremium);
            return isPremium;
        }
        
        const response = await fetch(`${API_URL}/api/user-data`, {
            headers: { 'X-Telegram-Init-Data': initData }
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
                setTimeout(() => { loadFeed(); closePremium(); }, 2000);
            }
            return true;
        }
        return false;
    } catch (error) {
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
    
    if (isPremium) hideAd();
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

async function shareBot() {
    const shareData = {
        title: 'Y.I.T',
        text: '🎬 Watch endless YouTube Shorts all in one place! No more switching between apps! 🔥',
        url: 'https://t.me/YITIO_bot'
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
    if (actionCount % 3 === 0) showAd();
    else hideAd();
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
            const botLink = `https://t.me/YITIO_bot?start=premium_${userId}`;
            tg.openLink(botLink);
            tg.close();
        } else {
            const botLink = `https://t.me/YITIO_bot?start=premium_${userId}`;
            window.open(botLink, '_blank');
        }
        statusEl.textContent = "✅ Opened Telegram. Complete purchase in chat...";
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
        statusEl.textContent = "❌ Error opening Telegram.";
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
        checkBtn.style.cssText = `background: transparent; color: #4CAF50; border: 1px solid #4CAF50; padding: 10px; width: 100%; border-radius: 8px; margin-top: 10px; cursor: pointer;`;
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
// --- TELEGRAM WEBAPP INIT ---
function initTelegramWebApp() {
    const tg = window.Telegram.WebApp;
    if (tg && tg.expand) {
        tg.expand();
        tg.enableClosingConfirmation();
    }
}

// --- INITIALIZATION ---
window.onload = async () => {
    initTelegramWebApp();
    await verifyPremiumStatus();
    
    document.getElementById('themeGrid').innerHTML = themesList.map(t => `
        <div class="theme-circle" onclick="applyTheme('${t.id}')">
            <div style="background:${t.top}"></div>
            <div style="background:${t.bottom}"></div>
        </div>
    `).join('');

    const savedTheme = localStorage.getItem("yitio-theme") || "theme-dark";
    applyTheme(savedTheme);
    loadFeed();
    addManualPremiumCheck();
};

// --- GLOBAL EXPOSURE ---
window.loadFeed = loadFeed;
window.toggleMenu = toggleMenu;
window.applyTheme = applyTheme;
window.shareBot = shareBot;
window.hideAd = hideAd;
window.openPremium = openPremium;
window.closePremium = closePremium;
window.goPremium = goPremium;
window.verifyPremiumStatus = verifyPremiumStatus;
window.handleVideoTap = handleVideoTap;

window.handleAdClick = (event) => {
    if (!event.target.classList.contains('close-ad-btn')) {
        if (typeof currentAdLink === 'function') currentAdLink();
        else if (typeof currentAdLink === "string") window.open(currentAdLink, '_blank');
        hideAd();
    }
};
