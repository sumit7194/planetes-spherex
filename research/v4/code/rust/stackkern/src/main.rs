//! Linear-stack track search for the v0 detector (smo.detect.v0), std only.
//!
//! Reproduces, to floating-point rounding, the Python reference `smo.detect.v0._stack` and the
//! two searches built on it:
//!   mode 0 (grid):  for each seed (xi, eta, t), every motion in the grid; the anchor at t0 is
//!                   seed - v * t. Output per seed: best nu and the index of the first motion
//!                   reaching it (numpy argmax convention).
//!   mode 1 (local): for each (anchor, velocity), the sub-pixel grid of anchor offsets (P x P)
//!                   and velocity offsets (R x R), in numpy meshgrid 'ij' order over
//!                   (ax, ay, vx, vy). Output per candidate: the index of the first maximum.
//!
//! Per frame, a plane position (xi, eta) maps to pixels by the cubic polynomial of
//! smo.detect.maps.PlaneMap (terms a^i b^j, i = 0..3, j = 0..3-i, in that order), then the frame
//! shift (dx, dy). Z is a cubic B-spline of prefiltered coefficients (scipy spline_filter,
//! mode 'nearest'; evaluation clamps coefficient indices, as map_coordinates mode 'nearest'),
//! valid only if the bilinear interpolation of the finite-mask exceeds 0.999.
//!
//! I/O: little-endian binary files, layout documented in smo/detect/kernel.py.

use std::env;
use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Write};

struct Frame {
    ny: usize,
    nx: usize,
    dx: f64,
    dy: f64,
    tau: f64,
    s: f64,
    p: f64,
    cx: [f64; 10],
    cy: [f64; 10],
    coef: Vec<f64>,
    mask: Vec<f64>,
}

struct In<R: Read> {
    r: R,
}

impl<R: Read> In<R> {
    fn u32(&mut self) -> u32 {
        let mut b = [0u8; 4];
        self.r.read_exact(&mut b).expect("read u32");
        u32::from_le_bytes(b)
    }
    fn u64(&mut self) -> u64 {
        let mut b = [0u8; 8];
        self.r.read_exact(&mut b).expect("read u64");
        u64::from_le_bytes(b)
    }
    fn f64(&mut self) -> f64 {
        let mut b = [0u8; 8];
        self.r.read_exact(&mut b).expect("read f64");
        f64::from_le_bytes(b)
    }
    fn f64s(&mut self, n: usize) -> Vec<f64> {
        let mut buf = vec![0u8; n * 8];
        self.r.read_exact(&mut buf).expect("read f64 array");
        buf.chunks_exact(8).map(|c| f64::from_le_bytes(c.try_into().unwrap())).collect()
    }
}

#[inline]
fn bspline3(t: f64) -> f64 {
    let t = t.abs();
    if t < 1.0 {
        2.0 / 3.0 - t * t + t * t * t / 2.0
    } else if t < 2.0 {
        let u = 2.0 - t;
        u * u * u / 6.0
    } else {
        0.0
    }
}

impl Frame {
    #[inline]
    fn poly(&self, c: &[f64; 10], a: f64, b: f64) -> f64 {
        // Terms in smo.detect.maps._poly_terms order: (i, j) for i in 0..=3, j in 0..=3-i.
        let mut acc = 0.0;
        let mut k = 0;
        let mut ai = 1.0;
        for i in 0..=3 {
            let mut bj = 1.0;
            for _j in 0..=(3 - i) {
                acc += ai * bj * c[k];
                bj *= b;
                k += 1;
            }
            ai *= a;
        }
        acc
    }

    /// Z at a plane position, or None where the Python reference gives NaN.
    #[inline]
    fn z_at(&self, xi: f64, eta: f64) -> Option<f64> {
        let a = xi / self.s;
        let b = eta / self.s;
        let x = self.poly(&self.cx, a, b) * self.p + self.dx;
        let y = self.poly(&self.cy, a, b) * self.p + self.dy;
        let (nxf, nyf) = ((self.nx - 1) as f64, (self.ny - 1) as f64);
        if !(x >= 0.0 && x <= nxf && y >= 0.0 && y <= nyf) {
            return None;
        }
        // Bilinear mask (map_coordinates order 1, mode 'constant', cval 0).
        let (ix, iy) = (x.floor() as isize, y.floor() as isize);
        let (fx, fy) = (x - ix as f64, y - iy as f64);
        let mut m = 0.0;
        for (dj, wy) in [(0isize, 1.0 - fy), (1, fy)] {
            for (di, wx) in [(0isize, 1.0 - fx), (1, fx)] {
                let (j, i) = (iy + dj, ix + di);
                let v = if j >= 0 && (j as usize) < self.ny && i >= 0 && (i as usize) < self.nx {
                    self.mask[j as usize * self.nx + i as usize]
                } else {
                    0.0
                };
                m += wy * wx * v;
            }
        }
        if !(m > 0.999) {
            return None;
        }
        // Cubic B-spline, coefficient indices clamped (mode 'nearest').
        let mut acc = 0.0;
        for j in (iy - 1)..=(iy + 2) {
            let wy = bspline3(y - j as f64);
            let jj = j.clamp(0, self.ny as isize - 1) as usize;
            let mut row = 0.0;
            for i in (ix - 1)..=(ix + 2) {
                let ii = i.clamp(0, self.nx as isize - 1) as usize;
                row += self.coef[jj * self.nx + ii] * bspline3(x - i as f64);
            }
            acc += row * wy;
        }
        Some(acc)
    }
}

