# ===================================================
# FILE: main.py
# Y.I.T.I.O BOT MAIN FILE
# ===================================================

import os
import sys
import asyncio
import logging
import random
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from aiogram import Bot, Dispatcher, F
from aiogram.types import Message, BotCommand, InlineKeyboardMarkup, InlineKeyboardButton, CallbackQuery
from aiogram.fsm.context import FSMContext

# Add current directory to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Import shared variables
from shared import bot, dp, supabase, logger, ADMIN_ID

# Import modules - IMPORTANT: Import these after shared to avoid circular imports
from ping import setup_pinger
from webhook import router as webhook_router
from admin import router as admin_router
from utils import extract_video_id, get_embed_url, get_user_id_from_init_data  # <-- From utils now

# Import handlers directly to register them
import invoice
import admin as admin_module

# Initialize FastAPI
app = FastAPI(title="Y.I.T.I.O Bot API")

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(webhook_router)
app.include_router(admin_router)

# ==================== HEALTH & ROOT ENDPOINTS ====================

@app.get("/health")
async def health_check():
    """Enhanced health check endpoint"""
    from shared import _pinger
    return {
        "status": "healthy",
        "service": "Y.I.T.I.O Bot",
        "timestamp": datetime.utcnow().isoformat(),
        "ping_service": "active" if _pinger else "inactive"
    }

@app.get("/")
async def root():
    """Root endpoint with service info"""
    from shared import _pinger
    return {
        "message": "Y.I.T.I.O Bot API",
        "status": "running",
        "timestamp": datetime.utcnow().isoformat(),
        "endpoints": {
            "health": "/health",
            "set_webhook": "/webhook/set",
            "webhook_info": "/webhook/info",
            "api_videos": "/api/videos",
            "api_check_premium": "/api/check-premium"
        },
        "ping_service": "active (every 8 minutes)" if _pinger else "inactive"
    }

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
    if data:
        # Split into groups and shuffle within groups
        groups = [data[i:i+10] for i in range(0, len(data), 10)]
        shuffled = []
        for group in groups:
            group_copy = group.copy()
            random.shuffle(group_copy)
            shuffled.extend(group_copy)
        data = shuffled
    
    return data[:limit]

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

# ==================== BOT COMMAND HANDLERS ====================

@dp.message(F.text == "/start")
async def cmd_start(message: Message):
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🚀 Let's Go!", web_app={"url": "https://ojareridominion-prog.github.io/y.i.t.i.o/"})],
        [InlineKeyboardButton(text="📢 Official Channel", url="https://t.me/yitio_channel")]
    ])
    await message.answer(
        "🎬 *Y.I.T.I.O - Your Infinite Video Stream*\n\n"
        "Watch endless YouTube Shorts, TikTok, and Instagram Reels\n"
        "All in one place, curated just for you!\n\n"
        "Click 'Let's Go!' to start watching 🎥",
        parse_mode="Markdown",
        reply_markup=keyboard
    )

