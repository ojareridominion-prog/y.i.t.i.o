# ===================================================
# FILE: invoice.py
# PAYMENT HANDLING FOR Y.I.T.I.O BOT
# ===================================================

import logging
from datetime import datetime, timedelta

from aiogram import F
from aiogram.types import (
    Message, CallbackQuery, 
    PreCheckoutQuery, ContentType,
    LabeledPrice, InlineKeyboardMarkup, InlineKeyboardButton
)

from shared import bot, dp, supabase, logger, PROVIDER_TOKEN

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

@dp.callback_query(F.data == "get_premium")
async def get_premium_callback(call: CallbackQuery):
    """Create invoice for premium purchase"""
    await call.answer()
    
    if not PROVIDER_TOKEN:
        await call.message.answer(
            "❌ Payment system is not configured. Please contact admin."
        )
        return
    
    try:
        invoice_link = await bot.create_invoice_link(
            title="Y.I.T.I.O Premium",
            description="30 days of ad-free video streaming",
            payload=f"premium_{call.from_user.id}",
            provider_token=PROVIDER_TOKEN,
            currency="XTR",
            prices=[LabeledPrice(label="Premium Access", amount=149)]
        )
        
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="💳 Pay Now", url=invoice_link)],
            [InlineKeyboardButton(text="🔙 Back", callback_data="back_to_premium")]
        ])
        
        await call.message.edit_text(
            "✨ *Upgrade to Y.I.T.I.O Premium*\n\n"
            "💫 *Price:* 149 Stars (30 days)\n\n"
            "*Benefits:*\n"
            "• 🚫 No ads\n"
            "• 😁 Support the project\n\n"
            "Click 'Pay Now' to complete your purchase.",
            parse_mode="HTML",
            reply_markup=keyboard
        )
    except Exception as e:
        logger.error(f"Error creating invoice: {e}")
        await call.message.answer("❌ Error creating payment. Please try again later.")

@dp.callback_query(F.data == "back_to_premium")
async def back_to_premium_callback(call: CallbackQuery):
    """Go back to premium status screen"""
    await call.answer()
    from main import cmd_premium
    await cmd_premium(call.message)
