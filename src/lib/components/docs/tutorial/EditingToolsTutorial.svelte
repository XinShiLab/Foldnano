<script lang="ts">
	import BrowserOnly from './BrowserOnly.svelte';
	import MiniStrandTutorial from './MiniStrandTutorial.svelte';
	import ModeToolbarDemo from './ModeToolbarDemo.svelte';
	import ToolPanelDemo from './ToolPanelDemo.svelte';
	import TutorialController from './TutorialController.svelte';
	import TutorialEditorContextProvider from './TutorialEditorContextProvider.svelte';
	import TutorialFrame from './TutorialFrame.svelte';
	import TutorialStep from './TutorialStep.svelte';
</script>

<BrowserOnly>
	<TutorialEditorContextProvider>
		<TutorialController initialMode="SELECT">
			<TutorialFrame
				title="Interactive Editing Tools"
				caption="Choose a tool or move through the lesson steps. The controls are live, but the design is an isolated tutorial document."
			>
				<div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
					<div class="space-y-4">
						<ModeToolbarDemo />
						<ToolPanelDemo />
					</div>

					<div class="space-y-2">
						<TutorialStep
							id="select-targets"
							mode="SELECT"
							target="mode-select"
							panel="select"
							caption="Select mode lets you decide which target classes are eligible before you click in the strand view."
						>
							<span class="font-medium">Select and filter targets</span>
							<span class="mt-1 block text-xs text-muted-foreground">
								Toggle scaffold/staple and target filters before selecting objects.
							</span>
						</TutorialStep>

						<TutorialStep
							id="draw-strands"
							mode="DRAW"
							target="mode-draw"
							panel={null}
							caption="Draw mode creates new strands or crossovers directly on the strand canvas."
						>
							<span class="font-medium">Draw a strand</span>
							<span class="mt-1 block text-xs text-muted-foreground">
								Drag across empty strand rows or from compatible free ends.
							</span>
						</TutorialStep>

						<TutorialStep
							id="break-strand"
							mode="BREAK"
							target="mode-break"
							panel={null}
							caption="Break mode splits the clicked segment into two undoable strand pieces."
						>
							<span class="font-medium">Break a strand</span>
							<span class="mt-1 block text-xs text-muted-foreground">
								Click the base position where the nick should be inserted.
							</span>
						</TutorialStep>

						<TutorialStep
							id="paint-oligo"
							mode="PAINT"
							target="mode-paint"
							panel="paint"
							caption="Paint mode uses the active color from the panel when you click an oligo."
						>
							<span class="font-medium">Paint an oligo</span>
							<span class="mt-1 block text-xs text-muted-foreground">
								Choose a saved, random, or custom color in the live panel.
							</span>
						</TutorialStep>

						<TutorialStep
							id="assign-sequence"
							mode="SEQUENCE"
							target="mode-sequence"
							panel="sequence"
							caption="Sequence mode controls whether the action fills every base or only the currently empty slots."
						>
							<span class="font-medium">Assign a sequence</span>
							<span class="mt-1 block text-xs text-muted-foreground">
								Set random, preset, custom, or remove behavior before clicking strands.
							</span>
						</TutorialStep>

						<TutorialStep
							id="terminal-modification"
							mode="MODIFICATION"
							target="mode-modification"
							panel="modification"
							caption="Modification mode applies the selected terminal chemistry to compatible free ends."
						>
							<span class="font-medium">Add a terminal modification</span>
							<span class="mt-1 block text-xs text-muted-foreground">
								Pick a built-in or custom modification, or switch to remove mode.
							</span>
						</TutorialStep>
					</div>
				</div>
				<div class="mt-4">
					<MiniStrandTutorial />
				</div>
			</TutorialFrame>
		</TutorialController>
	</TutorialEditorContextProvider>
</BrowserOnly>
