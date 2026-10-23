// File System Access API members TypeScript's DOM lib doesn't ship (Chromium only).

declare global {
	type FileSystemPermissionMode = 'read' | 'readwrite';

	interface FileSystemHandlePermissionDescriptor {
		mode?: FileSystemPermissionMode;
	}

	interface FileSystemHandle {
		queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
		requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
	}

	interface FileSystemDirectoryHandle {
		values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>;
	}

	interface DirectoryPickerOptions {
		id?: string;
		mode?: FileSystemPermissionMode;
		startIn?: FileSystemHandle | 'desktop' | 'documents' | 'downloads';
	}

	interface Window {
		showDirectoryPicker?(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
	}
}

export {};
