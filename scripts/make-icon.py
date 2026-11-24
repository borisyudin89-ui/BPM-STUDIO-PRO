# Рисует иконку приложения: графитовая плитка и надпись BPM (как у DROP) -> build/icon.png, icon.ico, icon.icns
# Каждый размер рисуется заново с нуля, а не уменьшается из большого.
import io, struct, os
from PIL import Image, ImageDraw, ImageFont

BG = (0x1A, 0x1C, 0x1F, 255)
LINE = (0x3A, 0x40, 0x48, 255)
BLUE = (0x7A, 0x9C, 0xC6, 255)
MUTED = (0x6A, 0x72, 0x7C, 255)
FONT = os.environ.get('ICON_FONT', '/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf')
FONT_SUB = os.environ.get('ICON_FONT_SUB', '/usr/share/fonts/opentype/inter/Inter-SemiBold.otf')

def render(n):
    S = n * 4
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    m = S * 4 / 512                      # плитка почти на весь холст
    r = S * 113 / 512
    d.rounded_rectangle([m, m, S - m - 1, S - m - 1], r, fill=LINE)
    b = max(2, S * 2.5 / 512)
    d.rounded_rectangle([m + b, m + b, S - m - 1 - b, S - m - 1 - b], r - b, fill=BG)
    sub = n >= 48
    # BPM: подбираем размер шрифта под ширину ~76% плитки
    target = S * 0.76
    f = ImageFont.truetype(FONT, 100)
    w = d.textlength('BPM', font=f)
    f = ImageFont.truetype(FONT, int(100 * target / w))
    cy = S * (0.45 if sub else 0.5)
    d.text((S / 2, cy), 'BPM', font=f, fill=BLUE, anchor='mm')
    if sub:
        fs = ImageFont.truetype(FONT_SUB, max(8, int(S * 0.062)))
        txt = 'S T U D I O   P R O'
        d.text((S / 2, S * 0.70), txt, font=fs, fill=MUTED, anchor='mm')
    return im.resize((n, n), Image.LANCZOS)

def png_bytes(n):
    buf = io.BytesIO(); render(n).save(buf, 'PNG', optimize=True); return buf.getvalue()

cache = {}
def P(n):
    if n not in cache: cache[n] = png_bytes(n)
    return cache[n]

def make_ico(sizes):
    head = struct.pack('<HHH', 0, 1, len(sizes))
    off = 6 + 16 * len(sizes); dirs = b''; data = b''
    for n in sizes:
        d = P(n)
        dirs += struct.pack('<BBBBHHII', n % 256, n % 256, 0, 0, 1, 32, len(d), off)
        off += len(d); data += d
    return head + dirs + data

def make_icns():
    types = [('icp4', 16), ('icp5', 32), ('icp6', 64), ('ic07', 128), ('ic08', 256), ('ic09', 512), ('ic10', 1024),
             ('ic11', 32), ('ic12', 64), ('ic13', 256), ('ic14', 512)]
    parts = b''.join(t.encode() + struct.pack('>I', len(P(n)) + 8) + P(n) for t, n in types)
    return b'icns' + struct.pack('>I', len(parts) + 8) + parts

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'build')
os.makedirs(out, exist_ok=True)
open(os.path.join(out, 'icon.png'), 'wb').write(P(1024))
open(os.path.join(out, 'icon.ico'), 'wb').write(make_ico([16, 20, 24, 32, 40, 48, 64, 128, 256]))
open(os.path.join(out, 'icon.icns'), 'wb').write(make_icns())
print('icons written to', out)
