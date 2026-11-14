/**
 * The near scene in full 3D (tier 2), for Look around and stepping out: Earth, SPHEREx's orbit
 * and a ghost of SPHEREx, drawn from exactly the 2D sky's pinhole camera (same place, axes,
 * focal length and centre), so the sky's stars and labels line up with it pixel for pixel.
 *
 * Kilometres, with the camera at the origin (Earth's centre is thousands of km away, and the
 * camera-relative frame keeps everything steady). The stars are infinitely far, so they stay
 * in the 2D sky; only things that are near are drawn here.
 */
import {
  BufferGeometry,
  Float32BufferAttribute,
  GreaterDepth,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  ACESFilmicToneMapping,
  PCFSoftShadowMap,
} from 'three';
import { Earth, type EarthTextures } from './earth';
import { Sun, spaceEnvironment } from './light';
import { EARTH_EQ_KM, orbitFrame, SPHEREX_ORBIT, type Vec3 } from './orbit';
import { Spherex } from './spherex';

export interface Scene3DView {
  /** The sky canvas, device pixels. */
  width: number;
  height: number;
  /** The camera's centre on the canvas and its focal length, pixels. */
  cx: number;
  cy: number;
  focal: number;
  /** Where the camera looks, and which way is up on screen (unit, sky axes). */
  forward: Vec3;
  up: Vec3;
  /** The camera's place, Earth radii from Earth's centre. */
  cam: Vec3;
  sun: Vec3;
  /** The date on show: the surface's month, Earth's turn and the orbit's plane. */
  mjd: number;
  /** SPHEREx: its place (Earth radii) and line of sight; null hides it. True size, always. */
  ghost: { at: Vec3; look: Vec3 } | null;
  /** The orbit's strength, 0–1 (0 hides it). */
  orbit: number;
  /** The line of sight's strength, 0–1. */
  sight: number;
}

const ORBIT_POINTS = 720;
/** The renderer works at no more than this many pixels; the sky scales the picture up. */
const MAX_PIXELS = 2_400_000;

export class Scene3D {
  readonly canvas: HTMLCanvasElement;
  #renderer: WebGLRenderer;
  #scene = new Scene();
  #camera = new PerspectiveCamera(50, 1, 1, 1e7);
  #earth: Earth;
  #spherex = new Spherex();
  #sun = new Sun();
  #front: Line;
  #back: Line;
  #sight: Line;
  #envKey = '';
  #lastKey = '';

