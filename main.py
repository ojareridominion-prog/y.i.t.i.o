# ===================================================
# FILE: main.py
# Y.I.T.I.O BOT WITH PROPER WEBHOOK AND AUTO-PING
# ===================================================

import os
import sys
import asyncio
import logging
import random
from datetime import datetime, timedelta
from typing import Optional

from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from aiogram import Bot, Dispatcher, F
from aiogram.types import (
    Message, Update, CallbackQuery, 
    InlineKeyboardMarkup, InlineKeyboardButton, 
    PreCheckoutQuery, ContentType, LabeledPrice,
    BotCommand
)
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from supabase import create_client, Client
import socket

# Add current directory to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Import pinger
from ping import RenderPinger

# ==================== CONFIG ====================
BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
ADMIN_ID = int(os.environ.get("ADMIN_ID", 0))
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
PROVIDER_TOKEN = os.environ.get("PROVIDER_TOKEN", "")
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")
WEBHOOK_SECRET_TOKEN = os.environ.get("WEBHOOK_SECRET_TOKEN", "YOUR_WEBHOOK_SECRET")

# Initialize FastAPI
app = FastAPI(title="Y.I.T.I.O Bot API")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("yitio_bot")

# Initialize Bot and Dispatcher
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher(storage=MemoryStorage())

# Initialize Supabase if credentials exist
supabase: Optional[Client] = None
if SUPABASE_URL and SUPABASE_KEY:
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        logger.info("✅ Supabase connected successfully")
    except Exception as e:
        logger.error(f"❌ Failed to connect to Supabase: {e}")
        supabase = None

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global pinger instance
_pinger = None

# ==================== HELPER FUNCTIONS ====================

def extract_video_id(url: str, platform: str) -> str:
    """Extract video ID from different platform URLs"""
    try:
        if platform == "YouTube":
            if "youtube.com/shorts/" in url:
                return url.split("shorts/")[1].split("?")[0]
            elif "youtu.be/" in url:
                return url.split("youtu.be/")[1].split("?")[0]
            elif "v=" in url:
                return url.split("v=")[1].split("&")[0]
        elif platform == "TikTok":
            if "tiktok.com/@" in url:
                parts = url.split("/")
                for part in parts:
                    if len(part) == 19 and part.isdigit():
                        return part
                return parts[-1].split("?")[0]
        elif platform == "Instagram":
            if "instagram.com/reel/" in url:
                return url.split("reel/")[1].split("/")[0].split("?")[0]
            elif "instagram.com/p/" in url:
                return url.split("p/")[1].split("/")[0].split("?")[0]
    except:
        pass
    return ""

def get_embed_url(url: str, platform: str) -> str:
    """Convert URL to embeddable format"""
    video_id = extract_video_id(url, platform)
    
    if platform == "YouTube":
        return f"https://www.youtube.com/embed/{video_id}"
    elif platform == "TikTok":
        return f"https://www.tiktok.com/embed/v2/{video_id}"
    elif platform == "Instagram":
        return f"https://www.instagram.com/p/{video_id}/embed"
    return url

def get_user_id_from_init_data(init_data: str):
    """Extract user ID from Telegram WebApp initData"""
    try:
        import urllib.parse
        import json
        parsed = urllib.parse.parse_qs(init_data)
        if 'user' in parsed:
            user_data = json.loads(parsed['user'][0])
            return user_data.get('id')
    except Exception as e:
        logger.error(f"Error parsing initData: {e}")
    return None

# ==================== AUTO-PING SETUP ====================

async def setup_pinger():
    """Setup the auto-pinger service"""
    global _pinger
    
    # Don't run pinger if disabled
    if os.environ.get("DISABLE_PINGER", "").lower() == "true":
        logger.info("⚠️ Auto-pinger disabled by DISABLE_PINGER environment variable")
        return
    
    try:
        # Get the correct URL for pinging
        webhook_url = os.environ.get("WEBHOOK_URL", "")
        if not webhook_url:
            # Auto-detect Render URL
            service_name = os.environ.get("RENDER_SERVICE_NAME", "")
            if service_name:
                webhook_url = f"https://{service_name}.onrender.com/webhook"
            else:
                # Try to detect current service
                render_url = os.environ.get("RENDER_EXTERNAL_URL", "")
                if render_url:
                    webhook_url = f"{render_url}/webhook"
                else:
                    webhook_url = "https://yitio-bot.onrender.com/webhook"
        
        # Extract base URL (remove /webhook)
        base_url = webhook_url.replace("/webhook", "").rstrip('/')
        logger.info(f"🌐 Pinger will use base URL: {base_url}")
        
        # Create and start pinger
        _pinger = RenderPinger(ping_url=base_url, interval_minutes=8)  # Ping every 8 minutes
        asyncio.create_task(_pinger.start())
        logger.info("✅ Auto-pinger started successfully")
        
    except Exception as e:
        logger.error(f"❌ Failed to start pinger: {e}")