@dp.message(F.text == "/premium")
async def cmd_premium(message: Message):
    """Check premium status or purchase premium"""
    telegram_id = message.from_user.id
    
    try:
        if not supabase:
            await message.answer("❌ Database not connected. Please try again later.")
            return
            
        user_result = supabase.table("users") \
            .select("is_premium, premium_expires_at") \
            .eq("telegram_id", telegram_id) \
            .execute()
        
        if not user_result.data or len(user_result.data) == 0:
            # User not in database - offer premium
            keyboard = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="⭐ Get Premium", callback_data="get_premium")],
                [InlineKeyboardButton(text="🎬 Open Y.I.T.I.O", web_app={"url": "https://ojareridominion-prog.github.io/y.i.t.i.o/"})]
            ])
            await message.answer(
                "✨ *Y.I.T.I.O Premium*\n\n"
                "🔓 You are currently on the free plan.\n\n"
                "✨ *Upgrade to Premium for:*\n"
                "• 🚫 No ads\n"
                "• 😁 Support the project\n\n"
                "💫 *Price:* 149 Stars (30 days)\n\n"
                "Click 'Get Premium' to upgrade!",
                parse_mode="HTML",
                reply_markup=keyboard
            )
            return
        
        user_data = user_result.data[0]
        is_premium = user_data.get("is_premium", False)
        premium_expires_at = user_data.get("premium_expires_at")
        
        # Handle boolean value properly
        is_premium_bool = False
        if isinstance(is_premium, bool):
            is_premium_bool = is_premium
        elif isinstance(is_premium, str):
            is_premium_bool = is_premium.lower() == 'true'
        elif isinstance(is_premium, int):
            is_premium_bool = bool(is_premium)
        
        if is_premium_bool and premium_expires_at:
            try:
                expires_at_str = premium_expires_at
                if expires_at_str.endswith('Z'):
                    expires_at_str = expires_at_str.replace('Z', '+00:00')
                
                expires_at = datetime.fromisoformat(expires_at_str)
                now = datetime.utcnow().replace(tzinfo=None)
                
                if expires_at.tzinfo is not None:
                    expires_at = expires_at.replace(tzinfo=None)
                
                if expires_at > now:
                    days_left = (expires_at - now).days
                    await message.answer(
                        f"✨ *Premium Status*\n\n"
                        f"✅ You are a *Premium Member*!\n"
                        f"⏳ Days remaining: *{days_left}* day(s)\n"
                        f"📅 Expires on: {expires_at.strftime('%Y-%m-%d')}\n\n"
                        f"Enjoy your ad-free experience! 🎉",
                        parse_mode="HTML"
                    )
                    return
            except Exception as e:
                logger.error(f"Date parsing error: {e}")
        
        # If we get here, user is not premium
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="⭐ Get Premium", callback_data="get_premium")],
            [InlineKeyboardButton(text="🎬 Open Y.I.T.I.O", web_app={"url": "https://ojareridominion-prog.github.io/y.i.t.i.o/"})]
        ])
        await message.answer(
            "✨ *Y.I.T.I.O Premium*\n\n"
            "🔓 You are currently on the free plan.\n\n"
            "✨ *Upgrade to Premium for:*\n"
            "• 🚫 No ads\n"
            "• 😁 Support the project\n\n"
            "💫 *Price:* 149 Stars (30 days)\n\n"
            "Click 'Get Premium' to upgrade!",
            parse_mode="HTML",
            reply_markup=keyboard
        )
            
    except Exception as e:
        logger.error(f"Premium check error: {e}")
        await message.answer("❌ There was an error checking your premium status.")

# Handle deep linking for /start premium
@dp.message(F.text.startswith("/start premium"))
async def start_premium(message: Message):
    await cmd_premium(message)

# ==================== STARTUP & SHUTDOWN ====================

# In the startup_event function, replace the webhook setting section:

@app.on_event("startup")
async def startup_event():
    """Run startup tasks"""
    logger.info("🚀 Starting Y.I.T.I.O Bot...")
    
    # Import here to avoid circular imports
    from shared import _pinger, bot, dp, WEBHOOK_URL, WEBHOOK_SECRET_TOKEN
    
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
    _pinger = await setup_pinger()
    
    # Wait a moment for pinger to initialize
    await asyncio.sleep(2)
    
    # Auto-set webhook - USE THE CORRECT PATTERN
    webhook_url = WEBHOOK_URL
    if not webhook_url:
        # Use the pattern that's already working
        webhook_url = "https://y-i-t-i-o.onrender.com/api/telegram-webhook"
    
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
                response = await client.get("https://y-i-t-i-o.onrender.com/health")
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
    from shared import _pinger, bot
    logger.info("🛑 Shutting down...")
    
    if _pinger:
        await _pinger.stop()
    
    await bot.session.close()
    logger.info("✅ Cleanup complete")

# ==================== MAIN ENTRY POINT ====================

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 10000))
    host = os.environ.get("HOST", "0.0.0.0")
    
    logger.info(f"🌐 Starting server on {host}:{port}")
    uvicorn.run(
        app, 
        host=host, 
        port=port,
        # These settings help with Render's timeout issues
        timeout_keep_alive=65,
        access_log=True
)
