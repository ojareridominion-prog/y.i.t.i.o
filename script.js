import { nativeAds } from './ads.js';

const API_URL = "https://y-i-t-i-o.onrender.com";
let activeSwiper = null;

const SEEN_LIMIT = 50;
const SEEN_KEY = "yitio-seen-history";
const PREMIUM_CHECK_INTERVAL = 30000;
let premiumCheckInterval = null;

// Track video states
let videoStates = new Map(); // url -> {isPlaying: bool, iframe: element, player: null}
let userHasInteracted = false;
let isFirstLoad = true;

// --- GHOST CLICK FOR INITIAL INTERACTION ---
function triggerInitialInteraction() {
    if (!userHasInteracted) {
        console.log("Triggering initial interaction...");
        userHasInteracted = true;
        
        // Create a synthetic click event
        const event = new MouseEvent('click', {
            view: window,
            bubbles: true,
            cancelable: true
        });
        
        // Dispatch on document
        document.dispatchEvent(event);
        
        // Also trigger on body
        document.body.click();
        
        // Play current video if exists
        if (activeSwiper) {
            const currentSlide = activeSwiper.slides[activeSwiper.activeIndex];
            const iframe = currentSlide?.querySelector('iframe');
            if (iframe) {
                playVideo(iframe);
            }
        }
    }
}

// Trigger ghost click after a short delay on page load
setTimeout(triggerInitialInteraction, 1000);

// Also trigger on any user interaction
document.addEventListener('click', () => {
    if (!userHasInteracted) {
        userHasInteracted = true;
        console.log("User interacted, enabling autoplay");
    }
});

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
    if (!iframe) return;
    
    const currentState = videoStates.get(iframe.src);
    if (currentState && currentState.isPlaying) return;
    
    try {
        // Send play command
        iframe.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
        
        // Update state
        videoStates.set(iframe.src, {
            isPlaying: true, 
            iframe: iframe,
            isMuted: iframe.src.includes('mute=1')
        });
        
        // Show play indicator
        const container = iframe.closest('.video-container');
        if (container) {
            const indicator = container.querySelector('.play-indicator');
            if (indicator) {
                indicator.classList.remove('pause');
                indicator.classList.add('play');
                setTimeout(() => indicator.classList.remove('play'), 1000);
            }
        }
        
        console.log("Playing video:", iframe.src);
    } catch (e) {
        console.log("Could not play video:", e);
    }
}

function pauseVideo(iframe) {
    if (!iframe) return;
    
    try {
        // Send pause command
        iframe.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*');
        
        // Update state
        videoStates.set(iframe.src, {
            isPlaying: false, 
            iframe: iframe,
            isMuted: iframe.src.includes('mute=1')
        });
        
        // Show pause indicator
        const container = iframe.closest('.video-container');
        if (container) {
            const indicator = container.querySelector('.play-indicator');
            if (indicator) {
                indicator.classList.remove('play');
                indicator.classList.add('pause');
                setTimeout(() => indicator.classList.remove('pause'), 1000);
            }
        }
        
        console.log("Paused video:", iframe.src);
    } catch (e) {
        console.log("Could not pause video:", e);
    }
}

function stopAllVideos() {
    console.log("Stopping all videos...");
    
    // Stop all iframes in the document
    document.querySelectorAll('iframe.video-iframe').forEach(iframe => {
        if (iframe && iframe.contentWindow) {
            try {
                // Stop the video
                iframe.contentWindow.postMessage('{"event":"command","func":"stopVideo","args":""}', '*');
                
                // Also pause just in case
                iframe.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*');
                
                videoStates.set(iframe.src, {
                    isPlaying: false,
                    iframe: iframe,
                    isMuted: true
                });
            } catch (e) {
                console.log("Error stopping video:", e);
            }
        }
    });
}

