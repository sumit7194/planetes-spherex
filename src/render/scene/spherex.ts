/**
 * SPHEREx, modelled from its published dimensions and photos. There is no public 3D model, so
 * this is our own build, labelled "schematic": the parts, sizes, finishes and the way it points
 * are sourced; small fittings (brackets, connectors, blanket seams) are left out.
 *
 * Sources:
 * - JPL press kit, "Spacecraft": 2.6 m tall, 3.2 m across; three nested cone-shaped photon
 *   shields 1.7 m tall, 3.2 m across at the widest, aluminium honeycomb 19 mm thick, the outer
 *   cone's outside painted white; three V-groove radiators below the shields, each lower one a
 *   little wider; the telescope rests on them; the bus below; one fixed solar panel
 *   2.67 m × 1.02 m that almost always faces the Sun; two S-band antennas at the panel's ends,
 *   an S-band antenna and two cone-shaped Ka-band antennas on the bottom.
 * - Bock et al. 2025 (arXiv:2511.02985): a hexagonal bus; two star tracker heads; the outer
 *   size 3.2 m × 2.3 m; the telescope's line of sight is tipped 8° towards the solar panel from
 *   the shields' axis; a 20 cm aperture, gold-coated mirrors in an aluminium housing.
 * - Photos (NASA/JPL-Caltech PIA26537, PIA26543; artist's concept PIA26531): the proportions,
 *   the panel mounted on one face of the bus and hanging below it, the inner shields' rims
 *   lower and narrower than the outer one's.
 *
 * Units are metres. The model's axes: +Y along the shields' axis (out of the opening), +X the
 * solar panel's face (towards the Sun), the separation ring at y = 0.
 */
import {
  BackSide,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  RingGeometry,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';

const RAD = Math.PI / 180;

/** The line of sight is tipped this far from the shields' axis, towards the solar panel. */
export const BORESIGHT_TILT_DEG = 8;

/** The main sizes, metres (sourced above; inner shields and bus height read off the photos). */
export const SPHEREX_SIZE = {
  height: 2.6,
  shieldHeight: 1.7,
  shieldTopR: 1.6,
  shieldThick: 0.019,
  panel: { long: 2.67, short: 1.02 },
  aperture: 0.2,
} as const;

/** Each shield: base radius and height, top radius and height (outer first). */
const SHIELDS = [
  { r0: 0.64, y0: 0.86, r1: 1.6, y1: 2.56 },
  { r0: 0.54, y0: 0.92, r1: 1.27, y1: 2.5 },
  { r0: 0.44, y0: 0.98, r1: 1.0, y1: 2.44 },
] as const;

/** The V-groove radiators under the shields, top to bottom; each lower one a little wider. */
const VGROOVES = [
  { r: 0.56, y: 0.97 },
  { r: 0.66, y: 0.91 },
  { r: 0.74, y: 0.85 },
] as const;

const BUS = { r: 0.62, y0: 0.08, y1: 0.78 };
const APOTHEM = BUS.r * Math.cos(30 * RAD);

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) draw(g);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** The outer cone's white paint: panel seams down the cone, and a row of fittings at the rim. */
function shieldPaint() {
  return canvasTexture(2048, 512, (g) => {
    const grd = g.createLinearGradient(0, 0, 0, 512);
    grd.addColorStop(0, '#ebe9e4');
    grd.addColorStop(1, '#e2e0da');
    g.fillStyle = grd;
    g.fillRect(0, 0, 2048, 512);
    g.strokeStyle = 'rgba(120,118,112,0.55)';
    g.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const x = (i + 0.5) * 512;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, 512);
      g.stroke();
    }
    g.fillStyle = 'rgba(70,66,62,0.8)';
    for (let i = 0; i < 48; i++) g.fillRect(i * (2048 / 48) + 18, 26, 9, 9);
    for (let i = 0; i < 24; i++) g.fillRect(i * (2048 / 24) + 30, 300, 5, 5);
  });
}

