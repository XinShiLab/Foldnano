/**
 * Rigid-body block solver.
 *
 * An independent implementation inspired by oxView's rigid-body cluster
 * simulation: springs act at backbone attachment points, off-center forces
 * create torque, damping keeps the system stable, and repulsion prevents rigid
 * bodies from overlapping. No oxView code is used (oxView is GPL-3.0).
 */

import type {
	BlockBody,
	BlockTransformOverride,
	DistanceConstraint,
	Quat,
	SolverParams,
	SolverResult,
	Vec3,
} from './rbsTypes';

export const DEFAULT_SOLVER_PARAMS: SolverParams = {
	iterations: 1200,
	dt: 0.1,
	springK: 10,
	repulsionK: 1000,
	damping: 0.25,
	collisionPasses: 2,
};

function add(a: Vec3, b: Vec3): Vec3 {
	return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function sub(a: Vec3, b: Vec3): Vec3 {
	return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(a: Vec3, s: number): Vec3 {
	return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function dot(a: Vec3, b: Vec3): number {
	return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
	return {
		x: a.y * b.z - a.z * b.y,
		y: a.z * b.x - a.x * b.z,
		z: a.x * b.y - a.y * b.x,
	};
}

function length(a: Vec3): number {
	return Math.hypot(a.x, a.y, a.z);
}

function normalizeOrFallback(v: Vec3, fallback: Vec3): Vec3 {
	const len = length(v);
	return len > 1e-9 ? scale(v, 1 / len) : fallback;
}

function rotateVec(q: Quat, v: Vec3): Vec3 {
	const tx = 2 * (q.y * v.z - q.z * v.y);
	const ty = 2 * (q.z * v.x - q.x * v.z);
	const tz = 2 * (q.x * v.y - q.y * v.x);
	return {
		x: v.x + q.w * tx + (q.y * tz - q.z * ty),
		y: v.y + q.w * ty + (q.z * tx - q.x * tz),
		z: v.z + q.w * tz + (q.x * ty - q.y * tx),
	};
}

function normalizeQuat(q: Quat): Quat {
	const inv = 1 / Math.hypot(q.x, q.y, q.z, q.w);
	return { x: q.x * inv, y: q.y * inv, z: q.z * inv, w: q.w * inv };
}

function integrateQuat(q: Quat, omega: Vec3, dt: number): Quat {
	const halfDt = 0.5 * dt;
	return normalizeQuat({
		w: q.w + halfDt * -(omega.x * q.x + omega.y * q.y + omega.z * q.z),
		x: q.x + halfDt * (omega.x * q.w + omega.y * q.z - omega.z * q.y),
		y: q.y + halfDt * (-omega.x * q.z + omega.y * q.w + omega.z * q.x),
		z: q.z + halfDt * (omega.x * q.y - omega.y * q.x + omega.z * q.w),
	});
}

function closestSegmentPoints(a0: Vec3, a1: Vec3, b0: Vec3, b1: Vec3): { pa: Vec3; pb: Vec3 } {
	const u = sub(a1, a0);
	const v = sub(b1, b0);
	const w = sub(a0, b0);
	const aa = dot(u, u);
	const bb = dot(v, v);
	const ab = dot(u, v);
	const aw = dot(u, w);
	const bw = dot(v, w);
	const denom = aa * bb - ab * ab;

	let s = denom > 1e-9 ? (ab * bw - bb * aw) / denom : 0;
	s = Math.max(0, Math.min(1, s));
	let t = bb > 1e-9 ? (ab * s + bw) / bb : 0;
	t = Math.max(0, Math.min(1, t));
	s = aa > 1e-9 ? (ab * t - aw) / aa : 0;
	s = Math.max(0, Math.min(1, s));

	return {
		pa: add(a0, scale(u, s)),
		pb: add(b0, scale(v, t)),
	};
}

interface WorkingBody {
	block: BlockBody;
	position: Vec3;
	quaternion: Quat;
	velocity: Vec3;
	angularVelocity: Vec3;
	force: Vec3;
	torque: Vec3;
}

function zero(): Vec3 {
	return { x: 0, y: 0, z: 0 };
}

function worldOffset(body: WorkingBody, local: Vec3): Vec3 {
	return rotateVec(body.quaternion, local);
}

function worldPoint(body: WorkingBody, local: Vec3): Vec3 {
	return add(body.position, worldOffset(body, local));
}

function applyForce(body: WorkingBody, force: Vec3, atWorldPoint?: Vec3): void {
	body.force = add(body.force, force);
	if (atWorldPoint) {
		body.torque = add(body.torque, cross(sub(atWorldPoint, body.position), force));
	}
}

function averageInertia(block: BlockBody): number {
	return Math.max((block.inertia.x + block.inertia.y + block.inertia.z) / 3, 1e-6);
}

function projectCapsuleOverlaps(bodies: WorkingBody[], passes: number): void {
	for (let pass = 0; pass < passes; pass++) {
		for (let i = 0; i < bodies.length; i++) {
			for (let j = i + 1; j < bodies.length; j++) {
				const a = bodies[i];
				const b = bodies[j];
				const centerDelta = sub(b.position, a.position);
				if (length(centerDelta) > a.block.radius + b.block.radius) continue;
				for (const capA of a.block.collisionCapsules) {
					const a0 = worldPoint(a, capA.localStart);
					const a1 = worldPoint(a, capA.localEnd);
					for (const capB of b.block.collisionCapsules) {
						const b0 = worldPoint(b, capB.localStart);
						const b1 = worldPoint(b, capB.localEnd);
						const { pa, pb } = closestSegmentPoints(a0, a1, b0, b1);
						const delta = sub(pb, pa);
						const dist = length(delta);
						const minDist = capA.radius + capB.radius;
						if (dist >= minDist) continue;
						const dir = normalizeOrFallback(
							delta,
							normalizeOrFallback(centerDelta, { x: 1, y: 0, z: 0 })
						);
						const overlap = minDist - dist;
						const invMassA = 1 / Math.max(a.block.mass, 1e-6);
						const invMassB = 1 / Math.max(b.block.mass, 1e-6);
						const invMassSum = invMassA + invMassB;
						if (invMassSum <= 0) continue;
						a.position = sub(a.position, scale(dir, (overlap * invMassA) / invMassSum));
						b.position = add(b.position, scale(dir, (overlap * invMassB) / invMassSum));
					}
				}
			}
		}
	}
}

function createWorkingBodies(blocks: BlockBody[]): WorkingBody[] {
	return blocks.map<WorkingBody>((block) => ({
		block,
		position: { ...block.position },
		quaternion: { ...block.quaternion },
		velocity: zero(),
		angularVelocity: zero(),
		force: zero(),
		torque: zero(),
	}));
}

function simulateSteps(
	bodies: WorkingBody[],
	constraints: DistanceConstraint[],
	params: SolverParams,
	steps: number
): void {
	const byId = new Map(bodies.map((body) => [body.block.blockId, body]));
	const damping = Math.max(0, Math.min(1, 1 - params.damping));

	for (let step = 0; step < steps; step++) {
		for (const body of bodies) {
			body.force = zero();
			body.torque = zero();
		}

		for (const constraint of constraints) {
			const a = byId.get(constraint.blockIdA);
			const b = byId.get(constraint.blockIdB);
			if (!a || !b) continue;

			const pa = worldPoint(a, constraint.localAttachA);
			const pb = worldPoint(b, constraint.localAttachB);
			const delta = sub(pb, pa);
			const dist = length(delta);
			const dir = normalizeOrFallback(
				delta,
				normalizeOrFallback(sub(b.position, a.position), { x: 1, y: 0, z: 0 })
			);
			const f = scale(dir, params.springK * (dist - constraint.restLength));
			applyForce(a, f, pa);
			applyForce(b, scale(f, -1), pb);
		}

		for (let pass = 0; pass < params.collisionPasses; pass++) {
			for (let i = 0; i < bodies.length; i++) {
				for (let j = i + 1; j < bodies.length; j++) {
					const a = bodies[i];
					const b = bodies[j];
					const centerDelta = sub(b.position, a.position);
					if (length(centerDelta) > a.block.radius + b.block.radius) continue;

					for (const capA of a.block.collisionCapsules) {
						const a0 = worldPoint(a, capA.localStart);
						const a1 = worldPoint(a, capA.localEnd);
						for (const capB of b.block.collisionCapsules) {
							const b0 = worldPoint(b, capB.localStart);
							const b1 = worldPoint(b, capB.localEnd);
							const { pa, pb } = closestSegmentPoints(a0, a1, b0, b1);
							const delta = sub(pb, pa);
							const dist = length(delta);
							const minDist = capA.radius + capB.radius;
							if (dist >= minDist) continue;
							const dir = normalizeOrFallback(
								delta,
								normalizeOrFallback(centerDelta, { x: 1, y: 0, z: 0 })
							);
							const magnitude = params.repulsionK * (1 - Math.max(dist, 1e-6) / minDist);
							const f = scale(dir, magnitude);
							applyForce(a, scale(f, -1), pa);
							applyForce(b, f, pb);
						}
					}
				}
			}
		}

		for (const body of bodies) {
			const invMass = 1 / Math.max(body.block.mass, 1e-6);
			body.velocity = add(scale(body.velocity, damping), scale(body.force, invMass * params.dt));
			body.position = add(body.position, scale(body.velocity, params.dt));

			const invI = 1 / averageInertia(body.block);
			body.angularVelocity = add(
				scale(body.angularVelocity, damping),
				scale(body.torque, invI * params.dt)
			);
			body.quaternion = integrateQuat(body.quaternion, body.angularVelocity, params.dt);
		}

		projectCapsuleOverlaps(bodies, params.collisionPasses);
	}
}

function buildSolverResult(bodies: WorkingBody[], constraints: DistanceConstraint[]): SolverResult {
	const byId = new Map(bodies.map((body) => [body.block.blockId, body]));
	let maxConstraintError = 0;
	let sumSq = 0;
	const stressMap = new Map<string, number>();
	for (const constraint of constraints) {
		const a = byId.get(constraint.blockIdA);
		const b = byId.get(constraint.blockIdB);
		if (!a || !b) continue;
		const dist = length(
			sub(worldPoint(b, constraint.localAttachB), worldPoint(a, constraint.localAttachA))
		);
		const err = Math.abs(dist - constraint.restLength);
		maxConstraintError = Math.max(maxConstraintError, err);
		sumSq += err * err;
		stressMap.set(constraint.id, constraint.restLength > 0 ? dist / constraint.restLength : 0);
	}

	let maxOverlap = 0;
	for (let i = 0; i < bodies.length; i++) {
		for (let j = i + 1; j < bodies.length; j++) {
			const a = bodies[i];
			const b = bodies[j];
			for (const capA of a.block.collisionCapsules) {
				const a0 = worldPoint(a, capA.localStart);
				const a1 = worldPoint(a, capA.localEnd);
				for (const capB of b.block.collisionCapsules) {
					const b0 = worldPoint(b, capB.localStart);
					const b1 = worldPoint(b, capB.localEnd);
					const { pa, pb } = closestSegmentPoints(a0, a1, b0, b1);
					maxOverlap = Math.max(maxOverlap, capA.radius + capB.radius - length(sub(pb, pa)));
				}
			}
		}
	}
	maxOverlap = Math.max(0, maxOverlap);

	const transforms = new Map<string, BlockTransformOverride>();
	for (const body of bodies) {
		transforms.set(body.block.blockId, {
			originalCenter: { ...body.block.originalCenter },
			position: { ...body.position },
			quaternion: { ...body.quaternion },
		});
	}

	return {
		transforms,
		stressMap,
		maxConstraintError,
		rmsConstraintError: constraints.length > 0 ? Math.sqrt(sumSq / constraints.length) : 0,
		maxOverlap,
	};
}

export function solveBlockLayout(
	blocks: BlockBody[],
	constraints: DistanceConstraint[],
	params: Partial<SolverParams> = DEFAULT_SOLVER_PARAMS
): SolverResult {
	const p = { ...DEFAULT_SOLVER_PARAMS, ...params };
	const bodies = createWorkingBodies(blocks);
	simulateSteps(bodies, constraints, p, p.iterations);
	return buildSolverResult(bodies, constraints);
}

export class SimulationRunner {
	private result: SolverResult | null = null;
	private bodies: WorkingBody[];

	constructor(
		blocks: BlockBody[],
		private constraints: DistanceConstraint[],
		private params: Partial<SolverParams> = DEFAULT_SOLVER_PARAMS
	) {
		this.bodies = createWorkingBodies(blocks);
	}

	runSteps(steps: number): void {
		const runParams = { ...DEFAULT_SOLVER_PARAMS, ...this.params };
		simulateSteps(this.bodies, this.constraints, runParams, Math.max(1, steps));
		this.result = buildSolverResult(this.bodies, this.constraints);
	}

	getResults(): Map<string, BlockTransformOverride> {
		this.result ??= buildSolverResult(this.bodies, this.constraints);
		return this.result.transforms;
	}

	getStressMap(): Map<string, number> {
		this.result ??= buildSolverResult(this.bodies, this.constraints);
		return this.result.stressMap;
	}

	getDiagnostics(): Pick<SolverResult, 'maxConstraintError' | 'rmsConstraintError' | 'maxOverlap'> {
		const result = this.result ?? buildSolverResult(this.bodies, this.constraints);
		return {
			maxConstraintError: result.maxConstraintError,
			rmsConstraintError: result.rmsConstraintError,
			maxOverlap: result.maxOverlap,
		};
	}
}

export function runSimulation(
	blocks: BlockBody[],
	constraints: DistanceConstraint[],
	params: Partial<SolverParams> = DEFAULT_SOLVER_PARAMS
): SolverResult {
	return solveBlockLayout(blocks, constraints, params);
}
