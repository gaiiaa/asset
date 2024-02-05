export type Asset<AssetType> = {
	data?: AssetType;
	id?: string;
	error?: Error;
	loading: boolean;
	promise?: Promise<AssetType>;
	load: () => Promise<AssetType>;
	subscribe: AssetSubscribeCallback;
	progress: number;
};

export enum Status {
	LOADING = "loading",
	LOADED = "loaded",
	ERROR = "error",
	PROGRESS = "progress",
}

export type AssetOptions = {
	id?: string;
};

export type AssetLoadFunction<T> = (
	updateProgress: (progress: number) => void
) => Promise<T> | T;

export type AssetSubscribeCallback = (
	callback: (message: Status) => void
) => void;

export const memo = <T>(fn: () => T | Promise<T>): () => T => {
	let started = false;
	let cache: any;
	return () => {
		if (!started) {
			started = true;
			cache = fn();
		}
		return cache;
	};
};

export const fetchWithProgress = async <T>(
	url: string,
	options: RequestInit & { onProgress?: (p: number) => void } = {}
) => {
	const response = await fetch(url, options);
	const reader = response.body.getReader();
	const contentLength = response.headers.get("Content-Length");
	const total = contentLength ? parseInt(contentLength, 10) : undefined;
	let received = 0;
	const stream = new ReadableStream({
		start(controller) {
			const pump = () => {
				reader.read().then(({ done, value }) => {
					if (done) {
						controller.close();
						return;
					}
					received += value.byteLength;
					options.onProgress && options.onProgress(received / total!);
					controller.enqueue(value);
					pump();
				});
			};
			pump();
		},
	});

	return new Response(stream, {
		headers: response.headers,
		status: response.status,
	});
};

export const asset = <T>(
	loader: AssetLoadFunction<T>,
	options: {
		id?: string;
	} = {}
): Asset<T> => {
	let data: T | undefined;
	let error: Error | undefined;
	let promise: Promise<T> | undefined;
	let loading = false;
	let p = 0;

	const subscribers = new Set<Function>();
	const subscribe: AssetSubscribeCallback = (callback) => {
		subscribers.add(callback);
		return () => {
			subscribers.delete(callback);
		};
	};

	const updateProgress = (progress: number) => {
		p = progress;
		subscribers.forEach((callback) => callback(Status.PROGRESS));
	};

	const load = async () => {
		if (loading) return;
		loading = true;
		subscribers.forEach((callback) => callback(Status.LOADING));
		try {
			const result = loader(updateProgress);
			if (result instanceof Promise) {
				promise = result;
				data = await result;
			} else {
				data = result;
			}
		} catch (e) {
			error = e;
			subscribers.forEach((callback) => callback(Status.ERROR));
		}
		loading = false;
		p = 1;
		subscribers.forEach((callback) => callback(Status.LOADED));
		return data;
	};

	return {
		get data() {
			if (data === undefined && !loading) {
				load();
			}
			return data;
		},
		error,
		loading,
		promise,
		load,
		subscribe,
		get id() {
			return options.id;
		},
		get progress() {
			return p;
		},
	};
};

export type LoaderInput = Asset<any> | (() => Promise<Asset<any>[]>);

export const loader = (...assets: LoaderInput[]) => {
	const subscribers = new Set<Function>();
	const _assets = [];
	const mapOfAssetsWithID = new Map<string, Asset<unknown>>();
	let promise: Promise<Asset<unknown>[]> | undefined;
	let loading = false;
	let error: Error | undefined;
	let progress = 0;

	const updateProgress = () => {
		const total = _assets.length;
		const loaded = _assets.reduce(
			(acc, asset) => acc + (asset.progress || 0),
			0
		);
		progress = total === 0 ? 0 : loaded / total;
		subscribers.forEach((callback) => callback(Status.PROGRESS));
	};

	const addToLoader = (asset: Asset<unknown>) => {
		_assets.push(asset);
		asset.id && mapOfAssetsWithID.set(asset.id, asset);
		asset.subscribe(updateProgress);
	};

	const start = () => {
		loading = true;
		if (promise) return promise;
		subscribers.forEach((callback) => callback(Status.LOADING));
		promise = Promise.all(
			assets.map((asset) => {
				if (asset instanceof Function) {
					return asset()
						.then((result) => {
							result.forEach((asset) => {
								addToLoader(asset);
							});
							return result;
						})
						.then((result) => {
							return Promise.all(result.map((asset) => asset.load()));
						});
				} else {
					addToLoader(asset);
					return asset.load();
				}
			})
		);
		promise
			.catch((e) => {
				error = e;
				subscribers.forEach((callback) => callback(Status.ERROR));
			})
			.finally(() => {
				loading = false;
				subscribers.forEach((callback) => callback(Status.LOADED));
			});
		return promise;
	};

	const get = (id: string): Asset<unknown> | undefined => {
		return mapOfAssetsWithID.get(id);
	};

	const subscribe = (callback: (message: Status) => void) => {
		subscribers.add(callback);
		return () => {
			subscribers.delete(callback);
		};
	};

	return {
		start,
		loading,
		error,
		get,
		assets: _assets,
    subscribe,
		get progress() {
      return progress;
    },
	};
};