/** Solar cells: a grid of dark cells with silver gaps, and a slightly lighter frame. */
function solarCells() {
  return canvasTexture(1024, 400, (g) => {
    g.fillStyle = '#b9bcc2';
    g.fillRect(0, 0, 1024, 400);
    const cols = 26;
    const rows = 10;
    const cw = (1024 - 16) / cols;
    const ch = (400 - 16) / rows;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const x = 8 + i * cw;
        const y = 8 + j * ch;
        const grd = g.createLinearGradient(x, y, x + cw, y + ch);
        grd.addColorStop(0, '#1b2236');
        grd.addColorStop(1, '#141a2b');
        g.fillStyle = grd;
        g.fillRect(x + 1.2, y + 1.2, cw - 2.4, ch - 2.4);
        g.fillStyle = 'rgba(150,160,180,0.25)';
        g.fillRect(x + 1.2, y + ch / 2 - 0.5, cw - 2.4, 1);
      }
    }
  });
}

/** Multi-layer insulation: crinkled foil, drawn as soft streaks over the base colour. */
function blanket(base: string, streak: string) {
  return canvasTexture(512, 512, (g) => {
    g.fillStyle = base;
    g.fillRect(0, 0, 512, 512);
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    g.strokeStyle = streak;
    for (let i = 0; i < 260; i++) {
      g.globalAlpha = 0.08 + rnd() * 0.18;
      g.lineWidth = 1 + rnd() * 3;
      const x = rnd() * 512;
      const y = rnd() * 512;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(
        x + (rnd() - 0.5) * 60,
        y + rnd() * 40,
        x + (rnd() - 0.5) * 90,
        y + 30 + rnd() * 70,
      );
      g.stroke();
    }
    g.globalAlpha = 1;
  });
}

/** An open cone between two radii, `y0` to `y1`, as a lathe of `segments`. */
function frustum(r0: number, y0: number, r1: number, y1: number, segments = 128) {
  const geo = new CylinderGeometry(r1, r0, y1 - y0, segments, 1, true);
  geo.translate(0, (y0 + y1) / 2, 0);
  return geo;
}

export class Spherex {
  /** The spacecraft, in metres, in its own axes (see the file header). */
  readonly group = new Group();
  /** The line of sight in the model's axes. */
  readonly boresight = new Vector3(
    Math.sin(BORESIGHT_TILT_DEG * RAD),
    Math.cos(BORESIGHT_TILT_DEG * RAD),
    0,
  );
  #disposables: (BufferGeometry | Material | CanvasTexture)[] = [];

