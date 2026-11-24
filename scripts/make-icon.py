# Рисует иконку: объёмная синяя плитка, белые буквы BPM и STUDIO PRO (как у DROP) -> build/icon.png, icon.ico, icon.icns
# Каждый размер рисуется заново с нуля. Запуск: python3 scripts/make-icon.py (нужны Pillow и numpy)
import io, os, struct
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
BK='/usr/share/fonts/opentype/inter/InterDisplay-Black.otf'; EB='/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf'; SB='/usr/share/fonts/opentype/inter/Inter-SemiBold.otf'
def hx(h): h=h.lstrip('#'); return np.array([int(h[i:i+2],16) for i in (0,2,4)],float)
def squircle(S,m,nexp=5.0):
    yy,xx=np.mgrid[0:S,0:S]; c=(S-1)/2; a=(S/2-m)
    v=(np.abs(xx-c)/a)**nexp+(np.abs(yy-c)/a)**nexp
    return (v<=1).astype(np.uint8)*255
def blur(a,r): return np.asarray(Image.fromarray(a.astype('uint8') if a.dtype!=np.uint8 else a).filter(ImageFilter.GaussianBlur(r)),float)
def render(n,c1,c2,sub=True):
    S=n*4; m=S*0.055
    mask=squircle(S,m); mf=mask/255.0
    yy,xx=np.mgrid[0:S,0:S]/ S if False else (None,None)
    gy,gx=np.mgrid[0:S,0:S]; gx=gx/S; gy=gy/S
    t=np.clip((gx*0.45+gy*0.9)/1.35,0,1)[...,None]
    base=c1*(1-t)+c2*t
    # мягкий блик в левом верхнем углу
    d=np.sqrt((gx-0.26)**2+(gy-0.14)**2)
    hl=np.clip(1-d/0.55,0,1)**1.6*0.30
    base=base+(255-base)*hl[...,None]
    # затемнение низа
    base=base*(1-0.10*np.clip((gy-0.6)/0.4,0,1)[...,None])
    # светлая кромка сверху и тёмная снизу
    sh=max(1,int(S*0.006))
    down=np.roll(mf,sh,axis=0); up=np.roll(mf,-sh,axis=0)
    rim_top=np.clip(mf-down,0,1); rim_bot=np.clip(mf-up,0,1)
    base=base+(255-base)*(rim_top*0.35)[...,None]
    base=base*(1-0.25*rim_bot[...,None])
    tile=np.dstack([np.clip(base,0,255),mask]).astype('uint8')
    out=Image.new('RGBA',(S,S),(0,0,0,0))
    # тень плитки
    so=blur(mask,S*0.022)*0.38; so=np.roll(so,int(S*0.018),axis=0)
    shadow=np.zeros((S,S,4),np.uint8); shadow[...,:3]=(c2*0.35).astype('uint8'); shadow[...,3]=so.astype('uint8')
    out=Image.alpha_composite(out,Image.fromarray(shadow,'RGBA'))
    out=Image.alpha_composite(out,Image.fromarray(tile,'RGBA'))
    # надпись
    D=ImageDraw.Draw(out)
    f=ImageFont.truetype(BK,100); w=D.textlength('BPM',font=f)
    f=ImageFont.truetype(BK,int(100*S*0.62/w))
    cy=S*(0.455 if sub else 0.5)
    tm=Image.new('L',(S,S),0); ImageDraw.Draw(tm).text((S/2,cy),'BPM',font=f,fill=255,anchor='mm')
    ta=np.asarray(tm,float)
    tsh=np.roll(blur(ta,S*0.010),int(S*0.012),axis=0)*0.34
    sha=np.zeros((S,S,4),np.uint8); sha[...,:3]=(c2*0.25).astype('uint8'); sha[...,3]=tsh.astype('uint8')
    out=Image.alpha_composite(out,Image.fromarray(sha,'RGBA'))
    g=(gy)[...,None]; wcol=(255*(1-0.0)+0*g)*np.ones((S,S,3)); wcol=np.array([255,255,255.])*(1-0.10*np.clip((gy-0.35)/0.25,0,1))[...,None]+c1*0.0
    wcol=wcol+ (c1-255)*0.00
    lt=np.dstack([np.clip(wcol,0,255),ta]).astype('uint8')
    out=Image.alpha_composite(out,Image.fromarray(lt,'RGBA'))
    if sub:
        fs=ImageFont.truetype(SB,max(8,int(S*0.052)))
        txt='STUDIO PRO'; sp=S*0.018
        wtot=sum(D.textlength(ch,font=fs) for ch in txt)+sp*(len(txt)-1)
        x=S/2-wtot/2; layer=Image.new('RGBA',(S,S),(0,0,0,0)); ld=ImageDraw.Draw(layer)
        for ch in txt:
            ld.text((x,S*0.645),ch,font=fs,fill=(255,255,255,205),anchor='ls'); x+=D.textlength(ch,font=fs)+sp
        out=Image.alpha_composite(out,layer)
    return out.resize((n,n),Image.LANCZOS)

C1, C2 = hx('93B7E3'), hx('3C5F8D')  # спокойный синий
cache = {}
def P(n):
    if n not in cache:
        buf = io.BytesIO(); render(n, C1, C2, sub=n >= 64).save(buf, 'PNG', optimize=True); cache[n] = buf.getvalue()
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
