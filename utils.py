# ===================================================
# FILE: utils.py
# SHARED UTILITY FUNCTIONS FOR Y.I.T.I.O BOT
# ===================================================

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
        # We'll import logging only when needed to avoid circular imports
        import logging
        logging.getLogger("yitio_bot").error(f"Error parsing initData: {e}")
    return None
