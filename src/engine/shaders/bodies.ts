import { NOISE } from "./noise";

// Shaders des corps d'un système : étoile, planètes (sept types), anneaux, halo coronal.

export const PLANET_KIND_INDEX = { rocky: 0, desert: 1, ocean: 2, ice: 3, lava: 4, gas: 5, toxic: 6 } as const;

export const planetVertex = /* glsl */ `
  varying vec3 vObj;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  void main() {
    vObj = position;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

export const planetFragment = /* glsl */ `
  ${NOISE}
  uniform int uKind;
  uniform vec3 uA;
  uniform vec3 uB;
  uniform vec3 uC;
  uniform vec3 uAtmo;
  uniform float uSeed;
  uniform float uTime;
  uniform vec3 uStarPos;
  uniform vec3 uStarColor;
  uniform float uVitality;
  uniform float uHighlight;
  uniform float uDetail;
  varying vec3 vObj;
  varying vec3 vNormalW;
  varying vec3 vWorld;

  void main() {
    vec3 p = normalize(vObj);
    vec3 sp = p + vec3(uSeed * 7.13, uSeed * 3.71, uSeed * 1.93);
    int oct = int(uDetail);
    float n = fbm(sp * 2.1, oct);
    vec3 col = uA;
    vec3 emit = vec3(0.0);
    float specular = 0.0;

    if (uKind == 0) {
      // Rocheuse : plateaux, cratères diffus, poussière.
      float d = fbm(sp * 7.0, oct);
      col = mix(uA, uB, smoothstep(-0.35, 0.45, n));
      col = mix(col, uC, smoothstep(0.25, 0.6, d) * 0.5);
      float crater = smoothstep(0.55, 0.62, abs(snoise(sp * 5.0)));
      col *= 1.0 - crater * 0.35;
    } else if (uKind == 1) {
      // Désert : dunes ondulées.
      float dunes = sin(p.y * 26.0 + n * 7.0 + snoise(sp * 3.0) * 3.0) * 0.5 + 0.5;
      col = mix(uA, uB, dunes * 0.6 + smoothstep(-0.3, 0.5, n) * 0.4);
      col = mix(col, uC, smoothstep(0.4, 0.7, fbm(sp * 5.0, oct)) * 0.4);
    } else if (uKind == 2) {
      // Océan : continents, calottes, nuages mobiles, reflet spéculaire sur l'eau.
      float land = smoothstep(0.04, 0.1, n);
      vec3 water = mix(uA, uB, smoothstep(-0.5, 0.05, n));
      vec3 ground = mix(uC, vec3(0.55, 0.45, 0.3), smoothstep(0.15, 0.45, n));
      col = mix(water, ground, land);
      col = mix(col, vec3(0.95), smoothstep(0.78, 0.86, abs(p.y) + n * 0.1));
      specular = (1.0 - land) * 0.9;
      float clouds = smoothstep(0.05, 0.55, fbm(sp * 3.2 + vec3(uTime * 0.012, 0.0, uTime * 0.006), oct));
      col = mix(col, vec3(1.0), clouds * 0.85);
      specular *= 1.0 - clouds;
    } else if (uKind == 3) {
      // Glace : banquise striée de fractures bleues.
      col = mix(uA, uB, smoothstep(-0.4, 0.5, n));
      float cracks = 1.0 - smoothstep(0.0, 0.035, abs(snoise(sp * 4.5)));
      col = mix(col, uC, cracks * 0.8);
      specular = 0.35;
    } else if (uKind == 4) {
      // Lave : croûte sombre et fissures incandescentes, visibles côté nuit.
      float crust = fbm(sp * 3.0, oct);
      col = mix(uA, uB, smoothstep(-0.2, 0.5, crust));
      float veins = 1.0 - smoothstep(0.0, 0.12, abs(fbm(sp * 1.6 + vec3(uTime * 0.01), 3)));
      emit = uC * veins * (1.1 + 0.3 * sin(uTime * 1.3 + n * 9.0));
    } else if (uKind == 5) {
      // Géante gazeuse : bandes turbulentes et grande tache.
      float warp = fbm(vec3(p.x * 2.0, p.y * 9.0, p.z * 2.0) + sp + vec3(uTime * 0.02, 0.0, 0.0), oct);
      float bands = sin(p.y * 14.0 + warp * 3.2) * 0.5 + 0.5;
      col = mix(uA, uB, bands);
      col = mix(col, uC, smoothstep(0.2, 0.7, fbm(sp * vec3(1.5, 10.0, 1.5), oct)) * 0.45);
      vec3 spot = normalize(vec3(0.7, -0.35, 0.6));
      float storm = smoothstep(0.24, 0.1, distance(p, spot));
      col = mix(col, uC * 1.2, storm * 0.8);
    } else {
      // Toxique : brume jaune-vert en volutes.
      float swirl = fbm(sp * 2.5 + vec3(0.0, uTime * 0.015, 0.0), oct);
      float bands = sin(p.y * 8.0 + swirl * 5.0) * 0.5 + 0.5;
      col = mix(uA, uB, bands);
      col = mix(col, uC, smoothstep(0.1, 0.6, swirl) * 0.5);
    }

    vec3 N = normalize(vNormalW);
    vec3 L = normalize(uStarPos - vWorld);
    vec3 V = normalize(cameraPosition - vWorld);
    float ndl = dot(N, L);
    float day = smoothstep(-0.08, 0.35, ndl) * max(ndl, 0.0) * 0.8 + max(ndl, 0.0) * 0.4;
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 60.0) * specular * step(0.0, ndl);
    float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    // Les planètes délaissées pâlissent doucement ; les favorites restent éclatantes.
    vec3 lit = col * (0.03 + day * 1.6) * uStarColor * uVitality;
    lit += uStarColor * spec * 0.8 * uVitality;
    // Côté nuit : les lumières émissives (lave) ressortent.
    lit += emit * (1.0 - smoothstep(-0.2, 0.4, ndl) * 0.6);
    // Atmosphère : liseré lumineux, plus fort côté jour.
    lit += uAtmo * fres * (0.2 + 1.2 * smoothstep(-0.3, 0.6, ndl)) * uVitality;
    lit += vec3(0.45, 0.7, 1.0) * fres * uHighlight * 1.6;
    gl_FragColor = vec4(lit, 1.0);
  }
