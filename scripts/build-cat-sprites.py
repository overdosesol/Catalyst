"""Build 3 sprite sheets for the Catalyst cat mascot from EvilCatPack frames."""
from PIL import Image
import os
import shutil

ROOT = r"F:\.VibeCoding\Projects\Antigravity\Narrative Parser"
OUT_DIR = os.path.join(ROOT, "assets", "cats")
os.makedirs(OUT_DIR, exist_ok=True)


def kb(path):
    return round(os.path.getsize(path) / 1024, 2)


def report(label, path, frame_count):
    img = Image.open(path)
    w, h = img.size
    print(f"\n[{label}]")
    print(f"  Path:        {path}")
    print(f"  Dimensions:  {w} x {h}")
    print(f"  Frame count: {frame_count}")
    print(f"  Frame width: {w // frame_count} (W/frames = {w / frame_count})")
    print(f"  Frame height:{h}")
    print(f"  File size:   {kb(path)} KB")


# ---------- 1. IDLE ----------
idle_src = os.path.join(ROOT, "EvilCatPack", "Evil Black Cat", "spritesheet.png")
idle_dst = os.path.join(OUT_DIR, "cat-idle.png")
shutil.copy2(idle_src, idle_dst)
idle_img = Image.open(idle_dst)
print(f"IDLE source dims: {idle_img.size}")
IDLE_FRAMES = 16  # known from prior tile count
report("IDLE", idle_dst, IDLE_FRAMES)


# ---------- 2. WALK ----------
walk_src_dir = os.path.join(ROOT, "EvilCatPack", "Evil Cat Walking")
walk_dst = os.path.join(OUT_DIR, "cat-walk.png")

walk_indices = list(range(0, 128, 8))  # 0..120 step 8 -> 16 frames
walk_frames = []
for i in walk_indices:
    fname = f"EvilWalkingCat_{i:05d}.png"
    fpath = os.path.join(walk_src_dir, fname)
    img = Image.open(fpath).convert("RGBA")
    walk_frames.append(img)

w, h = walk_frames[0].size
print(f"\nWALK frame dims: {w} x {h} (count={len(walk_frames)})")
sheet = Image.new("RGBA", (w * len(walk_frames), h), (0, 0, 0, 0))
for idx, f in enumerate(walk_frames):
    sheet.paste(f, (idx * w, 0), f)
sheet.save(walk_dst, "PNG")
report("WALK", walk_dst, len(walk_frames))


# ---------- 3. LIE ----------
lie_src_dir = os.path.join(ROOT, "EvilCatPack", "Evil Lying Cat 1")
lie_dst = os.path.join(OUT_DIR, "cat-lie.png")

lie_indices = list(range(0, 97, 6))  # 0..96 step 6 -> 17 frames
lie_frames = []
for i in lie_indices:
    fname = f"Lying1_{i:05d}.png"
    fpath = os.path.join(lie_src_dir, fname)
    img = Image.open(fpath).convert("RGBA")
    lie_frames.append(img)

w, h = lie_frames[0].size
print(f"\nLIE frame dims: {w} x {h} (count={len(lie_frames)})")
sheet = Image.new("RGBA", (w * len(lie_frames), h), (0, 0, 0, 0))
for idx, f in enumerate(lie_frames):
    sheet.paste(f, (idx * w, 0), f)
sheet.save(lie_dst, "PNG")
report("LIE", lie_dst, len(lie_frames))

print("\n--- DONE ---")
