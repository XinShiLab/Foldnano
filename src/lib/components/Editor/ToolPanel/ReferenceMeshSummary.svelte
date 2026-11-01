<script lang="ts">
	import type { ReferenceMesh } from '$lib/model/Part/DesignRegion';
	import { nmToApproxBp, summarizeReferenceMesh } from '$lib/model/geometry3d/referenceMesh';

	let { mesh }: { mesh: ReferenceMesh } = $props();

	const summary = $derived(summarizeReferenceMesh(mesh));
	const sizeText = $derived(summary.size.map((value) => formatNm(value)).join(' × '));

	function formatNm(value: number): string {
		return Number(value.toFixed(1)).toString();
	}
</script>

<dl class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
	<dt class="text-muted-foreground">Vertices</dt>
	<dd>{summary.vertexCount.toLocaleString()}</dd>
	<dt class="text-muted-foreground">Faces</dt>
	<dd>{summary.faceCount.toLocaleString()}</dd>
	<dt class="text-muted-foreground">Size</dt>
	<dd>{sizeText} nm</dd>
	<dt class="text-muted-foreground">Edges</dt>
	<dd>
		{formatNm(summary.shortestEdge)} to {formatNm(summary.longestEdge)} nm (about
		{nmToApproxBp(summary.shortestEdge).toLocaleString()} to
		{nmToApproxBp(summary.longestEdge).toLocaleString()} bp)
	</dd>
</dl>
