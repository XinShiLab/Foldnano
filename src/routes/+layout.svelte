<script lang="ts">
	import '../app.css';
	import fn from '$lib/assets/fn.svg';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '$lib/components/ui/sonner';
	import ErrorLogDialog from '$lib/components/Editor/ErrorLogDialog.svelte';
	import NoticeStack from '$lib/components/NoticeStack.svelte';
	import PrivacyNotice from '$lib/components/PrivacyNotice.svelte';
	let { children, data } = $props();
</script>

<svelte:head>
	<link rel="icon" href={fn} />
</svelte:head>

<ModeWatcher />
{@render children?.()}
<Toaster richColors position="bottom-right" />
<ErrorLogDialog />
<NoticeStack>
	<PrivacyNotice dismissed={data.privacyNoticeDismissed} />
</NoticeStack>