  constructor() {
    const keep = <T extends BufferGeometry | Material | CanvasTexture>(x: T) => {
      this.#disposables.push(x);
      return x;
    };
    const add = (geo: BufferGeometry, mat: Material, at?: (m: Mesh) => void) => {
      const m = new Mesh(keep(geo), mat);
      m.castShadow = true;
      m.receiveShadow = true;
      at?.(m);
      this.group.add(m);
      return m;
    };

    // Finishes.
    const paint = keep(shieldPaint());
    const white = keep(new MeshStandardMaterial({ map: paint, roughness: 0.72, metalness: 0 }));
    const alu = keep(
      new MeshStandardMaterial({
        color: 0xd9dde2,
        roughness: 0.38,
        metalness: 1,
        side: DoubleSide,
      }),
    );
    const aluInside = keep(
      new MeshStandardMaterial({ color: 0xd4d8dd, roughness: 0.38, metalness: 1, side: BackSide }),
    );
    const mirror = keep(
      new MeshStandardMaterial({
        color: 0xe6e9ec,
        roughness: 0.06,
        metalness: 1,
        side: DoubleSide,
      }),
    );
    const silverMli = keep(
      new MeshStandardMaterial({
        map: keep(blanket('#c9ccd0', '#7d8288')),
        roughness: 0.42,
        metalness: 0.75,
      }),
    );
    const goldMli = keep(
      new MeshStandardMaterial({
        map: keep(blanket('#c79a3c', '#6d4c14')),
        roughness: 0.4,
        metalness: 0.85,
      }),
    );
    const darkBox = keep(
      new MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.6, metalness: 0.3 }),
    );
    const blackAnod = keep(
      new MeshStandardMaterial({ color: 0x15161a, roughness: 0.5, metalness: 0.4 }),
    );
    const gold = keep(new MeshStandardMaterial({ color: 0xf2c46b, roughness: 0.18, metalness: 1 }));
    const panelBack = keep(
      new MeshStandardMaterial({ color: 0xd8d6d0, roughness: 0.8, metalness: 0 }),
    );
    const cells = keep(
      new MeshStandardMaterial({ map: keep(solarCells()), roughness: 0.28, metalness: 0.35 }),
    );
    const brass = keep(
      new MeshStandardMaterial({ color: 0xb59a5a, roughness: 0.35, metalness: 1 }),
    );

    // The photon shields: the outer one white outside and bare aluminium inside, the inner two
    // bare aluminium; each with its rim, 19 mm thick.
    SHIELDS.forEach((s, i) => {
      const geo = frustum(s.r0, s.y0, s.r1, s.y1);
      if (i === 0) {
        add(geo, white);
        add(geo.clone(), aluInside);
      } else {
        add(geo, alu);
      }
      add(
        new RingGeometry(s.r1 - SPHEREX_SIZE.shieldThick, s.r1, 128),
        i === 0 ? white : alu,
        (m) => {
          m.rotation.x = -Math.PI / 2;
          m.position.y = s.y1;
        },
      );
    });

    // The V-groove radiators: mirror-finish shallow cones, like upturned umbrellas, stacked
    // under the shields with gaps between.
    for (const v of VGROOVES) {
      add(frustum(v.r * 0.25, v.y - 0.035, v.r, v.y), mirror);
    }

    // The telescope, resting on the top radiator inside the shields: an aluminium housing
    // with its 20 cm aperture, line of sight tipped 8° towards the panel side.
    const scope = new Group();
    const housing = new Mesh(keep(new BoxGeometry(0.42, 0.46, 0.38)), blackAnod);
    housing.position.y = 0.23;
    const baffle = new Mesh(keep(new CylinderGeometry(0.14, 0.13, 0.16, 48, 1, true)), blackAnod);
    baffle.position.y = 0.54;
    const mirrorGlint = new Mesh(keep(new CircleGeometry(SPHEREX_SIZE.aperture / 2, 48)), gold);
    mirrorGlint.rotation.x = -Math.PI / 2;
    mirrorGlint.position.y = 0.47;
    scope.add(housing, baffle, mirrorGlint);
    scope.position.y = 0.99;
    scope.rotation.z = -BORESIGHT_TILT_DEG * RAD;
    for (const m of [housing, baffle, mirrorGlint]) m.castShadow = m.receiveShadow = true;
    this.group.add(scope);

    // Struts from the bus to the radiators (low-conductance bipods), between the shields.
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + Math.PI / 6;
      add(new CylinderGeometry(0.012, 0.012, 0.2, 8), darkBox, (m) => {
        m.position.set(Math.cos(a) * 0.4, 0.84, Math.sin(a) * 0.4);
      });
    }

    // The bus: a hexagonal box wrapped in silver blanket, with gold-blanketed electronics.
    add(new CylinderGeometry(BUS.r, BUS.r, BUS.y1 - BUS.y0, 6, 1), silverMli, (m) => {
      m.position.y = (BUS.y0 + BUS.y1) / 2;
    });
    add(new CylinderGeometry(BUS.r, BUS.r, 0.02, 6, 1), blackAnod, (m) => {
      m.position.y = BUS.y1 + 0.01;
    });
    const faceBox = (
      faceAngle: number,
      w: number,
      h: number,
      d: number,
      y: number,
      mat: Material,
      side = 0,
    ) => {
      const a = faceAngle * RAD;
      const n = new Vector3(Math.sin(a), 0, Math.cos(a));
      const t = new Vector3(Math.cos(a), 0, -Math.sin(a));
      add(new BoxGeometry(w, h, d), mat, (m) => {
        m.position
          .copy(n.clone().multiplyScalar(APOTHEM + d / 2))
          .add(t.clone().multiplyScalar(side));
        m.position.y = y;
        m.rotation.y = a;
      });
    };
    // Faces sit at 30°, 90°, … (the panel face is at 90°, +X).
    faceBox(150, 0.34, 0.26, 0.12, 0.5, goldMli, -0.08);
    faceBox(150, 0.14, 0.18, 0.08, 0.26, darkBox, 0.15);
    faceBox(210, 0.4, 0.22, 0.1, 0.36, goldMli);
    faceBox(330, 0.22, 0.3, 0.14, 0.44, goldMli, 0.05);
    faceBox(30, 0.3, 0.16, 0.06, 0.6, darkBox);

    // Two star trackers on the side away from the Sun, looking out and up.
    for (const [ang, tilt] of [
      [240, 35],
      [300, 35],
    ] as const) {
      const a = ang * RAD;
      const g = new Group();
      const head = new Mesh(keep(new CylinderGeometry(0.06, 0.06, 0.12, 24)), darkBox);
      const shade = new Mesh(keep(new ConeGeometry(0.11, 0.2, 32, 1, true)), blackAnod);
      shade.rotation.x = Math.PI;
      shade.position.y = 0.15;
      g.add(head, shade);
      for (const m of [head, shade]) m.castShadow = m.receiveShadow = true;
      g.position.set(Math.sin(a) * (APOTHEM + 0.07), 0.66, Math.cos(a) * (APOTHEM + 0.07));
      const outward = new Vector3(Math.sin(a), 0, Math.cos(a));
      const dir = outward
        .multiplyScalar(Math.sin(tilt * RAD))
        .add(new Vector3(0, Math.cos(tilt * RAD), 0));
      g.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
      this.group.add(g);
    }

    // The separation ring under the bus.
    add(new CylinderGeometry(0.47, 0.5, 0.08, 64), brass, (m) => {
      m.position.y = 0.04;
    });

    // On the bottom: two cone-shaped Ka-band antennas (offset to reach polar ground stations)
    // and the S-band antenna, all looking down at Earth.
    for (const [x, z, tilt] of [
      [0.22, 0.18, 14],
      [-0.22, 0.18, -14],
    ] as const) {
      add(new ConeGeometry(0.09, 0.14, 32, 1, true), gold, (m) => {
        m.position.set(x, -0.06, z);
        m.rotation.z = tilt * RAD;
      });
    }
    add(new CylinderGeometry(0.07, 0.07, 0.03, 24), panelBack, (m) => {
      m.position.set(0, -0.015, -0.22);
    });

    // The solar panel: fixed to the +X face, standing off the bus, long side across, hanging
    // a little below the bus. Cells face +X (the Sun); the back is white.
    const px = APOTHEM + 0.16;
    const py0 = -0.14;
    const panel = new Mesh(
      keep(new BoxGeometry(0.035, SPHEREX_SIZE.panel.short, SPHEREX_SIZE.panel.long)),
      [cells, panelBack, panelBack, panelBack, panelBack, panelBack],
    );
    panel.position.set(px, py0 + SPHEREX_SIZE.panel.short / 2, 0);
    panel.castShadow = panel.receiveShadow = true;
    this.group.add(panel);
    for (const z of [-0.32, 0.32]) {
      add(new BoxGeometry(0.16, 0.05, 0.05), darkBox, (m) => {
        m.position.set(APOTHEM + 0.08, 0.42, z);
      });
    }
    // The two S-band antennas, one at each end of the panel.
    for (const z of [-1, 1]) {
      add(new CylinderGeometry(0.025, 0.025, 0.16, 16), panelBack, (m) => {
        m.position.set(
          px,
          py0 + SPHEREX_SIZE.panel.short - 0.08,
          z * (SPHEREX_SIZE.panel.long / 2 + 0.03),
        );
        m.rotation.x = Math.PI / 2;
      });
    }
  }

  /**
   * The attitude that puts the line of sight on `look` with the panel turned towards `sun`
   * (both unit vectors, scene axes): the shields' axis then sits 8° further from the Sun than
   * the line of sight (Bock et al. 2025), and the panel faces the Sun as squarely as it can.
   */
  static attitude(look: Vector3, sun: Vector3): Quaternion {
    const tilt = BORESIGHT_TILT_DEG * RAD;
    const towardSun = sun.clone().sub(look.clone().multiplyScalar(sun.dot(look)));
    if (towardSun.lengthSq() < 1e-10) towardSun.set(look.y, -look.x, 0).normalize();
    towardSun.normalize();
    const y = look
      .clone()
      .multiplyScalar(Math.cos(tilt))
      .addScaledVector(towardSun, -Math.sin(tilt));
    const x = look
      .clone()
      .multiplyScalar(Math.sin(tilt))
      .addScaledVector(towardSun, Math.cos(tilt));
    const z = x.clone().cross(y);
    return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
  }

  dispose(): void {
    for (const d of this.#disposables) d.dispose();
  }
}
