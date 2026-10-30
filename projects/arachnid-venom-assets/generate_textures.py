from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT=Path(__file__).resolve().parent
S=1024
rng=np.random.default_rng(478216)
y,x=np.mgrid[0:S,0:S].astype(np.float32)/S

def noise(n):
    a=rng.random((n,n)).astype(np.float32)
    # Wrap the coarse tile around both axes before bicubic resampling.
    a=np.tile(a,(3,3))
    z=Image.fromarray(a,'F').resize((S*3,S*3),Image.Resampling.BICUBIC)
    return np.asarray(z,dtype=np.float32)[S:S*2,S:S*2]

def fbm():
    return sum(noise(n)*w for n,w in [(4,.40),(8,.25),(16,.16),(32,.10),(64,.06),(128,.03)])

def save(name,a):
    if a.ndim==2: a=np.stack((a,a,a),-1)
    im=Image.fromarray(np.uint8(np.clip(a,0,1)*255),'RGB')
    im.save(OUT/name,optimize=True)
    return im

def normal(h,strength=2):
    dx=(np.roll(h,-1,1)-np.roll(h,1,1))*strength
    dy=(np.roll(h,-1,0)-np.roll(h,1,0))*strength
    n=np.stack((-dx,dy,np.ones_like(dx)),-1)
    n/=np.linalg.norm(n,axis=-1,keepdims=True)
    return n*.5+.5

def periodic_voronoi(count,yscale=1):
    d1=np.full((S,S),100,np.float32)
    d2=d1.copy()
    ids=np.zeros((S,S),np.float32)
    for i in range(count):
        px,py=rng.random(2)
        dx=np.abs(x-px);dx=np.minimum(dx,1-dx)
        dy=np.abs(y-py);dy=np.minimum(dy,1-dy)*yscale
        d=np.sqrt(dx*dx+dy*dy)
        closer=d<d1
        d2=np.where(closer,d1,np.minimum(d2,d))
        ids=np.where(closer,rng.uniform(.65,1.15),ids)
        d1=np.minimum(d1,d)
    return d1,d2,ids

macro=fbm()
fine=noise(190)
warp=noise(10)
wave=(np.sin((x*48+(macro-.5)*3+np.sin(y*6.283)*.8)*6.283)*.5+.5)**5
micro=(np.sin((x*203+warp*7)*6.283)*.5+.5)**15

# Hand-directed chitin stress cracks and shallow polished scratches.
fissure=Image.new('L',(S,S));d=ImageDraw.Draw(fissure)
scratch=Image.new('L',(S,S));ds=ImageDraw.Draw(scratch)
for n in range(22):
    px=float(rng.uniform(0,S));py=float(rng.uniform(0,S))
    points=[(px,py)]
    for j in range(int(rng.integers(3,9))):
        px+=float(rng.normal(10,16));py+=float(rng.uniform(10,37))
        points.append((px,py))
    for tx in [-S,0,S]:
        for ty in [-S,0,S]:
            d.line([(a+tx,b+ty) for a,b in points],fill=int(rng.integers(90,185)),width=2)
    if n%2==0:
        bx,by=points[len(points)//2]
        d.line([(bx,by),(bx+18,by+4),(bx+35,by-15)],fill=100,width=1)
for n in range(220):
    px,py=rng.uniform(0,S,2);l=rng.uniform(4,42)
    ds.line([(px,py),(px+l*.25,py-l)],fill=int(rng.integers(20,140)),width=int(rng.choice([1,1,1,2])))
crack=np.asarray(fissure.filter(ImageFilter.GaussianBlur(.5)),np.float32)/255
sc=np.asarray(scratch.filter(ImageFilter.GaussianBlur(.4)),np.float32)/255
chit=np.clip(.46+(macro-.5)*.56+wave*.095+micro*.014+(fine-.5)*.045-crack*.20+sc*.07,0,1)
navy=np.array([.075,.117,.151])[None,None,:]
blue=np.array([.17,.25,.30])[None,None,:]
color=navy+(blue-navy)*(macro[...,None]*1.15)
color+=wave[...,None]*np.array([.013,.024,.032])
color-=crack[...,None]*np.array([.055,.066,.068])
color+=sc[...,None]*np.array([.24,.17,.09])
color+=(fine[...,None]-.5)*.012
save('armor_basecolor.png',color)
save('armor_normal.png',normal(chit,10))
save('armor_roughness.png',.40+(macro-.5)*.21+crack*.17-sc*.19)
save('armor_metallic.png',.78+sc*.18-crack*.21+(macro-.5)*.08)
save('armor_height.png',chit)

# Closed rounded venom cells, translucent-looking viscous cores, cyan capillaries.
d1,d2,ids=periodic_voronoi(64,.83)
gap=d2-d1
wall=np.exp(-gap*230)
edge=np.exp(-gap*90)
center=np.exp(-(d1/.055)**2)
membrane=np.clip(.3+center*.21+(macro-.5)*.18-wall*.12,0,1)
cell=np.clip((1-edge*.85)*(.60+.35*center)*ids,0,1)
venom=np.stack((.045+cell*.19,.12+cell*.65,.095+cell*.16),-1)
cyan=np.clip((macro-.50)*4,0,1)*(1-wall)
venom=venom*(1-cyan[...,None]*.65)+np.array([.02,.65,.53])*cyan[...,None]*.65
# Tiny immersed gas pearls give depth through specular/normal detail.
bubbles=Image.new('L',(S,S));db=ImageDraw.Draw(bubbles)
for i in range(155):
    px,py=rng.uniform(0,S,2);r=float(rng.uniform(1.8,9))
    db.ellipse((px-r,py-r,px+r,py+r),outline=int(rng.integers(70,170)),width=1)
bub=np.asarray(bubbles.filter(ImageFilter.GaussianBlur(.65)),np.float32)/255
venom+=bub[...,None]*np.array([.09,.17,.12])
membrane+=bub*.15+(fine-.5)*.006
emission=venom*np.array([.80,1.03,.85])
emission*=((1-wall*.65)*.8+.2)[...,None]
save('venom_basecolor.png',venom)
save('venom_normal.png',normal(membrane,7))
save('venom_roughness.png',.23+wall*.15+(macro-.5)*.08)
save('venom_metallic.png',np.full((S,S),.12,np.float32))
save('venom_emissive.png',emission)
mask=np.clip(emission[...,1],0,1)
Image.fromarray(np.uint8(mask*255),'L').save(OUT/'venom_emissive_mask.png',optimize=True)
for name in ['armor_roughness','armor_metallic','armor_height','venom_roughness','venom_metallic']:
    image=Image.open(OUT/(name+'.png')).convert('L')
    image.save(OUT/(name+'.png'),optimize=True)

# Compact contact sheet for material review.
names=['armor_basecolor','armor_normal','armor_roughness','armor_metallic','venom_basecolor','venom_normal','venom_roughness','venom_emissive']
sheet=Image.new('RGB',(1280,720),(15,20,26));dd=ImageDraw.Draw(sheet)
for i,name in enumerate(names):
    xx=(i%4)*320+12;yy=(i//4)*360+10
    sheet.paste(Image.open(OUT/(name+'.png')).resize((296,296)),(xx,yy))
    dd.text((xx,yy+307),name,fill=(198,214,218))
sheet.save(OUT/'material_contact_sheet.jpg',quality=92)
print('Generated 10 PBR maps, 1 height reference, material review contact sheet:',OUT)

