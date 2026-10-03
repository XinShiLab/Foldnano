export interface Vec3 {
	x: number;
	y: number;
	z: number;
}

export interface Quat {
	x: number;
	y: number;
	z: number;
	w: number;
}

export interface Transform3D {
	originalCenter: Vec3;
	position: Vec3;
	quaternion: Quat;
}
