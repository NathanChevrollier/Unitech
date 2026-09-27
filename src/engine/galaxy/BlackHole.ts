import * as THREE from "three";
import { NOISE } from "../shaders/noise";

// Sagittarius A* : horizon, disque d'accrétion tourbillonnant (plus brillant du côté qui vient vers
// nous, effet Doppler) et anneau de photons avec l'arc du disque vu par-dessus, à la manière des
// images de lentille gravitationnelle. Tailles très exagérées pour rester visibles à l'échelle
// galactique ; le trou noir sert de corbeille (on y jette ce qu'on archive).

export const HORIZON = 9;

const diskVertex = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vWorld;
  varying vec3 vVel;
  void main() {
    vLocal = position;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vVel = normalize(mat3(modelMatrix) * vec3(-position.z, 0.0, position.x));
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const diskFragment = /* glsl */ `
  ${NOISE}
  uniform float uTime;
  uniform float uInner;
  uniform float uOuter;
  uniform vec3 uCamera;
  uniform float uBoost;
  varying vec3 vLocal;
  varying vec3 vWorld;
  varying vec3 vVel;
  void main() {
    vec3 local = vLocal;
    float r = length(local.xz);
    float t = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);
    float ang = atan(local.z, local.x);
    // Rotation képlérienne : l'intérieur tourne bien plus vite.
    float swirl = ang + uTime * 0.9 / pow(max(r / uInner, 1.0), 1.5);
    vec3 p = vec3(cos(swirl) * r * 0.08, sin(swirl) * r * 0.08, r * 0.05);
    float n = fbm(p + vec3(0.0, 0.0, uTime * 0.05), 5) * 0.5 + 0.5;
    float streaks = fbm(vec3(swirl * 3.0, r * 0.12, 0.0), 3) * 0.5 + 0.5;
    vec3 hot = vec3(1.0, 0.95, 0.85);
    vec3 warm = vec3(1.0, 0.55, 0.18);
    vec3 cool = vec3(0.55, 0.12, 0.05);
    vec3 col = mix(hot, warm, smoothstep(0.0, 0.35, t));
    col = mix(col, cool, smoothstep(0.35, 1.0, t));
    float density = pow(n, 1.6) * (0.6 + 0.8 * streaks);
    float edge = smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.7, 1.0, t));
    // Doppler : le côté dont la vitesse pointe vers la caméra est éclairci.
    vec3 toCam = normalize(uCamera - vWorld);
    float doppler = pow(1.0 + 0.75 * dot(vVel, toCam), 2.2);
    float intensity = density * edge * doppler * (3.2 - 2.4 * t) * uBoost;
    gl_FragColor = vec4(col * intensity, 1.0);
  }
`;

const haloVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv * 2.0 - 1.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const haloFragment = /* glsl */ `
  ${NOISE}
  uniform float uTime;
  uniform float uBoost;
  varying vec2 vUv;
  void main() {
    float r = length(vUv);
    float ang = atan(vUv.y, vUv.x);
    // Anneau de photons, fin et éclatant, juste à l'extérieur de l'ombre.
    float ring = exp(-pow((r - 0.155) / 0.012, 2.0)) * 2.6;
    // Arc lensé du disque : au-dessus et en dessous de l'ombre.
    float lens = exp(-pow((r - 0.2) / 0.05, 2.0)) * pow(abs(sin(ang)), 1.5);
    float flicker = 0.75 + 0.25 * snoise(vec3(ang * 3.0, r * 8.0, uTime * 0.4));
    vec3 col = vec3(1.0, 0.72, 0.4) * ring + vec3(1.0, 0.5, 0.2) * lens * flicker * 1.6;
    // Lueur diffuse.
    col += vec3(1.0, 0.6, 0.3) * exp(-r * 6.0) * 0.35;
    // Ombre : tout ce qui est dans le rayon critique est noir.
    float shadow = smoothstep(0.13, 0.145, r);
    gl_FragColor = vec4(col * shadow * uBoost, 1.0);
  }
`;

export class BlackHole {
  readonly group = new THREE.Group();
  private disk: THREE.Mesh;
  private halo: THREE.Mesh;
  private shadow: THREE.Mesh;
  private diskUniforms = { uTime: { value: 0 }, uInner: { value: HORIZON * 1.6 }, uOuter: { value: HORIZON * 7 }, uCamera: { value: new THREE.Vector3() }, uBoost: { value: 1 } };
  private haloUniforms = { uTime: { value: 0 }, uBoost: { value: 1 } };
  private parentQ = new THREE.Quaternion();

  constructor() {
    const diskGeo = new THREE.RingGeometry(HORIZON * 1.6, HORIZON * 7, 256, 4);
    diskGeo.rotateX(-Math.PI / 2);
    this.disk = new THREE.Mesh(
      diskGeo,
      new THREE.ShaderMaterial({
        uniforms: this.diskUniforms,
        vertexShader: diskVertex,
        fragmentShader: diskFragment,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        transparent: true,
      }),
    );
    this.disk.rotation.z = 0.18;
    this.disk.renderOrder = 6;

    this.shadow = new THREE.Mesh(new THREE.SphereGeometry(HORIZON, 48, 24), new THREE.MeshBasicMaterial({ color: 0x000000, depthTest: false, depthWrite: false }));
    this.shadow.renderOrder = 5;

    this.halo = new THREE.Mesh(
      new THREE.PlaneGeometry(HORIZON * 13, HORIZON * 13),
      new THREE.ShaderMaterial({
        uniforms: this.haloUniforms,
        vertexShader: haloVertex,
        fragmentShader: haloFragment,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        transparent: true,
      }),
    );
    this.halo.renderOrder = 7;
    this.group.add(this.shadow, this.disk, this.halo);
    this.group.name = "sgrA";
  }

  update(time: number, camera: THREE.Camera, cameraDistance: number) {
    this.diskUniforms.uTime.value = time;
    this.haloUniforms.uTime.value = time;
    camera.getWorldPosition(this.diskUniforms.uCamera.value);
    this.halo.quaternion.copy(camera.quaternion);
    if (this.group.parent) {
      // Le halo suit la caméra dans le repère local du groupe parent (qui tourne).
      this.group.parent.getWorldQuaternion(this.parentQ);
      this.halo.quaternion.premultiply(this.parentQ.invert());
    }
    // Invisible depuis l'autre bout de la galaxie, éclatant en approche.
    const boost = 1 - THREE.MathUtils.smoothstep(cameraDistance, 2500, 9000);
    this.diskUniforms.uBoost.value = boost;
    this.haloUniforms.uBoost.value = boost;
    this.group.visible = boost > 0.001;
  }

  dispose() {
    for (const m of [this.disk, this.halo, this.shadow]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }
}
