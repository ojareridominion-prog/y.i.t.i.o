# ===================================================
# FILE: ping.py
# AUTO-PING SERVICE FOR RENDER
# ===================================================

import asyncio
import logging
import aiohttp
import os
from datetime import datetime
from typing import Optional

logger = logging.getLogger("yitio_bot")

class RenderPinger:
    """Auto-pinger to keep Render service awake"""
    
    def __init__(self, ping_url: str, interval_minutes: int = 8):
        self.ping_url = ping_url
        self.interval = interval_minutes * 60  # Convert to seconds
        self.is_running = False
        self.task: Optional[asyncio.Task] = None
        
    async def ping(self):
        """Perform a single ping request"""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(self.ping_url, timeout=10) as response:
                    logger.info(f"🌐 Ping to {self.ping_url} - Status: {response.status}")
                    return response.status
        except aiohttp.ClientError as e:
            logger.warning(f"⚠️ Ping failed: {e}")
            return None
        except Exception as e:
            logger.error(f"❌ Unexpected ping error: {e}")
            return None
    
    async def start(self):
        """Start the pinger service"""
        if self.is_running:
            logger.warning("Pinger already running")
            return
            
        self.is_running = True
        logger.info(f"🚀 Starting pinger for {self.ping_url} every {self.interval/60} minutes")
        
        # Perform initial ping immediately
        await self.ping()
        
        # Start the periodic pinging task
        self.task = asyncio.create_task(self._ping_loop())
    
    async def _ping_loop(self):
        """Main pinging loop"""
        while self.is_running:
            await asyncio.sleep(self.interval)
            if self.is_running:
                await self.ping()
    
    async def stop(self):
        """Stop the pinger service"""
        self.is_running = False
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
        logger.info("🛑 Pinger stopped")

async def setup_pinger():
    """Setup the auto-pinger service"""
    from shared import _pinger, logger, WEBHOOK_URL
    
    # Don't run pinger if disabled
    if os.environ.get("DISABLE_PINGER", "").lower() == "true":
        logger.info("⚠️ Auto-pinger disabled by DISABLE_PINGER environment variable")
        return None
    
    try:
        # Get the correct URL for pinging
        webhook_url = WEBHOOK_URL
        if not webhook_url:
            # Auto-detect Render URL
            service_name = os.environ.get("RENDER_SERVICE_NAME", "")
            if service_name:
                webhook_url = f"https://{service_name}.onrender.com"
            else:
                # Try to detect current service
                render_url = os.environ.get("RENDER_EXTERNAL_URL", "")
                if render_url:
                    webhook_url = render_url
                else:
                    webhook_url = "https://yitio-bot.onrender.com"
        
        # Ensure we're pinging a valid endpoint
        ping_url = f"{webhook_url.rstrip('/')}/health"
        logger.info(f"🌐 Pinger will use URL: {ping_url}")
        
        # Create and start pinger
        pinger = RenderPinger(ping_url=ping_url, interval_minutes=8)
        await pinger.start()
        logger.info("✅ Auto-pinger started successfully")
        
        return pinger
        
    except Exception as e:
        logger.error(f"❌ Failed to start pinger: {e}")
        return None
