import { nativeAds } from './ads.js';

const API_URL = "https://y-i-t-i-o.onrender.com";
let activeSwiper = null;

const SEEN_LIMIT = 50;
const SEEN_KEY = "yitio-seen-history";
const PREMIUM_CHECK_INTERVAL = 30000;
let premiumCheckInterval = null;

// YouTube Player API tracking
let youtubePlayers = new Map(); // slideIndex -> YT.Player instance
let currentPlayingIndex = -1;
let hasUserInteracted = false;
let isFirstInteraction = true;

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

// --- YOUTUBE PLAYER API ---
function extractVideoId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

function loadYouTubeAPI() {
    return new Promise((resolve) => {
        if (window.YT && window.YT.Player) {
            resolve();
            return;
        }
        
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        const firstScriptTag = document.getElementsByTagName('script')[0];
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
        
        window.onYouTubeIframeAPIReady = resolve;
    });
}

function createYouTubePlayer(container, videoId, index, autoplay = false, muted = true) {
    return new Promise((resolve) => {
        const player = new YT.Player(container, {
            videoId: videoId,
            playerVars: {
                autoplay: autoplay ? 1 : 0,
                mute: muted ? 1 : 0,
                controls: 0,
                disablekb: 1,
                fs: 0,
                modestbranding: 1,
                playsinline: 1,
                rel: 0,
                showinfo: 0,
                iv_load_policy: 3
            },
            events: {
                onReady: (event) => {
                    youtubePlayers.set(index, event.target);
                    
                    // First video: autoplay muted
                    if (index === 0 && !hasUserInteracted) {
                        event.target.mute();
                        event.target.playVideo();
                    }
                    
                    resolve(event.target);
                },
                onStateChange: (event) => {
                    // Track playing state
                    if (event.data === YT.PlayerState.PLAYING && index === currentPlayingIndex) {
                        // If this is first interaction and we're playing first video
                        if (isFirstInteraction && index === 0) {
                            // First tap will unmute
                        }
                    }
                }
            }
        });
    });
}

// --- VIDEO CONTROL FUNCTIONS ---
function playVideo(index) {
    if (currentPlayingIndex !== -1 && currentPlayingIndex !== index) {
        pauseVideo(currentPlayingIndex);
    }
    
    const player = youtubePlayers.get(index);
    if (player) {
        // First interaction: unmute if needed
        if (isFirstInteraction && index === 0 && hasUserInteracted) {
            player.unMute();
            isFirstInteraction = false;
        }
        
        player.playVideo();
        currentPlayingIndex = index;
        
        // Show play indicator
        const slide = activeSwiper.slides[index];
        if (slide) {
            const indicator = slide.querySelector('.play-indicator');
            if (indicator) {
                indicator.classList.remove('pause');
                indicator.classList.add('play');
                setTimeout(() => indicator.classList.remove('play'), 1000);
            }
        }
    }
}

function pauseVideo(index) {
    const player = youtubePlayers.get(index);
    if (player) {
        player.pauseVideo();
        
        // Show pause indicator
        const slide = activeSwiper.slides[index];
        if (slide) {
            const indicator = slide.querySelector('.play-indicator');
            if (indicator) {
                indicator.classList.remove('play');
                indicator.classList.add('pause');
                setTimeout(() => indicator.classList.remove('pause'), 1000);
            }
        }
    }
}

function toggleVideoPlayback(index) {
    const player = youtubePlayers.get(index);
    if (!player) return;
    
    // First user interaction
    if (!hasUserInteracted) {
        hasUserInteracted = true;
        player.unMute();
        isFirstInteraction = false;
    }
    
    const state = player.getPlayerState();
    if (state === YT.PlayerState.PLAYING) {
        pauseVideo(index);
    } else {
        playVideo(index);
    }
}

