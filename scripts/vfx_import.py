# VFX pack importer for the Roblox VFX Studio.
# Turns third-party frame sequences / sprite sheets / single particle textures into Roblox-ready flipbooks:
#   * square power-of-two atlases (1024 x 1024 max, Roblox's texture limit) on Grid4x4 (16 frames, 256 px cells)
#     or Grid8x8 (64 frames, 128 px cells), frames resampled in time, letterboxed (aspect kept), premultiply-safe alpha
#   * opaque black-background sources get alpha from brightness (so they work with LightEmission 0 and 1)
#   * pixel-art sources are scaled with nearest neighbour
# Writes assets/vfx/<pack>/<effect>/flipbook.png + thumb.png and assets/vfx/library.json (the catalog the AI reads).
# Usage (run with -I, sources are untrusted data):  python -I scripts/vfx_import.py <pack dir> [<pack dir> ...]
import sys, os, re, io, json, zipfile, hashlib
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'assets', 'vfx')
ATLAS = 1024

TAGS = {
    'fire': ['fire', 'flame', 'bonfire', 'torch', 'burner', 'magma', 'lava', 'dithered'],
    'explosion': ['explosion', 'kaboom', 'boom', 'blast'],
    'impact': ['impact', 'hit', 'bighit', 'smallhit', 'blood', 'scorch'],
    'magic': ['magic', 'anima', 'constellation', 'elden', 'vortex', 'portal', 'tentacle', 'worm', 'wheel', 'charged', 'charge', 'aura', 'star', 'wavy'],
    'electric': ['electric', 'lightning', 'shield', 'powerchord', 'spark'],
    'smoke': ['smoke', 'cloud', 'wispy', 'puff', 'dirt', 'dust'],
    'heal': ['heal'],
    'ui': ['quest', 'dizzy'],
    'nature': ['butterfly', 'firefl', 'leaves'],
    'speed': ['hyperspeed', 'lightstreak', 'streak', 'slash', 'trace', 'trail', 'muzzle'],
    'light': ['light', 'flare', 'circle', 'glow', 'twirl', 'window', 'symbol', 'effect'],
}
# Emitter settings that suit each category; the AI starts from these and tunes per effect.
SUGGEST = {
    'fire': {'lightEmission': 1, 'lightInfluence': 0, 'mode': 'Loop', 'kind': 'loop'},
    'explosion': {'lightEmission': 1, 'lightInfluence': 0, 'mode': 'OneShot', 'kind': 'burst'},
    'impact': {'lightEmission': 0.6, 'lightInfluence': 0, 'mode': 'OneShot', 'kind': 'burst'},
    'magic': {'lightEmission': 1, 'lightInfluence': 0, 'mode': 'Loop', 'kind': 'loop'},
    'electric': {'lightEmission': 1, 'lightInfluence': 0, 'mode': 'Loop', 'kind': 'loop'},
    'smoke': {'lightEmission': 0, 'lightInfluence': 1, 'mode': 'OneShot', 'kind': 'loop'},
    'heal': {'lightEmission': 1, 'lightInfluence': 0, 'mode': 'Loop', 'kind': 'loop'},
    'ui': {'lightEmission': 0, 'lightInfluence': 0, 'mode': 'Loop', 'kind': 'loop'},
    'nature': {'lightEmission': 0, 'lightInfluence': 1, 'mode': 'Loop', 'kind': 'loop'},
    'speed': {'lightEmission': 1, 'lightInfluence': 0, 'mode': 'OneShot', 'kind': 'burst'},
    'light': {'lightEmission': 1, 'lightInfluence': 0, 'mode': 'Loop', 'kind': 'loop'},
}

def slug(s):
    s = re.sub(r'([a-z])([A-Z])', r'\1-\2', s)
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')

def numkey(p):
    m = re.findall(r'\d+', os.path.basename(p))
    return (int(m[-1]) if m else 0, p)

def tags_for(name):
    n = name.lower().replace('-', '').replace('_', '')
    found = [t for t, words in TAGS.items() if any(w in n for w in words)]
    return found or ['misc']

def alpha_from_luma(im):
    """Black-background RGB → straight alpha (brightness), colors un-premultiplied."""
    import numpy as np
    rgb = np.asarray(im.convert('RGB')).astype(np.float32); a = rgb.max(axis=2)
    col = np.where(a[..., None] > 0, rgb * 255.0 / np.maximum(a[..., None], 1), 255)  # fully transparent texels stay white
    return Image.fromarray(np.dstack([np.clip(col, 0, 255), a]).astype(np.uint8), 'RGBA')

def is_opaque(im):
    if im.mode != 'RGBA': return True
    lo, hi = im.getchannel('A').getextrema()
    return lo > 250

