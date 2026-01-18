# ===================================================
# FILE: utils.py
# SHARED UTILITY FUNCTIONS FOR Y.I.F.I.O BOT
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
        elif platform == "Facebook":
            if "facebook.com/watch/" in url:
                return url.split("watch/")[1].split("?")[0]
            elif "facebook.com/" in url and "/videos/" in url:
                parts = url.split("/videos/")
                if len(parts) > 1:
                    return parts[1].split("/")[0].split("?")[0]
            elif "fb.watch/" in url:
                return url.split("fb.watch/")[1].split("?")[0]
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
        return f"https://www.youtube.com/embed/{video_id}?autoplay=1"
    elif platform == "Facebook":
        # Facebook embed URLs work differently
        if "facebook.com/watch/" in url:
            return f"https://www.facebook.com/plugins/video.php?href={url}&show_text=0&autoplay=1"
        elif "fb.watch/" in url:
            return f"https://www.facebook.com/plugins/video.php?href=https://www.facebook.com/watch/?v={video_id}&show_text=0&autoplay=1"
        else:
            return f"https://www.facebook.com/plugins/video.php?href={url}&show_text=0&autoplay=1"
    elif platform == "Instagram":
        return f"https://www.instagram.com/p/{video_id}/embed/?autoplay=1"
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
        logging.getLogger("yifio_bot").error(f"Error parsing initData: {e}")
    return None
