"""Spectral twins v3: draw the 60 fields (48 open + 12 locked) with a fixed seed, BEFORE any of
their photos are read. Rules: notes/SPECTRAL_TWINS_V3_PLAN.md section 2 (frozen 14 Nov 2026).

Strata: 3 ecliptic-latitude bands |beta| [0,20), [20,45), [45,90] x 2 galactic bands |b| [0,20),
[20,90]; 10 fields per cell, uniform on the sphere within the cell. In each cell the LAST 2 drawn
are locked. Every field: >= 2 survey passes in DR1 + QR3 (coverage cell), > 1 deg from the five
targets, every SphereXVision patch (both copies + D-1, CF-1) and the slow-mover yardstick's 240
fields, and >= 2 deg from every other v3 field.
"""
import csv, hashlib, json, struct
import healpy as hp
import numpy as np
from astropy.coordinates import GeocentricTrueEcliptic, SkyCoord
import astropy.units as u

SEED = 2026111403
R = '/Users/sumit/Github/SpaceAppChallenge/'
excl = []
for path in ['/Users/sumit/Github/SphereXVision/prereg/patches.csv', '/Users/sumit/Github/SphereXVision/runs/qr3/wt/prereg/patches.csv']:
    for row in csv.DictReader(open(path)):
        excl.append((float(row['ra']), float(row['dec'])))
excl += [(28.67, 10.87), (31.83, -47.34)]
excl += [(269.446, 4.768), (133.760, -7.243), (331.097, -56.801), (76.956, 30.401), (248.167, 66.755)]
for name in ('dev', 'null'):
    excl += [(f['ra'], f['dec']) for f in json.load(open(R + f'prereg/slowmover/fields_{name}.json'))]
b = open(R + 'public/data/coverage/dr1qr3/weekly.bin', 'rb').read()
nside, W, npix = struct.unpack('<III', b[4:16])
cov = np.frombuffer(b, '<u2', W * npix, 16).reshape(W, npix) > 0
passes = np.zeros(npix, int)
for p in range(npix):
    n, last = 0, -99
    for k in np.nonzero(cov[:, p])[0]:
        if k - last > 6:
            n += 1
        last = k
    passes[p] = n


def sep(ra1, de1, ra2, de2):
    r = np.radians
    return np.degrees(np.arccos(np.clip(np.sin(r(de1)) * np.sin(r(de2)) + np.cos(r(de1)) * np.cos(r(de2)) * np.cos(r(ra1 - ra2)), -1, 1)))


EB = [(0, 20), (20, 45), (45, 90.1)]
GB = [(0, 20), (20, 90.1)]
rng = np.random.default_rng(SEED)
cells = {(i, j): [] for i in range(3) for j in range(2)}
chosen = []
tries = 0
while any(len(v) < 10 for v in cells.values()):
    tries += 1
    ra = rng.uniform(0, 360)
    de = np.degrees(np.arcsin(rng.uniform(-1, 1)))
    c = SkyCoord(ra=ra * u.deg, dec=de * u.deg)
    beta = abs(c.transform_to(GeocentricTrueEcliptic()).lat.deg)
    gb = abs(c.galactic.b.deg)
    key = (next(i for i, (lo, hi) in enumerate(EB) if lo <= beta < hi), next(j for j, (lo, hi) in enumerate(GB) if lo <= gb < hi))
    if len(cells[key]) >= 10:
        continue
    if passes[hp.ang2pix(nside, ra, de, nest=True, lonlat=True)] < 2:
        continue
    if any(sep(ra, de, a, d) < 1.0 for a, d in excl) or any(sep(ra, de, f['ra'], f['dec']) < 2.0 for f in chosen):
        continue
    f = dict(ra=round(float(ra), 4), dec=round(float(de), 4), eclBand=list(EB[key[0]][:1]) + [min(90, EB[key[0]][1])],
             galBand=[GB[key[1]][0], min(90, GB[key[1]][1])])
    cells[key].append(f)
    chosen.append(f)
fields = []
for (i, j), lst in sorted(cells.items()):
    for k, f in enumerate(lst):
        fields.append(dict(field=f'TW-{i}{j}-{k + 1:02d}', locked=k >= 8, **f))
txt = json.dumps(fields, separators=(',', ':'))
open(R + 'prereg/twins_v3/fields.json', 'w').write(txt)
print(len(fields), 'fields,', sum(f['locked'] for f in fields), 'locked; draws', tries, '; sha256', hashlib.sha256(txt.encode()).hexdigest())
