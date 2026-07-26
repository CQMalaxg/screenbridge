from pathlib import Path
import math

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
ASSETS.mkdir(parents=True, exist_ok=True)


def cubic_points(p0, p1, p2, p3, count=40):
    points = []
    for index in range(count + 1):
        t = index / count
        inverse = 1 - t
        points.append((
            inverse**3 * p0[0] + 3 * inverse**2 * t * p1[0] + 3 * inverse * t**2 * p2[0] + t**3 * p3[0],
            inverse**3 * p0[1] + 3 * inverse**2 * t * p1[1] + 3 * inverse * t**2 * p2[1] + t**3 * p3[1],
        ))
    return points


def make_icon(size=1024):
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    scale = size / 1024

    def box(values):
        return tuple(round(value * scale) for value in values)

    # Flat approximation of the SVG gradient, with a dark inset for small-size clarity.
    draw.rounded_rectangle(box((0, 0, 1024, 1024)), radius=round(224 * scale), fill="#7168F2")
    draw.rounded_rectangle(box((112, 112, 912, 912)), radius=round(184 * scale), fill="#151A2C")

    bridge = cubic_points((348, 447), (418, 255), (606, 255), (676, 447))
    draw.line([(round(x * scale), round(y * scale)) for x, y in bridge], fill="#F7F8FF", width=round(34 * scale), joint="curve")
    for x, y in ((348, 447), (676, 447)):
        draw.ellipse(box((x - 18, y - 18, x + 18, y + 18)), fill="#F7F8FF")

    draw.rounded_rectangle(box((168, 340, 450, 558)), radius=round(42 * scale), fill="#252952", outline="#928BFF", width=round(18 * scale))
    draw.rounded_rectangle(box((574, 340, 856, 558)), radius=round(42 * scale), fill="#3B2C48", outline="#FF9A78", width=round(18 * scale))

    for x, color in ((310, "#928BFF"), (714, "#FF9A78")):
        draw.line([box((x, 558)), box((x, 628))], fill="#F7F8FF", width=round(20 * scale))
        draw.line([box((x - 62, 628)), box((x + 62, 628))], fill=color, width=round(24 * scale))

    draw.rounded_rectangle(box((232, 405, 344, 427)), radius=round(11 * scale), fill="#BDB8FF")
    draw.rounded_rectangle(box((232, 455, 398, 473)), radius=round(9 * scale), fill="#7773C9")
    draw.ellipse(box((356, 398, 392, 434)), fill="#F7F8FF")
    draw.rounded_rectangle(box((638, 405, 750, 427)), radius=round(11 * scale), fill="#FFC0A9")
    draw.rounded_rectangle(box((638, 455, 804, 473)), radius=round(9 * scale), fill="#A96268")
    draw.ellipse(box((762, 398, 798, 434)), fill="#F7F8FF")
    return image


icon = make_icon()
icon.save(ASSETS / "icon.png", format="PNG", optimize=True)
icon.save(ASSETS / "icon.ico", format="ICO", sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
print(f"Generated {ASSETS / 'icon.png'}")
print(f"Generated {ASSETS / 'icon.ico'}")
