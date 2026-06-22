#!/usr/bin/env python3
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "assets" / "real-demo-en.gif"
ADMIN = ROOT / "public" / "screenshots" / "en-admin-onboarding.jpg"
MOBILE = ROOT / "public" / "screenshots" / "en-mobile-device.jpg"
REMOTE = ROOT / "public" / "screenshots" / "en-connection-tunnel-vpn.jpg"

W, H = 900, 1200


def font(size, bold=False):
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/SFNS.ttf",
        "/Library/Fonts/Arial.ttf",
    ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size)
        except Exception:
            pass
    return ImageFont.load_default()


FONT = {
    "tiny": font(20),
    "small": font(24),
    "body": font(30),
    "body_bold": font(30, True),
    "title": font(44, True),
    "hero": font(54, True),
}


def rounded(draw, box, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def text(draw, xy, value, fill, f, max_width=None, line_gap=8):
    x, y = xy
    if max_width is None:
        draw.text((x, y), value, fill=fill, font=f)
        return y + draw.textbbox((x, y), value, font=f)[3] - draw.textbbox((x, y), value, font=f)[1]

    words = value.split(" ")
    lines = []
    current = ""
    for word in words:
        trial = word if not current else f"{current} {word}"
        if draw.textlength(trial, font=f) <= max_width:
            current = trial
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    for line in lines:
        draw.text((x, y), line, fill=fill, font=f)
        bbox = draw.textbbox((x, y), line, font=f)
        y += (bbox[3] - bbox[1]) + line_gap
    return y


def cover_image(path, size):
    image = Image.open(path).convert("RGB")
    iw, ih = image.size
    sw, sh = size
    scale = max(sw / iw, sh / ih)
    resized = image.resize((int(iw * scale), int(ih * scale)), Image.Resampling.LANCZOS)
    left = (resized.width - sw) // 2
    top = (resized.height - sh) // 2
    return resized.crop((left, top, left + sw, top + sh))


def paste_card(base, image, box, radius=26):
    x1, y1, x2, y2 = box
    shadow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle((x1 + 8, y1 + 12, x2 + 8, y2 + 12), radius=radius, fill=(0, 0, 0, 75))
    shadow = shadow.filter(ImageFilter.GaussianBlur(14))
    base.alpha_composite(shadow)
    mask = Image.new("L", (x2 - x1, y2 - y1), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle((0, 0, x2 - x1, y2 - y1), radius=radius, fill=255)
    base.paste(image.convert("RGBA"), (x1, y1), mask)
    d = ImageDraw.Draw(base)
    d.rounded_rectangle(box, radius=radius, outline=(52, 211, 153, 110), width=2)


def background():
    base = Image.new("RGBA", (W, H), "#08111f")
    d = ImageDraw.Draw(base)
    for y in range(H):
        r = int(7 + 14 * y / H)
        g = int(17 + 20 * y / H)
        b = int(31 + 45 * y / H)
        d.line([(0, y), (W, y)], fill=(r, g, b))
    d.ellipse((-190, -160, 450, 380), fill=(20, 184, 166, 34))
    d.ellipse((520, 80, 1040, 560), fill=(59, 130, 246, 28))
    d.ellipse((420, 760, 1060, 1400), fill=(16, 185, 129, 24))
    return base


def header(d, subtitle):
    d.text((52, 46), "LifeOS AI", fill="#ECFEFF", font=FONT["hero"])
    d.text((54, 116), "Personal AI assistant that runs from your own computer", fill="#A7F3D0", font=FONT["small"])
    rounded(d, (52, 168, 306, 210), 21, "#0F766E", "#5EEAD4", 1)
    d.text((74, 177), subtitle, fill="#F0FDFA", font=FONT["tiny"])


def chat_bubble(d, y, role, message, accent="#22D3EE"):
    x1, x2 = (52, 848) if role == "user" else (52, 848)
    fill = "#102033" if role == "user" else "#132C28"
    outline = "#334155" if role == "user" else "#10B981"
    rounded(d, (x1, y, x2, y + 118), 26, fill, outline, 1)
    d.text((x1 + 26, y + 18), role.upper(), fill=accent, font=FONT["tiny"])
    text(d, (x1 + 26, y + 54), message, "#F8FAFC", FONT["body_bold"] if role == "user" else FONT["body"], max_width=720, line_gap=7)


def frame(stage):
    base = background()
    d = ImageDraw.Draw(base)
    header(d, ["Local memory", "Ask", "Recall", "Act", "Ship"][min(stage, 4)])

    if stage <= 1:
        admin = cover_image(ADMIN, (796, 448))
        paste_card(base, admin, (52, 260, 848, 708))
        prompt = "What am I forgetting?"
        visible = prompt[: int(len(prompt) * (0.45 if stage == 0 else 1))]
        chat_bubble(d, 768, "user", visible, "#67E8F9")
        rounded(d, (52, 930, 848, 1070), 28, "#0F172A", "#334155", 1)
        d.text((82, 960), "The assistant reads your local vault and remembers context.", fill="#CBD5E1", font=FONT["small"])
        d.text((82, 1004), "No cloud notebook migration. No manual database setup.", fill="#94A3B8", font=FONT["small"])
    elif stage == 2:
        chat_bubble(d, 258, "user", "What am I forgetting?", "#67E8F9")
        chat_bubble(d, 410, "assistant", "You mentioned shipping the GitHub release today. The missing pieces are the Windows package, the release notes, and the phone pairing check.", "#6EE7B7")
        rounded(d, (52, 620, 848, 890), 30, "#0B1F33", "#38BDF8", 1)
        d.text((86, 650), "Evidence from your local LifeOS vault", fill="#E0F2FE", font=FONT["body_bold"])
        bullets = [
            "release-check report from yesterday",
            "desktop packaging notes",
            "remote phone connection checklist",
        ]
        y = 710
        for item in bullets:
            d.text((88, y), "✓", fill="#34D399", font=FONT["body_bold"])
            d.text((126, y), item, fill="#CBD5E1", font=FONT["small"])
            y += 48
        d.text((88, 834), "The answer is grounded in files on your machine.", fill="#7DD3FC", font=FONT["small"])
    elif stage == 3:
        remote = cover_image(REMOTE, (796, 448))
        paste_card(base, remote, (52, 246, 848, 694))
        rounded(d, (52, 750, 848, 1035), 30, "#122033", "#22C55E", 1)
        d.text((86, 784), "Use it away from home", fill="#ECFEFF", font=FONT["title"])
        rows = [
            ("LAN", "same Wi-Fi"),
            ("Tailscale VPN", "stable private remote access"),
            ("Cloudflare Tunnel", "HTTPS public tunnel"),
            ("QR code", "generated from the best reachable URL"),
        ]
        y = 862
        for label, detail in rows:
            d.text((88, y), label, fill="#A7F3D0", font=FONT["body_bold"])
            d.text((306, y), detail, fill="#CBD5E1", font=FONT["body"])
            y += 48
    else:
        mobile = cover_image(MOBILE, (314, 680))
        paste_card(base, mobile, (52, 252, 366, 932), 30)
        rounded(d, (400, 252, 848, 932), 30, "#111827", "#38BDF8", 1)
        d.text((430, 292), "Generate a program", fill="#F8FAFC", font=FONT["title"])
        text(d, (430, 364), "When you need budgeting, planning, lookup, forms, check-ins, calculations, or workflow panels, LifeOS can generate a runnable program for the current problem.", "#CBD5E1", FONT["small"], max_width=362, line_gap=9)
        y = 614
        for label in ["HTML", "CSS", "JS", "offline-first"]:
            rounded(d, (430, y, 730, y + 48), 18, "#0F766E", "#5EEAD4", 1)
            d.text((454, y + 11), label, fill="#ECFEFF", font=FONT["small"])
            y += 62
        d.text((430, 852), "Keep debugging it with AI until it works.", fill="#A7F3D0", font=FONT["small"])

    d.text((52, 1132), "Local-first • AI-native • Remote-ready • Open source", fill="#93C5FD", font=FONT["small"])
    return base.convert("P", palette=Image.Palette.ADAPTIVE, colors=128)


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    frames = []
    durations = []
    for stage, hold in [(0, 420), (1, 760), (2, 1350), (3, 1350), (4, 1500)]:
        frames.append(frame(stage))
        durations.append(hold)
    frames[0].save(
        OUT,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        optimize=True,
        disposal=2,
    )
    print(f"Generated {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