fn stack(frames: &[Frame], ax: f64, ay: f64, vx: f64, vy: f64) -> f64 {
    let (mut num, mut cnt) = (0.0f64, 0.0f64);
    for f in frames {
        if let Some(z) = f.z_at(ax + vx * f.tau, ay + vy * f.tau) {
            num += z;
            cnt += 1.0;
        }
    }
    if cnt > 0.0 {
        num / cnt.sqrt()
    } else {
        f64::NEG_INFINITY
    }
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() != 4 {
        eprintln!("usage: stackkern <input.bin> <output.bin> <threads>");
        std::process::exit(2);
    }
    let threads: usize = args[3].parse().expect("threads");
    let mut inp = In { r: BufReader::new(File::open(&args[1]).expect("open input")) };
    assert_eq!(inp.u32(), 0x534b_4e31, "bad magic"); // "SKN1"
    let mode = inp.u32();
    let nf = inp.u32() as usize;
    let mut frames = Vec::with_capacity(nf);
    for _ in 0..nf {
        let ny = inp.u32() as usize;
        let nx = inp.u32() as usize;
        let (dx, dy, tau, s, p) = (inp.f64(), inp.f64(), inp.f64(), inp.f64(), inp.f64());
        let cx: [f64; 10] = inp.f64s(10).try_into().unwrap();
        let cy: [f64; 10] = inp.f64s(10).try_into().unwrap();
        let coef = inp.f64s(ny * nx);
        let mask = inp.f64s(ny * nx);
        frames.push(Frame { ny, nx, dx, dy, tau, s, p, cx, cy, coef, mask });
    }
    let mut out = BufWriter::new(File::create(&args[2]).expect("open output"));
    match mode {
        0 => {
            let ns = inp.u64() as usize;
            let nm = inp.u64() as usize;
            let seeds = inp.f64s(ns * 3);
            let motions = inp.f64s(nm * 2);
            let mut best = vec![(f64::NEG_INFINITY, 0u64); ns];
            let chunk = ns.div_ceil(threads.max(1)).max(1);
            std::thread::scope(|sc| {
                for (ci, part) in best.chunks_mut(chunk).enumerate() {
                    let (frames, seeds, motions) = (&frames, &seeds, &motions);
                    sc.spawn(move || {
                        for (k, slot) in part.iter_mut().enumerate() {
                            let i = ci * chunk + k;
                            let (sx, sy, st) = (seeds[3 * i], seeds[3 * i + 1], seeds[3 * i + 2]);
                            let mut bv = f64::NEG_INFINITY;
                            let mut bk = 0u64;
                            for m in 0..nm {
                                let (vx, vy) = (motions[2 * m], motions[2 * m + 1]);
                                let nu = stack(frames, sx - vx * st, sy - vy * st, vx, vy);
                                if nu > bv {
                                    bv = nu;
                                    bk = m as u64;
                                }
                            }
                            *slot = (bv, bk);
                        }
                    });
                }
            });
            for (v, k) in best {
                out.write_all(&v.to_le_bytes()).unwrap();
                out.write_all(&k.to_le_bytes()).unwrap();
            }
        }
        1 => {
            let nc = inp.u64() as usize;
            let np = inp.u64() as usize;
            let nr = inp.u64() as usize;
            let cands = inp.f64s(nc * 4);
            let pos = inp.f64s(np);
            let rate = inp.f64s(nr);
            let mut best = vec![(f64::NEG_INFINITY, 0u64); nc];
            let chunk = nc.div_ceil(threads.max(1)).max(1);
            std::thread::scope(|sc| {
                for (ci, part) in best.chunks_mut(chunk).enumerate() {
                    let (frames, cands, pos, rate) = (&frames, &cands, &pos, &rate);
                    sc.spawn(move || {
                        for (k, slot) in part.iter_mut().enumerate() {
                            let i = ci * chunk + k;
                            let (ax, ay, vx, vy) = (cands[4 * i], cands[4 * i + 1], cands[4 * i + 2], cands[4 * i + 3]);
                            let mut bv = f64::NEG_INFINITY;
                            let mut bk = 0u64;
                            let mut idx = 0u64;
                            for &ox in pos.iter() {
                                for &oy in pos.iter() {
                                    for &ux in rate.iter() {
                                        for &uy in rate.iter() {
                                            let nu = stack(frames, ax + ox, ay + oy, vx + ux, vy + uy);
                                            if nu > bv {
                                                bv = nu;
                                                bk = idx;
                                            }
                                            idx += 1;
                                        }
                                    }
                                }
                            }
                            *slot = (bv, bk);
                        }
                    });
                }
            });
            for (v, k) in best {
                out.write_all(&v.to_le_bytes()).unwrap();
                out.write_all(&k.to_le_bytes()).unwrap();
            }
        }
        _ => panic!("unknown mode {mode}"),
    }
}