def fit_cell(frame, cell, pixel):
    frame = frame.convert('RGBA'); w, h = frame.size; k = min(cell / w, cell / h)
    nw, nh = max(1, round(w * k)), max(1, round(h * k))
    # resample in premultiplied space (RGBa), otherwise transparent black bleeds into the edges and smoke turns grey
    frame = frame.convert('RGBa').resize((nw, nh), Image.NEAREST if pixel else Image.LANCZOS).convert('RGBA')
    c = Image.new('RGBA', (cell, cell), (0, 0, 0, 0)); c.paste(frame, ((cell - nw) // 2, (cell - nh) // 2)); return c

def build(frames, pixel):
    """frames: list of RGBA images → (atlas, layout, grid, used)."""
    big = max(max(f.size) for f in frames)
    grid = 8 if (big <= 160 or len(frames) > 40) else 4
    count, cell = grid * grid, ATLAS // grid
    idx = [min(len(frames) - 1, int(i * len(frames) / count)) for i in range(count)]
    atlas = Image.new('RGBA', (ATLAS, ATLAS), (0, 0, 0, 0))
    for i, fi in enumerate(idx):
        atlas.paste(fit_cell(frames[fi], cell, pixel), ((i % grid) * cell, (i // grid) * cell))
    return atlas, {4: 'Grid4x4', 8: 'Grid8x8'}[grid], grid

def split_sheet(im, cols, rows, count=None):
    w, h = im.size; fw, fh = w // cols, h // rows; out = []
    for r in range(rows):
        for c in range(cols):
            if count and len(out) >= count: return out
            fr = im.crop((c * fw, r * fh, (c + 1) * fw, (r + 1) * fh))
            if fr.getbbox(): out.append(fr)
    return out

def load_frames_dir(d):
    files = sorted([os.path.join(d, f) for f in os.listdir(d) if f.lower().endswith('.png')], key=numkey)
    return [Image.open(f).convert('RGBA') for f in files]

def load_frames_zip(z):
    with zipfile.ZipFile(z) as zf:
        names = sorted([n for n in zf.namelist() if n.lower().endswith('.png') and '__MACOSX' not in n], key=numkey)
        return [Image.open(io.BytesIO(zf.read(n))).convert('RGBA') for n in names], names

def frame_hash(frames):
    h = hashlib.sha1()
    for f in frames[:3]: h.update(f.resize((16, 16)).tobytes())
    return h.hexdigest()

catalog = {'about': 'Roblox VFX library (imported packs). Each flipbook is a 1024x1024 Roblox-ready atlas. Read Train/VfxTrain/TRAIN.md before using.', 'effects': [], 'particles': [], 'skipped': []}
seen = set()

def emit_effect(pack, name, frames, source, license_, fps=30, pixel=None, alpha_luma=False):
    if not frames: catalog['skipped'].append({'pack': pack, 'name': name, 'reason': 'no frames'}); return
    key = frame_hash(frames)
    if key in seen: catalog['skipped'].append({'pack': pack, 'name': name, 'reason': 'duplicate of an imported effect'}); return
    seen.add(key)
    if alpha_luma or is_opaque(frames[0]): frames = [alpha_from_luma(f) for f in frames]; alpha_luma = True
    if not alpha_luma and 'smoke' in tags_for(name):  # grey smoke art → white RGB so Roblox Color/LightInfluence tint it
        import numpy as np
        frames = [Image.fromarray(np.dstack([np.full(np.asarray(f).shape[:2] + (3,), 255, np.uint8), np.asarray(f)[..., 3]]), 'RGBA') for f in frames]
    pixel = pixel if pixel is not None else max(frames[0].size) <= 128
    atlas, layout, grid = build(frames, pixel)
    sid = slug(name); d = os.path.join(OUT, pack, sid); os.makedirs(d, exist_ok=True)
    atlas.save(os.path.join(d, 'flipbook.png'), optimize=True)
    mid = frames[len(frames) // 2]; th = fit_cell(mid, 128, pixel); th.save(os.path.join(d, 'thumb.png'))
    tags = tags_for(name); duration = round(len(frames) / fps, 3)
    sug = dict(SUGGEST.get(tags[0], SUGGEST['light']))
    sug.update({'flipbookLayout': layout, 'flipbookFramerate': round(grid * grid / duration, 2), 'lifetime': duration})
    catalog['effects'].append({
        'id': f'{pack}/{sid}', 'pack': pack, 'name': name, 'tags': tags, 'kind': 'flipbook',
        'texture': f'assets/vfx/{pack}/{sid}/flipbook.png', 'thumb': f'assets/vfx/{pack}/{sid}/thumb.png',
        'layout': layout, 'grid': grid, 'frames': grid * grid, 'sourceFrames': len(frames), 'sourceFps': fps,
        'sourceSize': list(frames[0].size), 'pixelArt': pixel, 'alphaFromLuminance': alpha_luma,
        'duration': duration, 'suggest': sug, 'license': license_, 'source': source, 'robloxReady': True,
    })
    print(f'  + {pack}/{sid}: {len(frames)} frames -> {layout}')

def emit_particle(pack, path, license_):
    im = Image.open(path)
    alpha_luma = im.mode != 'RGBA' or is_opaque(im.convert('RGBA'))
    im = alpha_from_luma(im) if alpha_luma else im.convert('RGBA')
    if max(im.size) > 512: im = im.convert('RGBa'); im.thumbnail((512, 512), Image.LANCZOS); im = im.convert('RGBA')
    name = re.sub(r'_a$', '', os.path.splitext(os.path.basename(path))[0]); sid = slug(name)
    d = os.path.join(OUT, pack, 'particles'); os.makedirs(d, exist_ok=True); im.save(os.path.join(d, sid + '.png'), optimize=True)
    catalog['particles'].append({'id': f'{pack}/particles/{sid}', 'pack': pack, 'name': name, 'tags': tags_for(name), 'kind': 'particle',
                                 'texture': f'assets/vfx/{pack}/particles/{sid}.png', 'size': list(im.size), 'alphaFromLuminance': alpha_luma, 'license': license_, 'robloxReady': True})

def import_pack(src):
    pack = slug(os.path.basename(os.path.normpath(src)))
    print(f'Pack {pack}: {src}')
    # Brackeys-style bundle (CC0): flipbooks/ (name_8x8.tga), predrawn/ (name_6x5.png), particles/alpha/*.png
    for bundle, dirs, files in os.walk(src):
        if '__MACOSX' in bundle: continue
        lic_file = next((f for f in files if 'license' in f.lower()), None)
        if lic_file and os.path.isdir(os.path.join(bundle, 'flipbooks')):
            lic = 'CC0 (Brackeys VFX bundle: Picster, Kenney, Thomas Iche, CodeManu)'
            for sub, pixel in (('flipbooks', False), ('predrawn', None)):
                p = os.path.join(bundle, sub)
                if not os.path.isdir(p): continue
                for f in sorted(os.listdir(p)):
                    m = re.match(r'(.+?)_(\d+)x(\d+)\.(png|tga)$', f, re.I)
                    if not m: continue
                    im = Image.open(os.path.join(p, f))
                    frames = split_sheet(im.convert('RGBA') if im.mode == 'RGBA' else im.convert('RGB'), int(m.group(2)), int(m.group(3)))
                    frames = [fr.convert('RGBA') if fr.mode == 'RGBA' else fr for fr in frames]
                    emit_effect(pack, m.group(1), frames, f'{os.path.basename(src)}/{sub}/{f}', lic, fps=30, pixel=pixel, alpha_luma=im.mode != 'RGBA')
            pa = os.path.join(bundle, 'particles', 'alpha')
            if os.path.isdir(pa):
                for f in sorted(os.listdir(pa)):
                    if f.lower().endswith('.png'): emit_particle(pack, os.path.join(pa, f), lic)
            return
    entries = sorted(os.listdir(src))
    # CodeManu-style: Effect_X/30fps/Frames/<sub>/*.png
    if any(os.path.isdir(os.path.join(src, e, '30fps', 'Frames')) for e in entries):
        lic = 'CodeManu VFX Free Pack (itch.io); the same art ships under CC0 in the Brackeys VFX bundle (credits: CodeManu)'
        for e in entries:
            fdir = os.path.join(src, e, '30fps', 'Frames')
            if not os.path.isdir(fdir): continue
            for sub in sorted(os.listdir(fdir)):
                emit_effect(pack, re.sub(r'^Effect_', '', e) + ('' if sub.endswith('_1') else '-' + sub), load_frames_dir(os.path.join(fdir, sub)), f'{os.path.basename(src)}/{e}/30fps/Frames/{sub}', lic, fps=30)
        return
    # Plain folders of numbered frames (+ zips of the same)
    lic = 'Unknown (no license file in the pack) - verify the source before commercial use'
    for e in entries:
        p = os.path.join(src, e)
        if os.path.isdir(p):
            fr = load_frames_dir(p)
            if fr: emit_effect(pack, e, fr, f'{os.path.basename(src)}/{e}/', lic, fps=24)
            else: catalog['skipped'].append({'pack': pack, 'name': e, 'reason': 'empty folder'})
    for e in entries:
        if e.lower().endswith('.zip'):
            fr, _ = load_frames_zip(os.path.join(src, e))
            emit_effect(pack, os.path.splitext(e)[0], fr, f'{os.path.basename(src)}/{e}', lic, fps=24)

if __name__ == '__main__':
    if len(sys.argv) < 2: sys.exit('Usage: python -I scripts/vfx_import.py <pack dir> [...]')
    os.makedirs(OUT, exist_ok=True)
    for src in sys.argv[1:]: import_pack(src)
    for e in catalog['effects']:  # stable order: pack, name
        pass
    catalog['effects'].sort(key=lambda e: e['id']); catalog['particles'].sort(key=lambda e: e['id'])
    with open(os.path.join(OUT, 'library.json'), 'w', encoding='utf-8') as f: json.dump(catalog, f, indent=1)
    print(f"{len(catalog['effects'])} flipbooks, {len(catalog['particles'])} particle textures, {len(catalog['skipped'])} skipped -> assets/vfx/library.json")
