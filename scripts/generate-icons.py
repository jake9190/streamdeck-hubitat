"""Generate Stream Deck action icons (288x288 RGBA) for the toggle switch types.

Produces on (green), off (red) and unknown (gray) variants for each type:
  - fan
  - audio (speaker; off = muted, on = sound waves)
  - camera
  - printer (3D printer)

Run from the repo root:  python scripts/generate-icons.py
"""

import math
import os

from PIL import Image, ImageDraw

SIZE = 288
OUT_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "com.jake.hubitat.sdPlugin",
    "imgs",
)

# State colors (match the existing light_* icons).
COLORS = {
    "green": (0, 230, 0, 255),
    "red": (235, 0, 0, 255),
    "gray": (120, 120, 120, 255),
}

# Content is drawn in the upper-middle region, centered at (CX, CY),
# leaving room for a label below (matches the existing light icons).
CX, CY = 144, 110


def new_canvas():
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)


def save(img, name):
    img.save(os.path.join(OUT_DIR, f"{name}.png"))
    print(f"wrote {name}.png")


def rotated_layer(draw_fn, angle):
    """Draw on a transparent SIZE layer, rotate around center, return the layer."""
    layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    draw_fn(d)
    return layer.rotate(angle, center=(CX, CY), resample=Image.BICUBIC)


# --- Fan ---------------------------------------------------------------------

def make_fan(color):
    img, _ = new_canvas()
    blade_len = 92
    for i in range(4):
        angle = i * 90

        def draw_blade(d):
            # Teardrop blade pointing up from the hub.
            d.ellipse(
                [CX - 30, CY - blade_len, CX + 14, CY - 14],
                fill=color,
            )

        img = Image.alpha_composite(img, rotated_layer(draw_blade, angle))
    d = ImageDraw.Draw(img)
    d.ellipse([CX - 22, CY - 22, CX + 22, CY + 22], fill=color)
    d.ellipse([CX - 8, CY - 8, CX + 8, CY + 8], fill=(0, 0, 0, 255))
    return img


# --- Audio speaker -----------------------------------------------------------

def speaker_body(d, color):
    # Square back of the speaker.
    d.rectangle([CX - 78, CY - 28, CX - 40, CY + 28], fill=color)
    # Trapezoid cone out to the right.
    d.polygon(
        [
            (CX - 40, CY - 28),
            (CX - 4, CY - 64),
            (CX - 4, CY + 64),
            (CX - 40, CY + 28),
        ],
        fill=color,
    )


def make_audio(color, waves):
    img, d = new_canvas()
    speaker_body(d, color)
    if waves:
        for i, r in enumerate((24, 48, 72)):
            bbox = [CX + 6 - r, CY - r, CX + 6 + r, CY + r]
            d.arc(bbox, start=-45, end=45, fill=color, width=9)
    else:
        # Muted: a small "x" to the right of the cone.
        x0 = CX + 26
        d.line([x0, CY - 18, x0 + 32, CY + 18], fill=color, width=9)
        d.line([x0, CY + 18, x0 + 32, CY - 18], fill=color, width=9)
    return img


# --- Camera ------------------------------------------------------------------

def make_camera(color):
    img, d = new_canvas()
    # Viewfinder bump on top.
    d.rectangle([CX - 30, CY - 58, CX + 6, CY - 36], fill=color)
    # Body.
    d.rounded_rectangle([CX - 80, CY - 38, CX + 80, CY + 52], radius=16, fill=color)
    # Lens (outer ring + black inner).
    d.ellipse([CX - 34, CY - 24, CX + 34, CY + 44], fill=(0, 0, 0, 255))
    d.ellipse([CX - 26, CY - 16, CX + 26, CY + 36], fill=color)
    d.ellipse([CX - 12, CY - 2, CX + 12, CY + 22], fill=(0, 0, 0, 255))
    # Flash.
    d.rectangle([CX + 52, CY - 26, CX + 70, CY - 14], fill=(0, 0, 0, 255))
    return img


# --- 3D Printer --------------------------------------------------------------

def make_printer(color):
    img, d = new_canvas()
    left, right = CX - 76, CX + 76
    top, bottom = CY - 70, CY + 70
    t = 12
    # Outer gantry frame.
    d.rectangle([left, top, left + t, bottom], fill=color)
    d.rectangle([right - t, top, right, bottom], fill=color)
    d.rectangle([left, top, right, top + t], fill=color)
    # Print bed.
    d.rectangle([left + 6, bottom - t, right - 6, bottom], fill=color)
    # X carriage bar.
    bar_y = CY + 4
    d.rectangle([left, bar_y - 7, right, bar_y + 7], fill=color)
    # Print head / nozzle.
    d.rectangle([CX - 18, bar_y + 7, CX + 18, bar_y + 30], fill=color)
    d.polygon(
        [(CX - 18, bar_y + 30), (CX + 18, bar_y + 30), (CX, bar_y + 46)],
        fill=color,
    )
    return img


def main():
    for state, color in COLORS.items():
        save(make_fan(color), f"fan_{state}")
        save(make_camera(color), f"camera_{state}")
        save(make_printer(color), f"printer_{state}")
        # Audio: "on" (green) shows sound waves; off/unknown are muted.
        save(make_audio(color, waves=(state == "green")), f"audio_{state}")


if __name__ == "__main__":
    main()