# ==================== WEBHOOK ENDPOINTS ====================

@app.post("/webhook")
async def handle_webhook(request: Request):
    """Handles incoming messages from Telegram"""
    try:
        # Verify webhook secret if set
        if WEBHOOK_SECRET_TOKEN and WEBHOOK_SECRET_TOKEN != "YOUR_WEBHOOK_SECRET":
            secret_token = request.headers.get("X-Telegram-Bot-Api-Secret-Token")
            if secret_token != WEBHOOK_SECRET_TOKEN:
                logger.warning(f"Invalid webhook secret token: {secret_token}")
                return {"ok": False, "error": "Invalid secret token"}
        
        # Parse update
        data = await request.json()
        update = Update(**data)
        
        # Process update
        await dp.feed_update(bot, update)
        
        return {"ok": True}
    except Exception as e:
        logger.error(f"Webhook Error: {e}")
        return {"ok": False, "error": str(e)}

@app.get("/set-webhook")
async def set_webhook():
    """Set webhook URL dynamically"""
    try:
        # Get webhook URL
        webhook_url = os.environ.get("WEBHOOK_URL", "")
        if not webhook_url:
            # Auto-detect Render URL
            service_name = os.environ.get("RENDER_SERVICE_NAME", "")
            if service_name:
                webhook_url = f"https://{service_name}.onrender.com/webhook"
            else:
                render_url = os.environ.get("RENDER_EXTERNAL_URL", "")
                if render_url:
                    webhook_url = f"{render_url}/webhook"
                else:
                    webhook_url = "https://yitio-bot.onrender.com/webhook"
        
        logger.info(f"Setting webhook to: {webhook_url}")
        
        await bot.set_webhook(
            url=webhook_url,
            drop_pending_updates=True,
            allowed_updates=["message", "callback_query", "pre_checkout_query"],
            secret_token=WEBHOOK_SECRET_TOKEN if WEBHOOK_SECRET_TOKEN != "YOUR_WEBHOOK_SECRET" else None
        )
        
        # Test webhook immediately
        try:
            import httpx
            async with httpx.AsyncClient(timeout=10.0) as client:
                base_url = webhook_url.replace("/webhook", "")
                response = await client.get(f"{base_url}/health")
                logger.info(f"✅ Health check response: {response.status_code}")
        except Exception as e:
            logger.warning(f"⚠️ Could not test health endpoint: {e}")
        
        return {
            "status": "success", 
            "url": webhook_url,
            "message": "Webhook set successfully",
            "secret_token_set": bool(WEBHOOK_SECRET_TOKEN and WEBHOOK_SECRET_TOKEN != "YOUR_WEBHOOK_SECRET")
        }
    except Exception as e:
        logger.error(f"Error setting webhook: {e}")
        return {
            "status": "error",
            "message": str(e)
        }

@app.get("/webhook-info")
async def webhook_info():
    """Check current webhook status"""
    try:
        info = await bot.get_webhook_info()
        return {
            "url": info.url,
            "has_custom_certificate": info.has_custom_certificate,
            "pending_update_count": info.pending_update_count,
            "last_error_date": info.last_error_date,
            "last_error_message": info.last_error_message,
            "max_connections": info.max_connections,
            "allowed_updates": info.allowed_updates,
            "last_synchronization_error_date": info.last_synchronization_error_date
        }
    except Exception as e:
        return {"error": str(e)}

# ==================== HEALTH & ROOT ENDPOINTS ====================

@app.get("/health")
async def health_check():
    """Enhanced health check endpoint"""
    return {
        "status": "healthy",
        "service": "Y.I.T.I.O Bot",
        "timestamp": datetime.utcnow().isoformat(),
        "ping_service": "active" if _pinger else "inactive"
    }