  constructor(textures: EarthTextures, colours: { orbit: string; look: string }) {
    this.canvas = document.createElement('canvas');
    this.#renderer = new WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
      logarithmicDepthBuffer: true,
      powerPreference: 'high-performance',
    });
    this.#renderer.setPixelRatio(1);
    this.#renderer.setClearColor(0x000000, 0);
    this.#renderer.outputColorSpace = SRGBColorSpace;
    this.#renderer.toneMapping = ACESFilmicToneMapping;
    this.#renderer.shadowMap.enabled = true;
    this.#renderer.shadowMap.type = PCFSoftShadowMap;

    // A map arriving changes the picture though the view hasn't moved: draw again.
    this.#earth = new Earth(textures, 128, () => {
      this.#lastKey = '';
    });
    this.#earth.group.scale.setScalar(EARTH_EQ_KM);
    this.#scene.add(this.#earth.group, this.#spherex.group);
    this.#sun.add(this.#scene);
    this.#sun.showDisc = false;
    // Shadows on SPHEREx in the close-up: a small box round it (km), only when it is near.
    const shadow = this.#sun.light.shadow;
    shadow.mapSize.set(2048, 2048);
    Object.assign(shadow.camera, {
      left: -0.004,
      right: 0.004,
      top: 0.004,
      bottom: -0.004,
      near: 0.001,
      far: 0.06,
    });
    shadow.bias = -0.0004;
    shadow.normalBias = 0.00002;
    this.#sun.light.castShadow = true;

    // The orbit twice: solid where it's in front of Earth, dashed and faint where Earth hides
    // it (drawn only where it fails the depth test), so it is never simply lost.
    const geo = new BufferGeometry();
    geo.setAttribute(
      'position',
      new Float32BufferAttribute(new Float32Array(ORBIT_POINTS * 3 + 3), 3),
    );
    this.#front = new Line(
      geo,
      new LineBasicMaterial({
        color: colours.orbit,
        transparent: true,
        opacity: 0.75,
        toneMapped: false,
      }),
    );
    this.#back = new Line(
      geo,
      new LineDashedMaterial({
        color: colours.orbit,
        transparent: true,
        opacity: 0.35,
        dashSize: 220,
        gapSize: 220,
        depthFunc: GreaterDepth,
        toneMapped: false,
        depthWrite: false,
      }),
    );
    const sightGeo = new BufferGeometry();
    sightGeo.setAttribute('position', new Float32BufferAttribute(new Float32Array(6), 3));
    this.#sight = new Line(
      sightGeo,
      new LineBasicMaterial({
        color: colours.look,
        transparent: true,
        opacity: 0.85,
        toneMapped: false,
      }),
    );
    this.#scene.add(this.#front, this.#back, this.#sight);
  }

  /**
   * Whether the surface map for this date has arrived; the sky draws Earth itself until then.
   * Asking also starts the download, so it's ready by the time the 3D view is wanted.
   */
  ready(mjd: number): boolean {
    this.#earth.setDate(mjd);
    return this.#earth.ready;
  }

  render(v: Scene3DView): HTMLCanvasElement {
    // The sky redraws every frame; the 3D picture only when something in it has moved.
    const key = JSON.stringify(v);
    if (key === this.#lastKey) return this.canvas;
    this.#lastKey = key;
    const k = Math.min(1, Math.sqrt(MAX_PIXELS / (v.width * v.height)));
    const w = Math.max(16, Math.round(v.width * k));
    const h = Math.max(16, Math.round(v.height * k));
    if (this.canvas.width !== w || this.canvas.height !== h) this.#renderer.setSize(w, h, false);

    // The 2D sky's pinhole: its focal length gives the field of view, and its centre (which
    // need not be the canvas's) shifts the picture by a view offset.
    const cam = this.#camera;
    cam.fov = (2 * Math.atan(v.height / 2 / v.focal) * 180) / Math.PI;
    cam.aspect = v.width / v.height;
    cam.setViewOffset(
      v.width,
      v.height,
      v.width / 2 - v.cx,
      v.height / 2 - v.cy,
      v.width,
      v.height,
    );
    cam.position.set(0, 0, 0);
    cam.up.set(...v.up);
    cam.lookAt(...v.forward);
    const camKm = new Vector3(...v.cam).multiplyScalar(EARTH_EQ_KM);
    const earthDist = camKm.length();
    // The near plane just short of the nearest thing: SPHEREx (metres away in the close-up)
    // or the ground; the logarithmic depth buffer keeps the far side sharp.
    const craftKm = v.ghost
      ? new Vector3(...v.ghost.at).multiplyScalar(EARTH_EQ_KM).sub(camKm).length()
      : Infinity;
    cam.near = Math.max(0.0003, Math.min(craftKm * 0.25, (earthDist - EARTH_EQ_KM) * 0.2));
    cam.far = earthDist * 4 + 1e5;
    cam.updateProjectionMatrix();

    const sun = new Vector3(...v.sun).normalize();
    this.#earth.group.position.copy(camKm).negate();
    this.#earth.setDate(v.mjd);
    this.#earth.setSun(sun);
    this.#earth.update();
    this.#sun.direction = sun;

    // The orbit, at its true size and in its real plane.
    const { node, ahead } = orbitFrame(v.mjd);
    const a = SPHEREX_ORBIT.semiMajorKm;
    const pos = this.#front.geometry.getAttribute('position');
    for (let i = 0; i <= ORBIT_POINTS; i++) {
      const t = (i / ORBIT_POINTS) * Math.PI * 2;
      pos.setXYZ(
        i,
        a * (node[0] * Math.cos(t) + ahead[0] * Math.sin(t)) - camKm.x,
        a * (node[1] * Math.cos(t) + ahead[1] * Math.sin(t)) - camKm.y,
        a * (node[2] * Math.cos(t) + ahead[2] * Math.sin(t)) - camKm.z,
      );
    }
    pos.needsUpdate = true;
    this.#front.geometry.computeBoundingSphere();
    this.#back.computeLineDistances();
    this.#front.visible = this.#back.visible = v.orbit > 0.01;
    (this.#front.material as LineBasicMaterial).opacity = 0.75 * v.orbit;
    (this.#back.material as LineDashedMaterial).opacity = 0.35 * v.orbit;

    // SPHEREx: the model at its approximate place and its true size (2.6 m: below a pixel from
    // anywhere its orbit is seen, so the sky marks its place with a ring; never enlarged).
    const g = v.ghost;
    this.#spherex.group.visible = !!g;
    this.#sight.visible = !!g && v.sight > 0.01;
    if (g) {
      const at = new Vector3(...g.at).multiplyScalar(EARTH_EQ_KM).sub(camKm);
      const look = new Vector3(...g.look).normalize();
      this.#spherex.group.position.copy(at);
      this.#spherex.group.quaternion.copy(Spherex.attitude(look, sun));
      this.#spherex.group.scale.setScalar(1 / 1000);
      const s = this.#sight.geometry.getAttribute('position');
      const reach = EARTH_EQ_KM * 2.5;
      s.setXYZ(0, at.x, at.y, at.z);
      s.setXYZ(1, at.x + look.x * reach, at.y + look.y * reach, at.z + look.z * reach);
      s.needsUpdate = true;
      this.#sight.geometry.computeBoundingSphere();
      (this.#sight.material as LineBasicMaterial).opacity = 0.85 * v.sight;

      // What its shiny parts reflect: Earth below, lit where the Sun is up (rebuilt on change).
      // Only worth building when SPHEREx is near enough to be seen at all.
      const r = new Vector3(...g.at);
      const envKey = [...r.toArray(), ...sun.toArray()].map((x) => x.toFixed(1)).join(',');
      if (craftKm < 1 && envKey !== this.#envKey) {
        this.#envKey = envKey;
        this.#scene.environment?.dispose();
        this.#scene.environment = spaceEnvironment(
          this.#renderer,
          sun,
          r.clone().normalize().negate(),
          r.length(),
        );
      }
    }
    // Close in, the light sits a few tens of metres sunward of SPHEREx so its shadow box fits.
    // Shadows stay on (switching them recompiles every material: a visible hitch); only the
    // 2.6 m spacecraft casts, so the pass is tiny.
    const close = craftKm < 0.2;
    this.#sun.update(
      cam,
      g ? this.#spherex.group.position : new Vector3(),
      cam.far,
      [],
      close ? 0.03 : EARTH_EQ_KM * 3,
    );
    this.#renderer.render(this.#scene, cam);
    return this.canvas;
  }

  dispose(): void {
    this.#earth.dispose();
    this.#spherex.dispose();
    this.#renderer.dispose();
  }
}
