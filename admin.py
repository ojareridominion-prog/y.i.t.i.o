# ===================================================
# FILE: admin.py
# ADMIN PANEL FOR Y.I.T.I.O BOT
# ===================================================

import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Request, HTTPException
from aiogram import F
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup

from shared import bot, dp, supabase, logger, ADMIN_ID, ADMIN_TOKEN
from utils import extract_video_id, get_embed_url  # <-- Changed from main.py to utils.py

router = APIRouter(prefix="/api/admin", tags=["admin"])

class AdminUpload(StatesGroup):
    waiting_video_url = State()
    waiting_platform = State()

PLATFORMS = ["YouTube", "TikTok", "Instagram"]

# ==================== ADMIN COMMANDS ====================

@dp.message(F.from_user.id == ADMIN_ID, F.text == "/admin")
async def admin_cmd(message: Message, state: FSMContext):
    await state.clear()
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="📤 Add New Video", callback_data="add_video")]
    ])
    await message.answer("<b>Admin Control Panel</b>", reply_markup=kb, parse_mode="HTML")

@dp.callback_query(F.data == "add_video")
async def add_video_step1(call: CallbackQuery, state: FSMContext):
    await call.answer()  # <-- ADD THIS LINE to acknowledge the callback
    await call.message.edit_text("Please send the video URL (YouTube, TikTok, or Instagram):")
    await state.set_state(AdminUpload.waiting_video_url)

@dp.message(AdminUpload.waiting_video_url)
async def add_video_step2(message: Message, state: FSMContext):
    if not supabase:
        await message.answer("❌ Database not connected. Cannot add video.")
        await state.clear()
        return
    
    url = message.text.strip()
    
    # Check if URL already exists
    existing = supabase.table('videos').select('*').eq('url', url).execute()
    
    if existing.data:
        await message.answer("❌ This video URL already exists in the database!")
        await state.clear()
        return
    
    await state.update_data(url=url)
    
    # Ask for platform
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="YouTube", callback_data="platform_YouTube")],
        [InlineKeyboardButton(text="TikTok", callback_data="platform_TikTok")],
        [InlineKeyboardButton(text="Instagram", callback_data="platform_Instagram")]
    ])
    
    await message.answer("Select the platform:", reply_markup=kb)
    await state.set_state(AdminUpload.waiting_platform)

@dp.callback_query(F.data.startswith("platform_"), AdminUpload.waiting_platform)  # <-- ADD STATE FILTER HERE
async def add_video_final(call: CallbackQuery, state: FSMContext):
    await call.answer()  # <-- ADD THIS LINE to acknowledge the callback
    
    if not supabase:
        await call.message.edit_text("❌ Database not connected. Cannot add video.")
        await state.clear()
        return
    
    try:
        platform = call.data.split("_")[1]
        user_data = await state.get_data()
        url = user_data['url']
        
        # Save to database
        supabase.table('videos').insert({
            "url": url,
            "platform": platform,
            "embed_url": get_embed_url(url, platform),
            "created_at": datetime.utcnow().isoformat()
        }).execute()
        
        await call.message.edit_text(f"✅ Successfully added {platform} video!")
        await state.clear()
        
    except Exception as e:
        logger.error(f"Error adding video: {e}")
        await call.message.edit_text(f"❌ Error adding video: {str(e)[:200]}")
        await state.clear()

# Add a handler for when the user cancels or goes back
@dp.callback_query(F.data == "cancel_upload")
async def cancel_upload(call: CallbackQuery, state: FSMContext):
    await call.answer("Cancelled")
    await state.clear()
    await call.message.edit_text("❌ Video upload cancelled.")

# ==================== ADMIN API ENDPOINTS ====================

@router.get("/stats")
async def admin_stats(request: Request):
    """Admin statistics endpoint"""
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not connected")
    
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
        logger.error(f"Admin stats error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
