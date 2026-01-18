# ===================================================
# FILE: shared.py
# SHARED VARIABLES FOR Y.I.T.I.O BOT
# ===================================================

import os
import sys
import logging
from typing import Optional

from aiogram import Bot, Dispatcher
from aiogram.fsm.storage.memory import MemoryStorage
from supabase import create_client, Client  # <-- FIXED IMPORT

# Add current directory to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# ==================== CONFIG ====================
# Load environment variables
BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
ADMIN_ID = int(os.environ.get("ADMIN_ID", 0) or 0)
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
PROVIDER_TOKEN = os.environ.get("PROVIDER_TOKEN", "")
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")
WEBHOOK_SECRET_TOKEN = os.environ.get("WEBHOOK_SECRET_TOKEN", "YOUR_WEBHOOK_SECRET")
WEBHOOK_URL = os.environ.get("WEBHOOK_URL", "")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("yitio_bot")

# Initialize Bot and Dispatcher
bot = Bot(token=BOT_TOKEN) if BOT_TOKEN else None
dp = Dispatcher(storage=MemoryStorage()) if BOT_TOKEN else None

# Initialize Supabase if credentials exist
supabase: Optional[Client] = None
if SUPABASE_URL and SUPABASE_KEY:
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)  # <-- Now this will work
        logger.info("✅ Supabase connected successfully")
    except Exception as e:
        logger.error(f"❌ Failed to connect to Supabase: {e}")
        supabase = None

# Global pinger instance
_pinger = None