// --- CORE FEED LOGIC ---
async function loadFeed() {
    const feed = document.getElementById('feed');
    
    feed.innerHTML = '<div class="swiper-slide" style="display:flex; align-items:center; justify-content:center;"><h3>Loading videos...</h3></div>';

    try {
        const res = await fetch(`${API_URL}/api/videos?category=YouTube`);
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

        // Clear existing players
        youtubePlayers.clear();
        currentPlayingIndex = -1;
        
        // Create slide HTML without iframes - we'll add players after
        feed.innerHTML = data.map((item, index) => {
            const videoId = extractVideoId(item.url);
            return `
            <div class="swiper-slide">
                <div class="video-container" data-video-id="${videoId}" data-index="${index}">
                    <!-- YouTube player will be inserted here -->
                    <div id="player-${index}" class="youtube-player"></div>
                    
                    <!-- Touch overlay -->
                    <div class="touch-overlay" onclick="handleVideoTap(this)"></div>
                    
                    <!-- Play/Pause indicator -->
                    <div class="play-indicator"></div>
                    
                    <!-- Platform badge -->
                    <div class="platform-badge youtube-badge">YouTube</div>
                </div>
            </div>
            `;
        }).join('');

        // Destroy old swiper
        if (activeSwiper) {
            activeSwiper.destroy(true, true);
        }
        
        // Wait for YouTube API to load
        await loadYouTubeAPI();
        
        // Initialize Swiper first
        activeSwiper = new Swiper('#swiper', { 
            direction: 'vertical',
            slidesPerView: 1,
            spaceBetween: 0,
            mousewheel: {
                forceToAxis: true,
                sensitivity: 1,
                releaseOnEdges: true
            },
            touchRatio: 1,
            resistanceRatio: 0,
            speed: 400,
            followFinger: true,
            grabCursor: true,
            allowTouchMove: true,
            simulateTouch: true,
            shortSwipes: true,
            longSwipes: true,
            longSwipesRatio: 0.5,
            longSwipesMs: 300,
            threshold: 5,
            preventInteractionOnTransition: true,
            on: {
                reachEnd: function () {
                    setTimeout(() => loadFeed(), 1000);
                },
                slideChange: function () {
                    const newIndex = this.activeIndex;
                    const oldIndex = currentPlayingIndex;
                    
                    // Pause previous video
                    if (oldIndex !== -1 && oldIndex !== newIndex) {
                        pauseVideo(oldIndex);
                    }
                    
                    // Play new video
                    playVideo(newIndex);
                    
                    // Track seen
                    const slide = this.slides[newIndex];
                    const videoContainer = slide.querySelector('.video-container');
                    const videoId = videoContainer?.dataset.videoId;
                    if (videoId) {
                        trackSeenVideo(`https://youtube.com/watch?v=${videoId}`);
                    }
                    
                    maybeShowAd();
                },
                init: function() {
                    // Initialize YouTube players for first 3 slides
                    setTimeout(() => {
                        const slidesToInit = Math.min(3, this.slides.length);
                        for (let i = 0; i < slidesToInit; i++) {
                            initPlayerForSlide(i);
                        }
                        
                        // Play first video after initialization
                        setTimeout(() => {
                            playVideo(0);
                        }, 500);
                    }, 100);
                },
                slideChangeTransitionStart: function() {
                    // Initialize player for upcoming slide if not already done
                    const nextIndex = this.activeIndex + 1;
                    if (nextIndex < this.slides.length && !youtubePlayers.has(nextIndex)) {
                        initPlayerForSlide(nextIndex);
                    }
                }
            }
        });
        
    } catch(e) { 
        console.error("Error loading feed:", e);
        feed.innerHTML = '<div class="swiper-slide" style="display:flex; align-items:center; justify-content:center;"><h3>Connection Error</h3></div>'; 
    }
}

async function initPlayerForSlide(index) {
    const slide = activeSwiper.slides[index];
    if (!slide) return;
    
    const container = slide.querySelector('.video-container');
    const videoId = container?.dataset.videoId;
    const playerDiv = slide.querySelector(`#player-${index}`);
    
    if (!videoId || !playerDiv || youtubePlayers.has(index)) return;
    
    try {
        // First video: muted autoplay, others: no autoplay
        const autoplay = (index === 0 && !hasUserInteracted);
        const muted = (index === 0 && !hasUserInteracted);
        
        await createYouTubePlayer(playerDiv, videoId, index, autoplay, muted);
    } catch (error) {
        console.error(`Failed to create player for slide ${index}:`, error);
    }
}

// Handle video tap for play/pause
function handleVideoTap(overlayElement) {
    const container = overlayElement.closest('.video-container');
    const index = parseInt(container?.dataset.index);
    
    if (!isNaN(index)) {
        // Initialize player if not already done
        if (!youtubePlayers.has(index)) {
            initPlayerForSlide(index).then(() => {
                toggleVideoPlayback(index);
            });
        } else {
            toggleVideoPlayback(index);
        }
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
                    loadFeed();
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
            const botLink = `https://t.me/YITIO_bot?start=premium_${userId}`;
            tg.openLink(botLink);
            tg.close();
        } else {
            const botLink = `https://t.me/YITIO_bot?start=premium_${userId}`;
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
            console.log("Y.I.T User ID:", user.id);
        }
    }
}

// Cleanup function
function cleanupPlayers() {
    youtubePlayers.forEach((player, index) => {
        if (player.destroy) player.destroy();
    });
    youtubePlayers.clear();
    currentPlayingIndex = -1;
}

// --- INITIALIZATION ---
window.onload = async () => {
    initTelegramWebApp();
    
    await verifyPremiumStatus();
    
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
    
    // Reset interaction state
    hasUserInteracted = false;
    isFirstInteraction = true;
    
    loadFeed();
    
    addManualPremiumCheck();
};

// Cleanup on page unload
window.addEventListener('beforeunload', cleanupPlayers);

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
window.cleanupPlayers = cleanupPlayers;

window.handleAdClick = (event) => {
    if (!event.target.classList.contains('close-ad-btn')) {
        if (typeof currentAdLink === 'function') currentAdLink();
        else if (typeof currentAdLink === "string") window.open(currentAdLink, '_blank');
        hideAd();
    }
};
