/**
 * Earth for the 3D scene, as close to the real thing as our sources allow:
 * - the surface is NASA's Blue Marble Next Generation for the photo's month (snow and green
 *   follow the season; no clouds, since a cloud map would be one particular day's weather);
 * - the night side shows NASA's Black Marble city lights (2016), fading in through twilight;
 * - only water glints in the sunlight (the oceans are told apart by their colour);
 * - a thin atmosphere (~80 km) glows along the limb, bright on the day side;
 * - the shape is WGS 84 (0.34% flatter at the poles), the axis is the sky's pole, and the turn
 *   is Greenwich sidereal time at the photo, so the right continents face the Sun.
 *
 * One unit is Earth's equatorial radius; the caller scales and places the group. The group's
 * axes are the sky's (x to RA 0, z to the pole), the same as the rest of the scene.
 */
import {
  AdditiveBlending,
  BackSide,
  Group,
  Matrix4,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type Texture,
} from 'three';
import { EARTH_EQ_KM, EARTH_POLAR_KM, gmstDeg } from './orbit';

const RAD = Math.PI / 180;
/** Atmosphere drawn to this height, in Earth radii (80 km: where the limb glow fades out). */
const ATMOSPHERE = 80 / EARTH_EQ_KM;

export interface EarthTextures {
  /** Day map for each month, 1–12; only the one in use is fetched. */
  dayUrl: (month: number) => string;
  nightUrl: string;
}

const surfaceVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vPosW = w.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
    #include <logdepthbuf_vertex>
  }
`;

const surfaceFragment = /* glsl */ `
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform vec3 sunDir;
  uniform float lights;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  #include <common>
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(cameraPosition - vPosW);
    float mu = dot(n, sunDir);
    vec3 day = texture2D(dayMap, vUv).rgb;

    // Water: Blue Marble's oceans are the only blue-dominant colour (ice is white, land is
    // green or brown), so the glint lands on the sea and lakes, not on the Sahara. A share of
    // blue, not a difference, so the darkest, deepest ocean counts as water too.
    float water = smoothstep(0.42, 0.6, day.b / (day.r + day.g + day.b + 0.0005));

    // Sunlight, with a narrow twilight so the day-night line is soft as it is from orbit.
    float lit = max(mu, 0.0);
    vec3 col = day * lit * 1.08;
    float dusk = smoothstep(-0.10, 0.0, mu) * (1.0 - smoothstep(0.0, 0.14, mu));
    col += vec3(0.55, 0.30, 0.16) * dusk * 0.05;

    // Sun glint on water: waves tilt the sea's surface by ~10–15°, so from orbit the glint is
    // a broad soft patch round the mirror point, not a pin-point.
    vec3 h = normalize(sunDir + v);
    float nh = max(dot(n, h), 0.0);
    col += water * (pow(nh, 80.0) * 0.18 + pow(nh, 10.0) * 0.02) * smoothstep(0.0, 0.08, mu);

    // City lights on the night side, through twilight. Black Marble's moonlit ground is blue,
    // its lights are warm, so the lights are what is redder than blue.
    vec3 night = texture2D(nightMap, vUv).rgb;
    float city = smoothstep(0.004, 0.12, night.r - 0.55 * night.b);
    // The night map is ~20 km a pixel: seen closer than that, its lights would smear into
    // blobs, so they dim where the map is magnified past its own detail.
    float texels = length(fwidth(vUv)) * 2048.0;
    city *= smoothstep(0.15, 0.6, texels);
    col += vec3(1.0, 0.72, 0.42) * city * lights * (1.0 - smoothstep(-0.12, 0.04, mu));

    // Haze towards the limb, lit by the Sun: the edge of the atmosphere seen from above.
    float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
    col = mix(col, vec3(0.32, 0.55, 1.0) * 0.9, rim * 0.55 * smoothstep(-0.25, 0.45, mu));

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * The atmosphere shell: for each ray, how close it passes to the ground decides how much air
 * it crosses (thick near the limb, thin a few tens of km up), and the Sun lights that air.
 */
const airVertex = /* glsl */ `
  varying vec3 vPosW;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vPosW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
    #include <logdepthbuf_vertex>
  }
`;

