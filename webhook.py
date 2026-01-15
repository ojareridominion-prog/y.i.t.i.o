# ===================================================
# FILE: webhook.py
# WEBHOOK HANDLERS FOR Y.I.T.I.O BOT
# ===================================================

import asyncio
import logging
from datetime import datetime
from typing import Optional

import httpx
from fastapi import APIRouter, Request, HTTPException
from aiogram import types

from shared import bot, dp, logger, WEBHOOK_URL, WEBHOOK_SECRET_TOKEN

router = APIRouter(prefix="/webhook", tags=["webhook"])

@router.post("")
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
        update = types.Update(**data)
        
        # Process update
        await dp.feed_update(bot, update)
        
        return {"ok": True}
    except Exception as e:
        logger.error(f"Webhook Error: {e}")
        return {"ok": False, "error": str(e)}

@router.get("/set")
async def set_webhook():
    """Set webhook URL dynamically"""
    try:
        # Get webhook URL
        webhook_url = WEBHOOK_URL
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

@router.get("/info")
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
