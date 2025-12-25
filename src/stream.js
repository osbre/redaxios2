/**
 * Minimal, safe streaming progress helpers for fetch
 * Axios-compatible progress events (best-effort)
 */

const encoder = new TextEncoder();

/**
 * Plain object check
 */
function isPlainObject(val) {
	return Object.prototype.toString.call(val) === '[object Object]';
}

/**
 * Best-effort body size.
 * Returns undefined when size is unknowable (correct behavior).
 * @param {BodyInit | null | undefined} body
 * @returns {number | undefined}
 */
export function getBodySize(body) {
	if (!body) return undefined;

	if (typeof body === 'string') return encoder.encode(body).length;
	if (body instanceof Blob) return body.size;
	if (body instanceof ArrayBuffer) return body.byteLength;
	if (ArrayBuffer.isView(body)) return body.byteLength;
	if (body instanceof URLSearchParams) return encoder.encode(body.toString()).length;

	// FormData & streams: unknowable
	if (typeof FormData !== 'undefined' && body instanceof FormData) return undefined;
	if (body instanceof ReadableStream) return undefined;

	// Only stringify plain objects
	if (isPlainObject(body)) {
		try {
			return encoder.encode(JSON.stringify(body)).length;
		} catch {
			return undefined;
		}
	}

	return undefined;
}

/**
 * Sliding-window speed estimator
 */
function createSpeedometer(samples = 10, minTime = 300) {
	const samplesBuf = [];
	return function push(bytes) {
		const now = Date.now();
		samplesBuf.push({ bytes, now });

		// drop old samples
		while (samplesBuf.length > samples) samplesBuf.shift();
		const first = samplesBuf[0];
		const last = samplesBuf[samplesBuf.length - 1];
		if (!first || last.now - first.now < minTime) return undefined;

		const totalBytes = samplesBuf.reduce((s, x) => s + x.bytes, 0);
		const duration = last.now - first.now;
		return duration > 0 ? Math.round(totalBytes * 1000 / duration) : undefined;
	};
}

/**
 * Create axios-style progress event
 */
function progressEvent({ loaded, total, bytes, rate, upload }) {
	const lengthComputable = typeof total === 'number' && total > 0;
	return {
		loaded,
		total: lengthComputable ? total : undefined,
		progress: lengthComputable ? loaded / total : undefined,
		bytes,
		rate,
		estimated: rate && lengthComputable ? (total - loaded) / rate : undefined,
		upload,
		download: !upload,
		lengthComputable
	};
}

/**
 * Wrap a ReadableStream with progress tracking
 */
function wrapStream(stream, total, onProgress, upload) {
	if (!onProgress || !stream) return stream;
	if (typeof TransformStream === 'undefined') return stream;

	let loaded = 0;
	const speed = createSpeedometer();

	return stream.pipeThrough(new TransformStream({
		transform(chunk, controller) {
			loaded += chunk.byteLength;
			const rate = speed(chunk.byteLength);

			onProgress(progressEvent({
				loaded,
				total,
				bytes: chunk.byteLength,
				rate,
				upload
			}));

			controller.enqueue(chunk);
		}
	}));
}

/**
 * Wrap Response for download progress
 */
export function wrapResponseWithProgress(response, onDownloadProgress) {
	if (!response.body || !onDownloadProgress) return response;

	const total = Number(response.headers.get('content-length'));
	const totalBytes = Number.isFinite(total) && total > 0 ? total : undefined;

	const wrappedBody = wrapStream(
		response.body,
		totalBytes,
		onDownloadProgress,
		false
	);

	// clone safely
	return new Response(wrappedBody, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers
	});
}

/**
 * Wrap Request for upload progress
 */
export function wrapRequestWithProgress(request, onUploadProgress, originalBody) {
	if (!request.body || !onUploadProgress) return request;
	if (typeof ReadableStream === 'undefined') return request;

	const total = getBodySize(originalBody ?? request.body);

	return new Request(request, {
		// fetch streaming upload requires this
		// @ts-expect-error
		duplex: 'half',
		body: wrapStream(
			request.body,
			total,
			onUploadProgress,
			true
		)
	});
}