function toggleVideoPlayback(iframe) {
    if (!iframe) return;
    
    const currentState = videoStates.get(iframe.src);
    if (currentState && currentState.isPlaying) {
        pauseVideo(iframe);
    } else {
        playVideo(iframe);
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

        // Stop all existing videos before loading new ones
        stopAllVideos();
        
        feed.innerHTML = data.map(item => {
            let embedUrl = item.embed_url || item.url;
            
            // CRITICAL: Start with muted autoplay for browser compliance
            // We'll unmute only the active video
            if (embedUrl.includes('?')) {
                embedUrl += '&autoplay=1&mute=1&playsinline=1&controls=0&showinfo=0&modestbranding=1&enablejsapi=1&rel=0';
            } else {
                embedUrl += '?autoplay=1&mute=1&playsinline=1&controls=0&showinfo=0&modestbranding=1&enablejsapi=1&rel=0';
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
                        allow="autoplay *; fullscreen *"
                        style="pointer-events: none;">
                    </iframe>
                    <!-- Touch overlay - captures all touches -->
                    <div class="touch-overlay" onclick="handleVideoTap(this)"></div>
                    <!-- Play/Pause indicator -->
                    <div class="play-indicator"></div>
                </div>
            </div>
        `}).join('');

        if (activeSwiper) activeSwiper.destroy(true, true);
        
        // Initialize Swiper with fixed touch handling
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
            // IMPORTANT: Prevent iframe from capturing touch
            preventInteractionOnTransition: true,
            on: {
                reachEnd: function () {
                    setTimeout(() => loadFeed(), 1000);
                },
                slideChangeTransitionStart: function () {
                    // Pause previous video BEFORE transition
                    const prevSlide = this.slides[this.previousIndex];
                    if (prevSlide) {
                        const prevIframe = prevSlide.querySelector('iframe');
                        if (prevIframe) {
                            pauseVideo(prevIframe);
                        }
                    }
                },
                slideChangeTransitionEnd: function () {
                    // Play new video AFTER transition
                    const currentSlide = this.slides[this.activeIndex];
                    if (currentSlide) {
                        const currentIframe = currentSlide.querySelector('iframe');
                        if (currentIframe) {
                            // Unmute and play the current video
                            unmuteVideo(currentIframe);
                            playVideo(currentIframe);
                            trackSeenVideo(currentIframe.src);
                        }
                    }
                    
                    maybeShowAd();
                },
                init: function() {
                    // Play first video muted initially
                    const firstSlide = this.slides[0];
                    if(firstSlide) {
                        const iframe = firstSlide.querySelector('iframe');
                        if (iframe && iframe.src) {
                            trackSeenVideo(iframe.src);
                            
                            // Play first video muted after a delay
                            setTimeout(() => {
                                playVideo(iframe);
                            }, 1500);
                        }
                    }
                    
                    // Reset flag
                    isFirstLoad = false;
                }
            }
        });
        
    } catch(e) { 
        console.error("Error loading feed:", e);
        feed.innerHTML = '<div class="swiper-slide" style="display:flex; align-items:center; justify-content:center;"><h3>Connection Error</h3></div>'; 
    }
}

// Unmute a specific video
function unmuteVideo(iframe) {
    if (!iframe) return;
    
    try {
        // Send unmute command
        iframe.contentWindow.postMessage('{"event":"command","func":"unMute","args":""}', '*');
        
        // Update the src to unmute for future loads
        if (iframe.src.includes('mute=1')) {
            iframe.src = iframe.src.replace('mute=1', 'mute=0');
        }
        
        console.log("Unmuted video:", iframe.src);
    } catch (e) {
        console.log("Could not unmute video:", e);
    }
}

// Handle video tap for play/pause
function handleVideoTap(overlayElement) {
    // Mark user interaction for autoplay
    if (!userHasInteracted) {
        userHasInteracted = true;
        triggerInitialInteraction();
    }
    
    const container = overlayElement.closest('.video-container');
    const iframe = container.querySelector('iframe');
    
    // Unmute on first tap
    if (iframe.src.includes('mute=1')) {
        unmuteVideo(iframe);
    }
    
    toggleVideoPlayback(iframe);
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
                statusEl.textContent