`;

/** Couche d'atmosphère : sphère un peu plus grande, face arrière, lueur additive. */
export const atmosphereFragment = /* glsl */ `
  uniform vec3 uAtmo;
  uniform vec3 uStarPos;
  uniform float uStrength;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 L = normalize(uStarPos - vWorld);
    // Face arrière d'une sphère un peu plus grande : brillante près de la silhouette seulement.
    float edge = pow(1.0 - abs(dot(N, V)), 2.5);
    float lit = 0.2 + smoothstep(-0.5, 0.6, dot(N, L));
    gl_FragColor = vec4(uAtmo * edge * lit * uStrength, 1.0);
  }
`;

export const starVertex = planetVertex;

export const starFragment = /* glsl */ `
  ${NOISE}
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uIntensity;
  varying vec3 vObj;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  void main() {
    vec3 p = normalize(vObj);
    float gran = fbm(p * 7.0 + vec3(0.0, uTime * 0.04, uTime * 0.02), 5);
    float spots = smoothstep(0.45, 0.6, fbm(p * 2.2 + vec3(uTime * 0.01), 3));
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vWorld);
    float mu = max(dot(N, V), 0.0);
    // Assombrissement centre-bord : le disque paraît sphérique.
    float limb = 0.35 + 0.65 * pow(mu, 0.45);
    vec3 hot = mix(uColor, vec3(1.0), 0.15);
    vec3 col = mix(uColor * 0.6, hot, gran * 0.5 + 0.5) * limb;
    col *= 1.0 - spots * 0.35;
    gl_FragColor = vec4(col * uIntensity, 1.0);
  }
`;

export const billboardVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv * 2.0 - 1.0;
    // Toujours face à la caméra : on annule la rotation de la matrice modèle-vue.
    vec4 center = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vec2 scale = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
    center.xy += position.xy * scale;
    gl_Position = projectionMatrix * center;
  }
`;

export const coronaFragment = /* glsl */ `
  ${NOISE}
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uIntensity;
  varying vec2 vUv;
  void main() {
    float r = length(vUv);
    if (r > 1.0) discard;
    float ang = atan(vUv.y, vUv.x);
    float rays = fbm(vec3(cos(ang) * 2.0, sin(ang) * 2.0, uTime * 0.08), 4) * 0.5 + 0.5;
    float glow = exp(-r * 5.5) * 1.6 + exp(-r * 14.0) * 2.0;
    float streak = pow(rays, 3.0) * exp(-r * 3.5) * 0.9;
    float fade = 1.0 - smoothstep(0.7, 1.0, r);
    gl_FragColor = vec4(uColor * (glow + streak) * fade * uIntensity, 1.0);
  }
`;

/** Anneau d'impulsion (lancement, application ouverte, sélection). */
export const pulseFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uPhase;
  uniform float uStrength;
  varying vec2 vUv;
  void main() {
    float r = length(vUv);
    if (r > 1.0) discard;
    float ring = exp(-pow((r - uPhase) / 0.06, 2.0));
    gl_FragColor = vec4(uColor * ring * uStrength * (1.0 - uPhase * 0.8), 1.0);
  }
`;

export const ringVertex = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vWorld;
  void main() {
    vLocal = position;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

export const ringFragment = /* glsl */ `
  ${NOISE}
  uniform vec3 uA;
  uniform vec3 uB;
  uniform float uInner;
  uniform float uOuter;
  uniform float uSeed;
  uniform vec3 uStarColor;
  uniform float uVitality;
  varying vec3 vLocal;
  varying vec3 vWorld;
  void main() {
    float r = length(vLocal.xy);
    float t = (r - uInner) / (uOuter - uInner);
    if (t < 0.0 || t > 1.0) discard;
    float bands = snoise(vec3(t * 40.0, uSeed, 0.0)) * 0.5 + 0.5;
    float gaps = smoothstep(0.02, 0.06, abs(t - 0.62)) * smoothstep(0.0, 0.08, t) * smoothstep(1.0, 0.9, t);
    float fine = snoise(vec3(t * 160.0, uSeed * 0.5, 1.0)) * 0.5 + 0.5;
    float a = (0.08 + 0.42 * bands * (0.6 + 0.4 * fine)) * gaps;
    vec3 col = mix(uA, uB, bands) * uStarColor * uVitality * (0.7 + 0.5 * fine);
    gl_FragColor = vec4(col, a);
  }
`;