const airFragment = /* glsl */ `
  uniform vec3 centre;
  uniform float radius;
  uniform float top;
  uniform vec3 sunDir;
  varying vec3 vPosW;
  #include <common>
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    vec3 d = normalize(vPosW - cameraPosition);
    vec3 oc = centre - cameraPosition;
    float along = dot(oc, d);
    vec3 closest = cameraPosition + d * along - centre;
    float b = length(closest);
    // Height of the ray's lowest point above the ground, 0 at the limb, 1 at the top.
    float hgt = clamp((b - radius) / (top - radius), 0.0, 1.0);
    if (along < 0.0) hgt = 1.0;
    // Most of the glow is in the lowest ~10 km (scale height ~8 km of 80): a thin bright line
    // at the limb, blue in sunlight, a narrow warm band only right at the day-night line.
    float air = exp(-hgt * 9.0) * (1.0 - hgt);
    float mu = dot(closest / b, sunDir);
    float sun = smoothstep(-0.2, 0.25, mu);
    vec3 col = mix(vec3(0.85, 0.45, 0.25), vec3(0.35, 0.6, 1.0), smoothstep(-0.05, 0.12, mu));
    gl_FragColor = vec4(col * air * sun * 0.9, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class Earth {
  /** Place and scale this; its axes are the sky's. */
  readonly group = new Group();
  #surface: Mesh;
  #air: Mesh;
  #surfaceMat: ShaderMaterial;
  #airMat: ShaderMaterial;
  #ground = {
    dayMap: { value: null as Texture | null },
    nightMap: { value: null as Texture | null },
    sunDir: { value: new Vector3(1, 0, 0) },
    lights: { value: 1 },
  };
  #sky = {
    centre: { value: new Vector3() },
    radius: { value: 1 },
    top: { value: 1 + ATMOSPHERE },
    sunDir: { value: new Vector3(1, 0, 0) },
  };
  #textures: EarthTextures;
  #month = 0;
  #loader = new TextureLoader();

  /** Called when a map finishes loading (a scene that draws only on change must redraw). */
  #onLoad: () => void;

  constructor(textures: EarthTextures, segments = 128, onLoad: () => void = () => {}) {
    this.#onLoad = onLoad;
    this.#textures = textures;
    this.#ground.nightMap.value = this.#load(textures.nightUrl);
    this.#surfaceMat = new ShaderMaterial({
      uniforms: this.#ground,
      vertexShader: surfaceVertex,
      fragmentShader: surfaceFragment,
    });
    this.#surface = new Mesh(new SphereGeometry(1, segments, segments / 2), this.#surfaceMat);
    this.#surface.matrixAutoUpdate = false;

    this.#airMat = new ShaderMaterial({
      uniforms: this.#sky,
      vertexShader: airVertex,
      fragmentShader: airFragment,
      side: BackSide,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.#air = new Mesh(new SphereGeometry(1 + ATMOSPHERE, 96, 48), this.#airMat);
    this.group.add(this.#surface, this.#air);
  }

  /** The month whose surface map has arrived (0: none yet). */
  #readyMonth = 0;
  /** Whether the surface map for the date set is loaded (until then, draw Earth another way). */
  get ready(): boolean {
    return this.#readyMonth === this.#month;
  }

  #load(url: string, month = 0): Texture {
    const t = this.#loader.load(url, () => {
      if (month) this.#readyMonth = month;
      this.#onLoad();
    });
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }

  /** The photo's date: the month's surface, and Earth's turn at that moment. */
  setDate(mjd: number): void {
    const month = new Date((mjd - 40587) * 86_400_000).getUTCMonth() + 1;
    if (month !== this.#month) {
      this.#month = month;
      this.#ground.dayMap.value?.dispose();
      this.#ground.dayMap.value = this.#load(this.#textures.dayUrl(month), month);
    }
    // three.js puts a sphere's texture seam (longitude 180°) at local −X and its poles on Y:
    // turn local X to Greenwich (RA = sidereal time), local Y to the pole, and flatten Y.
    const g = gmstDeg(mjd) * RAD;
    const basis = new Matrix4().makeBasis(
      new Vector3(Math.cos(g), Math.sin(g), 0),
      new Vector3(0, 0, 1),
      new Vector3(Math.sin(g), -Math.cos(g), 0),
    );
    this.#surface.matrix.copy(
      basis.multiply(new Matrix4().makeScale(1, EARTH_POLAR_KM / EARTH_EQ_KM, 1)),
    );
  }

  /** The Sun's direction (unit, sky axes). */
  setSun(sun: Vector3): void {
    this.#ground.sunDir.value.copy(sun).normalize();
    this.#sky.sunDir.value.copy(sun).normalize();
  }

  /** City lights on or off (0–1). */
  setLights(k: number): void {
    this.#ground.lights.value = k;
  }

  /** Call before rendering, after the group is placed: the air shader works in world units. */
  update(): void {
    this.group.updateMatrixWorld();
    const c = new Vector3().setFromMatrixPosition(this.group.matrixWorld);
    const s = new Vector3().setFromMatrixScale(this.group.matrixWorld).x;
    this.#sky.centre.value.copy(c);
    this.#sky.radius.value = s;
    this.#sky.top.value = s * (1 + ATMOSPHERE);
  }

  dispose(): void {
    this.#ground.dayMap.value?.dispose();
    this.#ground.nightMap.value?.dispose();
    this.#surfaceMat.dispose();
    this.#airMat.dispose();
    this.#surface.geometry.dispose();
    this.#air.geometry.dispose();
  }
}
