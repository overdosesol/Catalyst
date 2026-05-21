"""
R6 polish 2026-05-21 — build new idle-pose sprite sheets from EvilCatPack.

Sources (numbered PNG frames in each dir, spritesheet.png skipped):
- Evil Cute Cat            → assets/cats/cat-cute.png      (sitting variant)
- Slim Evil Cat/HeadUp     → assets/cats/cat-headup.png    (sitting variant)
- Slim Evil Cat/StayTall   → assets/cats/cat-staytall.png  (sitting variant)
- Evil Lying Cat 2         → assets/cats/cat-lying.png     (lying pose)

Pipeline per animation:
  1. List numbered PNG frames (skip spritesheet.png).
  2. Subsample to target_frames so each loop has ~15-17 frames
     (matches existing cat-idle/lie/observe cadence).
  3. Compute unified bbox across all sampled frames (max extent).
  4. Crop every frame to that unified bbox (uniform per-frame size).
  5. Compose horizontal sheet: [frame0][frame1]...[frameN-1] concatenated.
  6. Save as PNG (RGBA, preserves transparency).

Each sprite sheet is then served via CSS `background-image` + `steps(N)`
animation that walks `background-position` from 0 to -sheet_width.
"""
import os
from PIL import Image

BASE = r'F:\.VibeCoding\Projects\Antigravity\Narrative Parser'
PACK = os.path.join(BASE, 'EvilCatPack')
OUT_DIR = os.path.join(BASE, 'assets', 'cats')

TARGETS = [
    # (output_name, source_subpath_segments, target_frame_count, skip_ranges)
    # skip_ranges: list of (start, end) inclusive frame-index ranges to drop
    # from the source pool BEFORE subsampling — used to exclude awkward
    # animation segments (e.g. lying cat's bad paw twitch in frames 15-27).
    ('cat-cute.png',     ['Evil Cute Cat'],                  15, []),
    ('cat-headup.png',   ['Slim Evil Cat', 'HeadUp'],        16, []),
    ('cat-staytall.png', ['Slim Evil Cat', 'StayTall'],      17, []),
    ('cat-lying.png',    ['Evil Lying Cat 2'],               17, [(15, 27)]),
]


def list_numbered_pngs(dir_path):
    """All *.png in dir EXCEPT 'spritesheet.png' (the asset-pack provided strip)."""
    files = sorted(
        f for f in os.listdir(dir_path)
        if f.lower().endswith('.png') and f.lower() != 'spritesheet.png'
    )
    return [os.path.join(dir_path, f) for f in files]


def subsample(items, n):
    """Pick n evenly-spaced items (including first; last may be skipped if step doesn't align)."""
    if len(items) <= n:
        return items
    step = len(items) / n
    return [items[int(i * step)] for i in range(n)]


def unified_bbox(images):
    """Union of all non-transparent bboxes across frames, so the cropped area
    holds every animation frame fully."""
    union = None
    for img in images:
        bb = img.getbbox()
        if bb is None:
            continue
        if union is None:
            union = bb
        else:
            union = (
                min(union[0], bb[0]),
                min(union[1], bb[1]),
                max(union[2], bb[2]),
                max(union[3], bb[3]),
            )
    return union


def build_sheet(frames, bbox):
    """Crop each frame to bbox, concatenate horizontally, return RGBA Image."""
    fw = bbox[2] - bbox[0]
    fh = bbox[3] - bbox[1]
    sheet = Image.new('RGBA', (fw * len(frames), fh), (0, 0, 0, 0))
    for i, frame in enumerate(frames):
        cropped = frame.crop(bbox)
        sheet.paste(cropped, (i * fw, 0))
    return sheet, (fw, fh)


def apply_skip_ranges(paths, skip_ranges):
    """Drop frames at indices inside any (start, end) inclusive range.
    Indices refer to position in the sorted source list (before subsampling)."""
    if not skip_ranges:
        return paths
    keep = []
    for i, p in enumerate(paths):
        skipped = any(start <= i <= end for (start, end) in skip_ranges)
        if not skipped:
            keep.append(p)
    return keep


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    summary = []
    for out_name, segments, target_n, skip_ranges in TARGETS:
        src_dir = os.path.join(PACK, *segments)
        paths = list_numbered_pngs(src_dir)
        paths_after_skip = apply_skip_ranges(paths, skip_ranges)
        sampled_paths = subsample(paths_after_skip, target_n)
        frames = [Image.open(p).convert('RGBA') for p in sampled_paths]
        bbox = unified_bbox(frames)
        if bbox is None:
            print(f'!! {out_name}: all frames empty, skipping')
            continue
        sheet, (fw, fh) = build_sheet(frames, bbox)
        out_path = os.path.join(OUT_DIR, out_name)
        sheet.save(out_path)
        sheet_w, sheet_h = sheet.size
        summary.append({
            'name': out_name,
            'src_count': len(paths),
            'after_skip_count': len(paths_after_skip),
            'sampled_count': len(frames),
            'frame_wh': (fw, fh),
            'sheet_wh': (sheet_w, sheet_h),
            'scaled_15x_frame': (round(fw * 1.15), round(fh * 1.15)),
            'scaled_15x_sheet': (round(sheet_w * 1.15), round(sheet_h * 1.15)),
        })

    print()
    print('=' * 76)
    print('Built sprite sheets (source -> sampled -> per-frame WxH -> sheet WxH):')
    print('=' * 76)
    for s in summary:
        print(f"  {s['name']}")
        print(f"    src={s['src_count']} -> after_skip={s['after_skip_count']} -> sampled={s['sampled_count']} frames")
        print(f"    frame {s['frame_wh'][0]}x{s['frame_wh'][1]}  "
              f"-> 1.15x = {s['scaled_15x_frame'][0]}x{s['scaled_15x_frame'][1]}")
        print(f"    sheet {s['sheet_wh'][0]}x{s['sheet_wh'][1]}  "
              f"-> 1.15x = {s['scaled_15x_sheet'][0]}x{s['scaled_15x_sheet'][1]}")
    print()
    print('CSS template per pose (replace placeholders):')
    print('  background-image: url(/assets/cats/<NAME>?v=${this._catSpritesVersion});')
    print('  background-size:  <SHEET_W_SCALED>px <SHEET_H_SCALED>px;')
    print('  width:  <FRAME_W_SCALED>px;')
    print('  height: <FRAME_H_SCALED>px;')
    print('  animation: <KEYFRAME> <DURATION>s steps(<SAMPLED_COUNT>) infinite;')


if __name__ == '__main__':
    main()