@app.get("/")
async def root():
    """Root endpoint with service info"""
    return {
        "message": "Y.I.T.I.O Bot API",
        "status": "running",
        "timestamp": datetime.utcnow().isoformat(),
        "endpoints": {
            "health": "/health",
            "set_webhook": "/set-webhook",
            "webhook_info": "/webhook-info",
            "api_videos": "/api/videos",
            "api_check_premium": "/api/check-premium"
        },
        "ping_service": "active (every 8 minutes)" if _pinger else "inactive"
    }

# ==================== STARTUP & SHUTDOWN ====================

@app.on_event("startup")
async def startup_event():
    """Run startup tasks"""
    logger.info("🚀 Starting Y.I.T.I.O Bot...")
    
    # Set bot commands
    commands = [
        BotCommand(command="start", description="Start the bot"),
        BotCommand(command="premium", description="Premium status & purchase")
    ]
    
    if ADMIN_ID:
        commands.append(BotCommand(command="admin", description="Admin panel"))
    
    try:
        await bot.set_my_commands(commands)
        logger.info("✅ Bot commands set successfully")
    except Exception as e:
        logger.error(f"❌ Error setting commands: {e}")
    
    # Start pinger FIRST (so it can warm up the server)
    await setup_pinger()
    
    # Wait a moment for pinger to initialize
    await asyncio.sleep(2)
    
    # Auto-set webhook
    webhook_url = os.environ.get("WEBHOOK_URL", "")
    if not webhook_url:
        # Auto-detect Render URL
        service_name = os.environ.get("RENDER_SERVICE_NAME", "")
        if service_name:
            webhook_url = f"https://{service_name}.onrender.com/webhook"
        else:
            render_url = os.environ.get("RENDER_EXTERNAL_URL", "")
            if render_url:
                webhook_url = f"{render_url}/webhook"
            else:
                webhook_url = "https://yitio-bot.onrender.com/webhook"
    
    try:
        await bot.set_webhook(
            url=webhook_url,
            drop_pending_updates=True,
            allowed_updates=["message", "callback_query", "pre_checkout_query"],
            secret_token=WEBHOOK_SECRET_TOKEN if WEBHOOK_SECRET_TOKEN != "YOUR_WEBHOOK_SECRET" else None
        )
        logger.info(f"✅ Webhook set to: {webhook_url}")
        
        # Test the webhook immediately
        try:
            import httpx
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(webhook_url.replace("/webhook", "/health"))
                logger.info(f"✅ Health check response: {response.status_code}")
        except Exception as e:
            logger.warning(f"⚠️ Could not test health endpoint: {e}")
            
    except Exception as e:
        logger.error(f"❌ Error setting webhook: {e}")
        # Fallback to polling if webhook fails (for development)
        if os.environ.get("USE_POLLING", "").lower() == "true":
            logger.info("⚠️ Falling back to polling mode...")
            asyncio.create_task(dp.start_polling(bot))
    
    logger.info("✅ Bot startup complete!")

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    global _pinger
    logger.info("🛑 Shutting down...")
    
    if _pinger:
        await _pinger.stop()
    
    await bot.session.close()
    logger.info("✅ Cleanup complete")

# ==================== PAYMENT HANDLERS (STARS) ====================

@dp.pre_checkout_query()
async def on_pre_checkout_query(pre_checkout_query: PreCheckoutQuery):
    await bot.answer_pre_checkout_query(pre_checkout_query.id, ok=True)

@dp.message(F.content_type == ContentType.SUCCESSFUL_PAYMENT)
async def on_successful_payment(message: Message):
    try:
        payment = message.successful_payment
        telegram_id = message.from_user.id
        
        # Calculate expiry (30 days from now)
        expires_at = datetime.utcnow() + timedelta(days=30)
        
        # Record the payment
        supabase.table("payments").insert({
            "telegram_id": telegram_id,
            "provider": "telegram_stars",
            "amount": payment.total_amount,
            "currency": payment.currency,
            "payload": payment.invoice_payload,
            "transaction_id": payment.telegram_payment_charge_id,
            "status": "completed"
        }).execute()

        # Update User Premium Status
        supabase.table("users").upsert({
            "telegram_id": telegram_id,
            "is_premium": True,
            "premium_expires_at": expires_at.isoformat(),
            "updated_at": datetime.utcnow().isoformat()
        }).execute()

        # Send congratulatory message
        await message.answer(
            "🎉 Payment successful! You are now a Y.I.T.I.O Premium member!\n\n"
            "✅ Your premium access is active for 30 days.\n"
            "✅ Ads have been removed from your experience.\n\n"
            "To refresh your premium status in the app:\n"
            "1. Close and reopen the Y.I.T.I.O Mini App\n"
            "2. Or tap 'Check Premium Status' button\n\n"
            "Use /premium anytime to check your status."
        )
        
        # Send button to refresh the mini app
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🔄 Refresh App", web_app={"url": "https://YOUR-GITHUB-USERNAME.github.io/yitio/"})],
            [InlineKeyboardButton(text="🚀 Open Y.I.T.I.O", web_app={"url": "https://YOUR-GITHUB-USERNAME.github.io/yitio/"})]
        ])
        
        await message.answer(
            "Click below to open the refreshed app with premium activated:",
            reply_markup=keyboard
        )
        
    except Exception as e:
        logger.error(f"Payment DB Error: {e}")
        await message.answer("Payment received, but there was an error activating premium. Please contact support.")

