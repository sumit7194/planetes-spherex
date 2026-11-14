"""Draw the slow-mover yardstick's field lists (dev + null) with a fixed seed, BEFORE any injection
or scoring. Seed and rules are in notes/SLOWMOVER_YARDSTICK_PLAN.md; the output's sha256 is written
there too."""
import csv,hashlib,json,struct,sys,numpy as np,healpy as hp
from astropy.coordinates import SkyCoord, GeocentricTrueEcliptic
import astropy.units as u
SEED=20261114
R='/Users/sumit/Github/SpaceAppChallenge/'
excl=[]
for path in ['/Users/sumit/Github/SphereXVision/prereg/patches.csv','/Users/sumit/Github/SphereXVision/runs/qr3/wt/prereg/patches.csv']:
    for row in csv.DictReader(open(path)): excl.append((row['patch'],float(row['ra']),float(row['dec'])))
excl+= [('D-1',28.67,10.87),('CF-1',31.83,-47.34)]  # Physics, 14 Nov (D-1dr/drB sit at D-1)
targets=[(269.446,4.768),(133.760,-7.243),(331.097,-56.801),(76.956,30.401),(248.167,66.755)]
b=open(R+'public/data/coverage/dr1qr3/weekly.bin','rb').read(); nside,W,npix=struct.unpack('<III',b[4:16])
cov=np.frombuffer(b,'<u2',W*npix,16).reshape(W,npix)>0
passes=np.zeros(npix,int)
for p in range(npix):
    ks=np.nonzero(cov[:,p])[0]; n=0; last=-99
    for k in ks:
        if k-last>6: n+=1
        last=k
    passes[p]=n
def sep(ra1,de1,ra2,de2):
    r=np.radians; return np.degrees(np.arccos(np.clip(np.sin(r(de1))*np.sin(r(de2))+np.cos(r(de1))*np.cos(r(de2))*np.cos(r(ra1-ra2)),-1,1)))
rng=np.random.default_rng(SEED); chosen=[]
def ok(ra,de):
    c=SkyCoord(ra=ra*u.deg,dec=de*u.deg)
    if abs(c.galactic.b.deg)<10: return False
    if abs(c.transform_to(GeocentricTrueEcliptic()).lat.deg)>74: return False
    if passes[hp.ang2pix(nside,ra,de,nest=True,lonlat=True)]<2: return False
    if any(sep(ra,de,a,d)<1.0 for _,a,d in excl): return False
    if any(sep(ra,de,a,d)<1.0 for a,d in targets): return False
    if any(sep(ra,de,a,d)<2.0 for _,a,d in chosen): return False
    return True
while len(chosen)<240:
    ra=rng.uniform(0,360); de=np.degrees(np.arcsin(rng.uniform(-1,1)))
    if ok(ra,de): chosen.append((f'F{len(chosen)+1:03d}',round(ra,4),round(de,4)))
dev=[dict(field=f'Y-{i+1:02d}',ra=r,dec=d) for i,(_,r,d) in enumerate(chosen[:40])]
null=[dict(field=f'YN-{i+1:03d}',ra=r,dec=d) for i,(_,r,d) in enumerate(chosen[40:])]
for name,lst in (('dev',dev),('null',null)):
    txt=json.dumps(lst,separators=(',',':'))
    open(R+f'prereg/slowmover/fields_{name}.json','w').write(txt)
    print(name,len(lst),'sha256',hashlib.sha256(txt.encode()).hexdigest())
print('excluded patches',len(excl))
