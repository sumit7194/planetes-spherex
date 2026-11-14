/**
 * The Sun and the light around SPHEREx.
 *
 * - The Sun is a direction, infinitely far: drawn as a disc of its true angular size for the date
 *   with a soft glare, always at the far end of the view so anything in front hides it.
 * - What shiny parts reflect: black space above, and below, Earth's disc, which from 659 km
 *   fills everything within 65° of straight down. Its sunlit side glows blue-white, its night
 *   side is dark. That is the only light besides the Sun.
 */
import {
  AdditiveBlending,
  BackSide,
  CanvasTexture,
  DirectionalLight,
  Mesh,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
  type Camera,
  type Texture,
  type WebGLRenderer,
} from 'three';

const RAD = Math.PI / 180;
/** The Sun's mean angular diameter seen from Earth, degrees. */
export const SUN_DIAMETER_DEG = 0.533;

/**
 * Its angular diameter on a date, degrees: 0.524° in early July to 0.542° in early January, as
 * Earth's distance from it changes (Meeus, low precision).
 */
export function sunDiameterDeg(mjd: number): number {
  const g = ((357.528 + 0.9856003 * (mjd - 51544.5)) * Math.PI) / 180;
  const au = 1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g);
  return 0.5332 / au;
}

function glow(size: number, stops: [number, string][]) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) return new CanvasTexture(c);
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, col] of stops) grd.addColorStop(at, col);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export class Sun {
  readonly light = new DirectionalLight(0xfff6ea, 3.2);
  #disc: Sprite;
  #glare: Sprite;
  #dir = new Vector3(1, 0, 0);
  /** Its angular diameter, degrees: set from the date with `sunDiameterDeg`. */
  diameterDeg = SUN_DIAMETER_DEG;
  /** False keeps the light but hides the disc (where the 2D sky marks the Sun itself). */
  showDisc = true;

  constructor() {
    this.#disc = new Sprite(
      new SpriteMaterial({
        map: glow(128, [
          [0, '#ffffff'],
          [0.42, '#fffaf0'],
          [0.5, 'rgba(255,240,215,0.9)'],
          [0.56, 'rgba(255,230,200,0)'],
        ]),
        depthWrite: false,
        fog: false,
      }),
    );
    this.#glare = new Sprite(
      new SpriteMaterial({
        map: glow(256, [
          [0, 'rgba(255,248,232,0.85)'],
          [0.06, 'rgba(255,240,215,0.35)'],
          [0.25, 'rgba(255,230,200,0.08)'],
          [1, 'rgba(255,220,190,0)'],
        ]),
        blending: AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    this.#disc.renderOrder = this.#glare.renderOrder = -1;
  }

  add(scene: Scene): void {
    scene.add(this.light, this.light.target, this.#disc, this.#glare);
  }

  set direction(sun: Vector3) {
    this.#dir.copy(sun).normalize();
  }

  /**
   * Each frame: keep the light coming from the Sun onto `target` (scene units), and put the
   * disc at `far` along the Sun's direction from the camera, sized to its true angle. Spheres
   * in `occluders` (Earth) hide the disc and its glare when they cover the Sun.
   */
  update(
    camera: Camera,
    target: Vector3,
    far: number,
    occluders: { centre: Vector3; radius: number }[] = [],
    lightDistance = 20,
  ): void {
    this.light.position.copy(target).addScaledVector(this.#dir, lightDistance);
    this.light.target.position.copy(target);
    const d = far * 0.95;
    const at = camera.position.clone().addScaledVector(this.#dir, d);
    // The disc texture's edge is at 0.5 of its width, so the sprite is twice the disc.
    const disc = 2 * d * Math.tan((this.diameterDeg / 2) * RAD) * 2;
    this.#disc.position.copy(at);
    this.#disc.scale.setScalar(disc);
    this.#glare.position.copy(at);
    this.#glare.scale.setScalar(disc * 40);

    // How far the Sun's centre sits outside each occluder's edge, in Sun radii: below −1 it is
    // fully hidden, above +1 fully clear, and in between it is setting behind the limb.
    let clear = 1;
    const sunR = (this.diameterDeg / 2) * RAD;
    for (const o of occluders) {
      const to = o.centre.clone().sub(camera.position);
      const dist = to.length();
      if (dist <= o.radius) continue;
      const edge = Math.asin(o.radius / dist);
      const off = Math.acos(Math.min(1, Math.max(-1, to.dot(this.#dir) / dist)));
      clear = Math.min(clear, Math.min(1, Math.max(0, ((off - edge) / sunR + 1) / 2)));
    }
    (this.#disc.material as SpriteMaterial).opacity = clear;
    (this.#glare.material as SpriteMaterial).opacity = clear;
    this.#disc.visible = this.#glare.visible = this.showDisc && clear > 0;
  }
}

/**
 * The reflections' surroundings for a spacecraft at `nadir` (unit, pointing at Earth's centre)
 * and the Sun at `sun`, `radiusRatio` Earth radii from Earth's centre: Earth's disc below (65°
 * from straight down at 659 km), lit on its sunward side.
 */
export function spaceEnvironment(
  renderer: WebGLRenderer,
  sun: Vector3,
  nadir: Vector3,
  radiusRatio: number,
): Texture {
  const scene = new Scene();
  const mat = new ShaderMaterial({
    side: BackSide,
    uniforms: {
      sun: { value: sun.clone().normalize() },
      nadir: { value: nadir.clone().normalize() },
      r: { value: radiusRatio },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 sun;
      uniform vec3 nadir;
      uniform float r;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        // Where this ray meets the ground (Earth's radius 1, the spacecraft r radii from the centre):
        // that point's own Sun elevation decides how bright Earth looks that way.
        vec3 p = -nadir * r;
        float pd = dot(p, d);
        float disc = pd * pd - (r * r - 1.0);
        float onEarth = smoothstep(-0.002, 0.004, disc) * step(pd, 0.0);
        vec3 g = p + d * (-pd - sqrt(max(disc, 0.0)));
        float day = smoothstep(-0.08, 0.35, dot(normalize(g), sun));
        // Real Earth reflects ~30% of sunlight (clouds included; our cloud-free surface map is
        // darker), so its glow is set to a 0.3-albedo surface, a little blue from the air.
        vec3 earth = vec3(0.28, 0.32, 0.40) * day + vec3(0.004, 0.005, 0.008);
        gl_FragColor = vec4(earth * onEarth, 1.0);
      }
    `,
  });
  scene.add(new Mesh(new SphereGeometry(10, 48, 24), mat));
  const pmrem = new PMREMGenerator(renderer);
  const tex = pmrem.fromScene(scene, 0.02).texture;
  pmrem.dispose();
  mat.dispose();
  return tex;
}
