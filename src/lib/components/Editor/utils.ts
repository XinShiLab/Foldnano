import type { Stage } from 'svelte-konva';

export function exportStageAsPng(stage: Stage, fileName: string = 'stage', pixelRatio: number = 2) {
	const dataURL = stage.node.toDataURL({ pixelRatio });
	const baseName = fileName.replace(/\.png$/i, '') || 'stage';

	const link = document.createElement('a');
	link.download = `${baseName}.png`;
	link.href = dataURL;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
}
