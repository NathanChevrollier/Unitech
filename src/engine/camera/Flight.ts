import * as THREE from "three";

// Vol de caméra entre deux points de vue : la distance est interpolée en échelle logarithmique
// (on traverse les ordres de grandeur à vitesse constante, du kiloparsec au parsec) et la direction
// de visée par interpolation sphérique.

export interface FlightOptions {
  target: () => THREE.Vector3;
  distance: number;
  /** Direction finale (de la cible vers la caméra). Par défaut, la direction courante. */
  direction?: THREE.Vector3;
  duration?: number;
  /** Élargissement temporaire du champ de vision, en degrés (effet de vitesse). */
  fovKick?: number;
  onDone?: () => void;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class Flight {
  private t = 0;
  private fromTarget: THREE.Vector3;
  private fromDir: THREE.Vector3;
  private fromDistance: number;
  private toDir: THREE.Vector3;
  private baseFov: number;
  private q0 = new THREE.Quaternion();
  private q1 = new THREE.Quaternion();
  done = false;

  constructor(
    private camera: THREE.PerspectiveCamera,
    currentTarget: THREE.Vector3,
    private opts: FlightOptions,
  ) {
    this.fromTarget = currentTarget.clone();
    const offset = camera.position.clone().sub(currentTarget);
    this.fromDistance = Math.max(offset.length(), 1e-4);
    this.fromDir = offset.normalize();
    this.toDir = (opts.direction ?? this.fromDir).clone().normalize();
    this.baseFov = camera.fov;
    // Rotation qui amène fromDir sur toDir : appliquée progressivement.
    this.q1.setFromUnitVectors(this.fromDir, this.toDir);
  }

  /** Avance le vol ; renvoie la cible courante (pour les contrôles). */
  step(dt: number, outTarget: THREE.Vector3): THREE.Vector3 {
    const duration = this.opts.duration ?? 1.6;
    this.t = Math.min(1, this.t + dt / duration);
    const e = easeInOut(this.t);
    const to = this.opts.target();
    outTarget.lerpVectors(this.fromTarget, to, e);
    const d = Math.exp(THREE.MathUtils.lerp(Math.log(this.fromDistance), Math.log(Math.max(this.opts.distance, 1e-4)), e));
    const q = this.q0.identity().slerp(this.q1, e);
    const dir = this.fromDir.clone().applyQuaternion(q);
    this.camera.position.copy(outTarget).addScaledVector(dir, d);
    this.camera.lookAt(outTarget);
    if (this.opts.fovKick) {
      this.camera.fov = this.baseFov + this.opts.fovKick * Math.sin(Math.PI * e);
      this.camera.updateProjectionMatrix();
    }
    if (this.t >= 1 && !this.done) {
      this.done = true;
      if (this.opts.fovKick) {
        this.camera.fov = this.baseFov;
        this.camera.updateProjectionMatrix();
      }
      this.opts.onDone?.();
    }
    return outTarget;
  }

  cancel() {
    if (this.opts.fovKick) {
      this.camera.fov = this.baseFov;
      this.camera.updateProjectionMatrix();
    }
    this.done = true;
  }
}
