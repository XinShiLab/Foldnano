/**
 * Shared data types for the block-based RBS pipeline.
 *
 * The solver is intentionally model-agnostic: it receives block bodies and
 * distance constraints derived from the cadnano model, and returns transient
 * transforms for 3D rendering.
 */

import type { Quat, Transform3D, Vec3 } from '$lib/model/geometry3d/types';
export type { Quat, Vec3 };

export interface BlockSpan {
	spanId: string;
	vhIndex: number;
	rowIdx: number;
	strandIdx: 0 | 1;
	lo: number;
	hi: number;
	segmentIds: string[];
}

export interface BlockCollisionCapsule {
	id: string;
	vhIndex: number;
	lo: number;
	hi: number;
	localStart: Vec3;
	localEnd: Vec3;
	radius: number;
}

export interface BlockBody {
	blockId: string;
	spans: BlockSpan[];
	collisionCapsules: BlockCollisionCapsule[];
	originalCenter: Vec3;
	position: Vec3;
	quaternion: Quat;
	mass: number;
	inertia: Vec3;
	radius: number;
}

export interface DistanceConstraint {
	id: string;
	blockIdA: string;
	blockIdB: string;
	localAttachA: Vec3;
	localAttachB: Vec3;
	restLength: number;
	source: 'unconstrained-crossover';
}

export interface BlockBuildResult {
	blocks: BlockBody[];
	constraints: DistanceConstraint[];
	segmentToBlockId: Map<string, string>;
	spanToBlockId: Map<string, string>;
}

// BlockTransformOverride is a render-time override only — never persisted.
export type BlockTransformOverride = Transform3D;

export interface SolverParams {
	iterations: number;
	dt: number;
	springK: number;
	repulsionK: number;
	damping: number;
	collisionPasses: number;
}

export interface SolverResult {
	transforms: Map<string, BlockTransformOverride>;
	/** Current distance per constraint as a multiple of rest length: dist / restLength */
	stressMap: Map<string, number>;
	maxConstraintError: number;
	rmsConstraintError: number;
	maxOverlap: number;
}
