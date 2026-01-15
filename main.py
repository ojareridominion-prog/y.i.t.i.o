#[file name]: main.py
import os
import logging
import random
import asyncio
from datetime import datetime, timedelta
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from aiogram import Bot, Dispatcher, F
from aiogram.types import Message, Update, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton, PreCheckoutQuery, ContentType
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from supabase import create_client, Client
from aiogram.types import LabeledPrice

# ==================== CONFIG ====================
BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
ADMIN_ID = int(os.environ.get("ADMIN_ID", 0))
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
PROVIDER_TOKEN = os.environ.get("PROVIDER_TOKEN", "")  # Telegram Stars provider token
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")  # Separate admin token for API
WEBHOOK_SECRET_TOKEN = os.environ.get("WEBHOOK_SECRET_TOKEN", "YOUR_WEBHOOK_SECRET")  # Add this

# Initialize Clients
app = FastAPI()
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher(storage=MemoryStorage())
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

app.add_middleware(
    CORSMiddleware, 
    allow_origins=["*"], 
    allow_methods=["*"], 
    allow_headers=["*"]
)

# Helper function to get Render URL
def get_render_url():
    """Get the correct Render URL"""
    # Try different environment variables Render provides
    render_url = os.environ.get("RENDER_EXTERNAL_URL", "")
    if render_url:
        return render_url
    
    # Fallback to your Render service name
    service_name = os.environ.get("RENDER_SERVICE_NAME", "y-i-t-i-o")
    return f"https://{service_name}.onrender.com"

class AdminUpload(StatesGroup):
    waiting_video_url = State()
    waiting_platform = State()

PLATFORMS = ["YouTube", "TikTok", "Instagram"]
CATEGORIES = ["All", "YouTube", "TikTok", "Instagram"]

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
                # Extract video ID from TikTok URL
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
        logging.error(f"Error parsing initData: {e}")
    return None

# ==================== WEBHOOK HELPERS ====================

@app.post("/webhook")
async def handle_webhook(request: Request):
    """Handles incoming messages from Telegram"""
    try:
        # Verify webhook secret if set
        if WEBHOOK_SECRET_TOKEN:
            secret_token = request.headers.get("X-Telegram-Bot-Api-Secret-Token")
            if secret_token != WEBHOOK_SECRET_TOKEN:
                logging.warning(f"Invalid webhook secret token: {secret_token}")
                return {"ok": False, "error": "Invalid secret token"}
        
        # Parse update
        data = await request.json()
        update = Update(**data)
        
        # Process update
        await dp.feed_update(bot, update)
        
        return {"ok": True}
    except Exception as e:
        logging.error(f"Webhook Error: {e}")
        return {"ok": False, "error": str(e)}

@app.get("/set-webhook")
async def set_webhook():
    """Set webhook URL dynamically"""
    webhook_url = f"{get_render_url()}/webhook"
    
    try:
        await bot.set_webhook(
            url=webhook_url,
            drop_pending_updates=True,
            allowed_updates=["message", "callback_query", "pre_checkout_query"],
            secret_token=WEBHOOK_SECRET_TOKEN  # Add secret token
        )
        return {
            "status": "success", 
            "url": webhook_url,
            "message": "Webhook set successfully",
            "secret_token_set": bool(WEBHOOK_SECRET_TOKEN)
        }
    except Exception as e:
        logging.error(f"Error setting webhook: {e}")
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

@app.get("/delete-webhook")
async def delete_webhook():
    """Delete webhook (for debugging)"""
    try:
        result = await bot.delete_webhook(drop_pending_updates=True)
        return {"success": True, "result": result}
    except Exception as e:
        return {"error": str(e)}

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
        logging.error(f"Payment DB Error: {e}")
        await message.answer("Payment received, but there was an error activating premium. Please contact support.")

# ==================== PREMIUM VERIFICATION ENDPOINTS ====================

@app.get("/api/check-premium")
async def check_premium(user_id: int):
    """Check premium status"""
    try:
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
                logging.error(f"Date parsing error: {e}")
        
        return {"is_premium": False, "expires_at": None, "days_left": None}
        
    except Exception as e:
        logging.error(f"Error in check_premium: {e}")
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
        logging.error(f"Error getting user data: {e}")
        return {"user": None, "premium": False}

# ==================== FRONTEND API ====================

@app.get("/api/videos")
async def get_videos(category: str = "All", limit: int = 50):
    """Get videos by category"""
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

# ==================== ADMIN ENDPOINTS ====================

@app.get("/api/admin/stats")
async def admin_stats(request: Request):
    """Admin statistics endpoint"""
    # Simple auth check
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    token = auth.replace("Bearer ", "").strip()
    if token != ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    try:
        # Get total videos by platform
        youtube_res = supabase.table("videos").select("count", count="exact").eq("platform", "YouTube").execute()
        tiktok_res = supabase.table("videos").select("count", count="exact").eq("platform", "TikTok").execute()
        instagram_res = supabase.table("videos").select("count", count="exact").eq("platform", "Instagram").execute()
        
        # Get total users
        users_res = supabase.table("users").select("count", count="exact").execute()
        total_users = users_res.count or 0
        
        # Get premium users
        premium_res = supabase.table("users").select("count", count="exact").eq("is_premium", True).execute()
        premium_users = premium_res.count or 0
        
        # Get total payments
        payments_res = supabase.table("payments").select("amount", "currency").eq("status", "completed").execute()
        total_revenue = sum(p.get("amount", 0) for p in payments_res.data) if payments_res.data else 0
        
        return {
            "videos": {
                "youtube": youtube_res.count or 0,
                "tiktok": tiktok_res.count or 0,
                "instagram": instagram_res.count or 0,
                "total": (youtube_res.count or 0) + (tiktok_res.count or 0) + (instagram_res.count or 0)
            },
            "users": {
                "total": total_users,
                "premium": premium_users,
                "premium_percentage": (premium_users / total_users * 100) if total_users > 0 else 0
            },
            "revenue": total_revenue
        }
        
    except Exception as e:
        logging.error(f"Admin stats error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

# ==================== BOT LOGIC ====================

@dp.message(F.text == "/start")
async def cmd_start(message: Message):
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🚀 Let's Go!", web_app={"url": "https://YOUR-GITHUB-USERNAME.github.io/yitio/"})],
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
        user_result = supabase.table("users") \
            .select("is_premium, premium_expires_at") \
            .eq("telegram_id", telegram_id) \
            .execute()
        
        if not user_result.data or len(user_result.data) == 0:
            # User not in database - offer premium
            keyboard = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="⭐ Get Premium", callback_data="get_premium")],
                [InlineKeyboardButton(text="🎬 Open Y.I.T.I.O", web_app={"url": "https://YOUR-GITHUB-USERNAME.github.io/yitio/"})]
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
                logging.error(f"Date parsing error: {e}")
        
        # If we get here, user is not premium
        
