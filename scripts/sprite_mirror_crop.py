"""One-shot: mirror cat sprite sheets horizontally (per-frame, preserving order)
and crop transparent top/bottom padding. Width/frame-count math preserved.

Run once after deploy R6 to fix cat direction + idle floating-in-air issue.
"""
from PIL import Image
import os

PROJ = r"F:\.VibeCoding\Projects\Antigravity\Narrative Parser"
sprites = [
    ("cat-idle.png",    15),
    ("cat-walk.png",    16),
    ("cat-lie.png",     17),
    ("cat-observe.png", 17),
]

for fname, n_frames in sprites:
    path = os.path.join(PROJ, "assets", "cats", fname)
    img = Image.open(path).convert("RGBA")
    w, h = img.size
    frame_w = w // n_frames
    orig_size = os.path.getsize(path)

    # Step 1: Mirror each frame individually, keep frame order so animation plays forward.
    new = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for i in range(n_frames):
        frame = img.crop((i * frame_w, 0, (i + 1) * frame_w, h))
        flipped = frame.transpose(Image.FLIP_LEFT_RIGHT)
        new.paste(flipped, (i * frame_w, 0), flipped)
    img = new

    # Step 2: Find top/bottom transparent padding uniform across the sheet.
    bbox = img.getbbox()  # (left, top, right, bottom) of non-empty pixels
    if bbox:
        top, bottom = bbox[1], bbox[3]
        if top > 0 or bottom < h:
            img = img.crop((0, top, w, bottom))

    img.save(path, "PNG", optimize=True)
    new_w, new_h = img.size
    new_size = os.path.getsize(path)
    print(f"{fname}: {w}x{h} -> {new_w}x{new_h}, frame {new_w // n_frames}x{new_h}, "
          f"{orig_size} -> {new_size} bytes")
