/**
 * Streaming utilities for request/response with progress tracking
 */

/**
 * Calculate the size of a request body
 * @param {BodyInit | null | undefined} body
 * @returns {number}
 */
export function getBodySize(body) {
	if (!body) return 0;

	if (body instanceof FormData) {
		let size = 0;
		try {
			for (const [key, value] of body.entries()) {
				size += new TextEncoder().encode(`Content-Disposition: form-data; name="${key}"`).length;
				size += typeof value === 'string' ? new TextEncoder().encode(value).length : value.size;
			}
		} catch (e) {
			// Fallback if FormData iteration fails
		}
		return size;
	}

	if (body instanceof Blob) return body.size;
	if (body instanceof ArrayBuffer) return body.byteLength;
	if (typeof body === 'string') return new TextEncoder().encode(body).length;
	if (body instanceof URLSearchParams) return new TextEncoder().encode(body.toString()).length;
	if ('byteLength' in body) return body.byteLength;

	// Try to stringify objects
	if (typeof body === 'object' && body !== null) {
		try {
			return new TextEncoder().encode(JSON.stringify(body)).length;
		} catch {
			return 0;
		}
	}

	return 0;
}

/**
 * Calculate transfer rate using a sliding window
 * @param {number} samplesCount
 * @param {number} min
 * @returns {(chunkLength: number) => number | undefined}
 */
function createSpeedometer(samplesCount, min) {
	const bytes = new Array(samplesCount);
	const timestamps = new Array(samplesCount);
	let head = 0;
	let tail = 0;
	/** @type {number | undefined} */
	let firstSampleTS;

	return function push(chunkLength) {
		const now = Date.now();
		if (!firstSampleTS) firstSampleTS = now;

		bytes[head] = chunkLength;
		timestamps[head] = now;

		let i = tail;
		let bytesCount = 0;
		while (i !== head) {
			bytesCount += bytes[i++];
			i = i % samplesCount;
		}

		head = (head + 1) % samplesCount;
		if (head === tail) tail = (tail + 1) % samplesCount;

		if (now - firstSampleTS < min) return undefined;
		const passed = timestamps[tail] && now - timestamps[tail];
		return passed ? Math.round(bytesCount * 1000 / passed) : undefined;
	};
}

/**
 * Create an axios-compatible progress event
 * @param {number} loaded
 * @param {number} total
 * @param {number} bytes
 * @param {boolean} isUpload
 * @param {Function} speedometerFn
 * @returns {AxiosProgressEvent}
 */
function createProgressEvent(loaded, total, bytes, isUpload, speedometerFn) {
	const lengthComputable = total != null && total > 0;
	const progress = lengthComputable ? loaded / total : undefined;
	const rate = speedometerFn ? speedometerFn(bytes) : undefined;
	const estimated = rate && total && loaded <= total ? (total - loaded) / rate : undefined;

	return {
		loaded,
		total: lengthComputable ? total : undefined,
		progress,
		bytes,
		rate,
		estimated,
		upload: isUpload,
		download: !isUpload,
		lengthComputable
	};
}

/**
 * Wrap a stream with progress tracking
 * @param {ReadableStream<Uint8Array>} stream
 * @param {number} totalBytes
 * @param {(event: AxiosProgressEvent) => void} onProgress
 * @param {boolean} isUpload
 * @returns {ReadableStream<Uint8Array>}
 */
function wrapStreamWithProgress(stream, totalBytes, onProgress, isUpload) {
	if (!onProgress || !stream) return stream;

	let previousChunk;
	let transferredBytes = 0;
	const speedometer = createSpeedometer(10, 1000);

	return stream.pipeThrough(new TransformStream({
		transform(currentChunk, controller) {
			controller.enqueue(currentChunk);

			if (previousChunk) {
				transferredBytes += previousChunk.byteLength;
				onProgress(createProgressEvent(
					transferredBytes,
					totalBytes,
					previousChunk.byteLength,
					isUpload,
					speedometer
				));
			}

			previousChunk = currentChunk;
		},
		flush() {
			if (previousChunk) {
				transferredBytes += previousChunk.byteLength;
				onProgress(createProgressEvent(
					transferredBytes,
					totalBytes,
					previousChunk.byteLength,
					isUpload,
					speedometer
				));
			}
		}
	}));
}

/**
 * Wrap a Response with download progress tracking
 * @param {Response} response
 * @param {(event: AxiosProgressEvent) => void} onDownloadProgress
 * @returns {Response}
 */
export function wrapResponseWithProgress(response, onDownloadProgress) {
	if (!response.body || !onDownloadProgress) return response;
	if (response.status === 204) {
		return new Response(null, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers
		});
	}

	const totalBytes = Math.max(0, Number(response.headers.get('content-length')) || 0);
	return new Response(
		wrapStreamWithProgress(response.body, totalBytes, onDownloadProgress, false),
		{
			status: response.status,
			statusText: response.statusText,
			headers: response.headers
		}
	);
}

/**
 * Wrap a Request with upload progress tracking
 * @param {Request} request
 * @param {(event: AxiosProgressEvent) => void} onUploadProgress
 * @param {BodyInit | null} originalBody
 * @returns {Request}
 */
export function wrapRequestWithProgress(request, onUploadProgress, originalBody) {
	if (!request.body || !onUploadProgress) return request;

	const totalBytes = getBodySize(originalBody != null ? originalBody : request.body);
	return new Request(request, {
		// @ts-expect-error - duplex is not in types yet
		duplex: 'half',
		body: wrapStreamWithProgress(request.body, totalBytes, onUploadProgress, true)
	});
}