# ==================== PREMIUM VERIFICATION ENDPOINTS ====================

@app.get("/api/check-premium")
async def check_premium(user_id: int):
    """Check premium status"""
    try:
        if not supabase:
            return {"is_premium": False, "expires_at": None, "days_left": None}
        
        result = supabase.table("users") \
            .select("*") \
            .eq("telegram_id", user_id) \
            .execute()
        
        if not result.data:
            return {"is_premium": False, "expires_at": None, "days_left": None}
        
        data = result.data[0]
        is_premium = data.get("is_premium")
        expires_at_str = data.get("premium_expires_at")
        
        # Handle boolean value properly
        is_premium_bool = False
        if isinstance(is_premium, bool):
            is_premium_bool = is_premium
        elif isinstance(is_premium, str):
            is_premium_bool = is_premium.lower() == 'true'
        elif isinstance(is_premium, int):
            is_premium_bool = bool(is_premium)
        
        # Check if premium is active
        if is_premium_bool and expires_at_str:
            try:
                expires_at_str_clean = expires_at_str
                if expires_at_str.endswith('Z'):
                    expires_at_str_clean = expires_at_str.replace('Z', '+00:00')
                
                expires_at = datetime.fromisoformat(expires_at_str_clean)
                now = datetime.utcnow().replace(tzinfo=None)
                
                if expires_at.tzinfo is not None:
                    expires_at = expires_at.replace(tzinfo=None)
                
                if expires_at > now:
                    days_left = (expires_at - now).days
                    return {
                        "is_premium": True,
                        "expires_at": expires_at.isoformat(),
                        "days_left": days_left
                    }
            except Exception as e:
                logger.error(f"Date parsing error: {e}")
        
        return {"is_premium": False, "expires_at": None, "days_left": None}
        
    except Exception as e:
        logger.error(f"Error in check_premium: {e}")
        return {"is_premium": False, "expires_at": None, "days_left": None}

@app.get("/api/user-data")
async def get_user_data(request: Request):
    """Get user data for the current Telegram user"""
    try:
        import urllib.parse
        import json
        
        # Get user from Telegram WebApp initData
        init_data = request.headers.get("X-Telegram-Init-Data", "")
        
        if not init_data:
            return {"user": None, "premium": False}
        
        user_id = get_user_id_from_init_data(init_data)
        
        if not user_id:
            return {"user": None, "premium": False}
        
        # Get user info from initData
        try:
            parsed = urllib.parse.parse_qs(init_data)
            user_json = json.loads(parsed['user'][0])
            user_info = {
                "id": user_json.get('id'),
                "username": user_json.get('username'),
                "first_name": user_json.get('first_name'),
                "last_name": user_json.get('last_name')
            }
        except:
            user_info = {"id": user_id}
        
        # Check premium status
        premium_result = await check_premium(user_id)
        
        return {
            "user": user_info,
            "premium": premium_result["is_premium"],
            "expires_at": premium_result.get("expires_at")
        }
        
    except Exception as e:
        logger.error(f"Error getting user data: {e}")
        return {"user": None, "premium": False}

# ==================== FRONTEND API ====================

@app.get("/api/videos")
async def get_videos(category: str = "All", limit: int = 50):
    """Get videos by category"""
    if not supabase:
        return []
    
    query = supabase.table('videos').select('*')
    
    if category.lower() != "all":
        query = query.eq('platform', category)
    
    query = query.order('created_at', desc=True)
    res = query.execute()
    data = res.data
    
    # Shuffle but maintain some order (like IMAGIFHUB)
    
