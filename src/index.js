/**
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { wrapRequestWithProgress, wrapResponseWithProgress } from './stream.js';

/**
 * @public
 * @typedef Options
 * @property {string} [url] the URL to request
 * @property {'get'|'post'|'put'|'patch'|'delete'|'options'|'head'|'GET'|'POST'|'PUT'|'PATCH'|'DELETE'|'OPTIONS'|'HEAD'} [method="get"] HTTP method, case-insensitive
 * @property {RequestHeaders} [headers] Request headers
 * @property {FormData|string|object} [body] a body, optionally encoded, to send
 * @property {'text'|'json'|'stream'|'blob'|'arrayBuffer'|'formData'|'stream'} [responseType="json"] An encoding to use for the response
 * @property {Record<string,any>|URLSearchParams} [params] querystring parameters
 * @property {(params: Options['params']) => string} [paramsSerializer] custom function to stringify querystring parameters
 * @property {boolean} [withCredentials] Send the request with credentials like cookies
 * @property {string} [auth] Authorization header value to send with the request
 * @property {string} [xsrfCookieName] Pass an Cross-site Request Forgery prevention cookie value as a header defined by `xsrfHeaderName`
 * @property {string} [xsrfHeaderName] The name of a header to use for passing XSRF cookies
 * @property {(status: number) => boolean} [validateStatus] Override status code handling (default: 200-399 is a success)
 * @property {Array<(body: any, headers?: RequestHeaders) => any?>} [transformRequest] An array of transformations to apply to the outgoing request
 * @property {string} [baseURL] a base URL from which to resolve all URLs
 * @property {typeof window.fetch} [fetch] Custom window.fetch implementation
 * @property {any} [data]
 * @property {AbortSignal} [signal] AbortSignal for request cancellation
 * @property {(event: AxiosProgressEvent) => void} [onUploadProgress] Upload progress callback
 * @property {(event: AxiosProgressEvent) => void} [onDownloadProgress] Download progress callback
 */

/**
 * @public
 * @typedef RequestHeaders
 * @type {{[name: string]: string} | Headers}
 */

/**
 * @public
 * @typedef AxiosProgressEvent
 * @property {number} loaded Bytes loaded so far
 * @property {number} [total] Total bytes (if computable)
 * @property {number} [progress] Progress ratio (0-1, if total is available)
 * @property {number} bytes Bytes transferred in this chunk
 * @property {number} [rate] Transfer rate in bytes per second
 * @property {number} [estimated] Estimated time remaining in seconds
 * @property {boolean} upload Whether this is an upload event
 * @property {boolean} download Whether this is a download event
 * @property {boolean} lengthComputable Whether total length is computable
 */

/**
 * @public
 * @template T
 * @typedef Response
 * @property {number} status
 * @property {string} statusText
 * @property {Options} config the request configuration
 * @property {T} data the decoded response body
 * @property {Headers} headers
 * @property {boolean} redirect
 * @property {string} url
 * @property {ResponseType} type
 * @property {ReadableStream<Uint8Array> | null} body
 * @property {boolean} bodyUsed
 */

/**
 * @typedef BodylessMethod
 * @type {<T=any>(url: string, config?: Options) => Promise<Response<T>>}
 */

/**
 * @typedef BodyMethod
 * @type {<T=any>(url: string, body?: any, config?: Options) => Promise<Response<T>>}
 */

/**
 * @public
 * @param {Options} [defaults = {}]
 * @returns {redaxios}
 */
function create(defaults) {
	defaults = defaults || {};

	/**
	 * @public
	 * @template T
	 * @type {(<T = any>(config?: Options) => Promise<Response<T>>) | (<T = any>(url: string, config?: Options) => Promise<Response<T>>)}
	 */
	redaxios.request = redaxios;

	/** @public @type {BodylessMethod} */
	redaxios.get = (url, config) => redaxios(url, config, 'get');

	/** @public @type {BodylessMethod} */
	redaxios.delete = (url, config) => redaxios(url, config, 'delete');

	/** @public @type {BodylessMethod} */
	redaxios.head = (url, config) => redaxios(url, config, 'head');

	/** @public @type {BodylessMethod} */
	redaxios.options = (url, config) => redaxios(url, config, 'options');

	/** @public @type {BodyMethod} */
	redaxios.post = (url, data, config) => redaxios(url, config, 'post', data);

	/** @public @type {BodyMethod} */
	redaxios.put = (url, data, config) => redaxios(url, config, 'put', data);

	/** @public @type {BodyMethod} */
	redaxios.patch = (url, data, config) => redaxios(url, config, 'patch', data);

	/** @public */
	redaxios.all = Promise.all.bind(Promise);

	/**
	 * @public
	 * @template Args, R
	 * @param {(...args: Args[]) => R} fn
	 * @returns {(array: Args[]) => R}
	 */
	redaxios.spread = (fn) => /** @type {any} */ (fn.apply.bind(fn, fn));

	/**
	 * Check if an error is a cancellation error
	 * @public
	 * @param {any} error
	 * @returns {boolean}
	 */
	redaxios.isCancel = (error) => {
		return (error && error.name === 'AbortError') || (error && error.code === 'ERR_CANCELED') || (error && error.message === 'canceled');
	};

	/**
	 * Determines whether the payload is an error thrown by Axios
	 * @public
	 * @param {any} payload The value to test
	 * @returns {boolean} True if the payload is an error thrown by Axios, otherwise false
	 */
	redaxios.isAxiosError = (payload) => {
		return payload && typeof payload === 'object' && payload.isAxiosError === true;
	};

	/**
	 * Config-specific merge-function which creates a new config-object
	 * by merging two configuration objects together.
	 * @public
	 * @param {Options} config1
	 * @param {Options} config2
	 * @returns {Options} New object resulting from merging config2 to config1
	 */
	redaxios.mergeConfig = (config1, config2) => {
		return deepMerge(config1 || {}, config2 || {}, false);
	};

	/**
	 * @private
	 * @template T, U
	 * @param {T} opts
	 * @param {U} [overrides]
	 * @param {boolean} [lowerCase]
	 * @returns {{} & (T | U)}
	 */
	function deepMerge(opts, overrides, lowerCase) {
		let out = /** @type {any} */ ({}),
			i;
		if (Array.isArray(opts)) {
			// @ts-ignore
			return opts.concat(overrides);
		}
		for (i in opts) {
			const key = lowerCase ? i.toLowerCase() : i;
			out[key] = opts[i];
		}
		for (i in overrides) {
			const key = lowerCase ? i.toLowerCase() : i;
			const value = /** @type {any} */ (overrides)[i];
			out[key] = key in out && typeof value == 'object' ? deepMerge(out[key], value, key == 'headers') : value;
		}
		return out;
	}

	/**
	 * Issues a request.
	 * @public
	 * @template T
	 * @param {string | Options} urlOrConfig
	 * @param {Options} [config = {}]
	 * @param {any} [_method] (internal)
	 * @param {any} [data] (internal)
	 * @param {never} [_undefined] (internal)
	 * @returns {Promise<Response<T>>}
	 */
	function redaxios(urlOrConfig, config, _method, data, _undefined) {
		let url = /** @type {string} */ (typeof urlOrConfig != 'string' ? (config = urlOrConfig).url : urlOrConfig);

		const response = /** @type {Response<any>} */ ({ config });

		/** @type {Options} */
		const options = deepMerge(defaults, config);

		/** @type {RequestHeaders} */
		const customHeaders = {};

		data = data || options.data;

		(options.transformRequest || []).map((f) => {
			data = f(data, options.headers) || data;
		});

		if (options.auth) {
			customHeaders.authorization = options.auth;
		}

		if (data && typeof data === 'object' && typeof data.append !== 'function' && typeof data.text !== 'function') {
			data = JSON.stringify(data);
			customHeaders['content-type'] = 'application/json';
		}

		try {
			// @ts-ignore providing the cookie name without header name is nonsensical anyway
			customHeaders[options.xsrfHeaderName] = decodeURIComponent(
				// @ts-ignore accessing match()[2] throws for no match, which is intentional
				document.cookie.match(RegExp('(^|; )' + options.xsrfCookieName + '=([^;]*)'))[2]
			);
		} catch (e) {}

		if (options.baseURL) {
			url = url.replace(/^(?!.*\/\/)\/?/, options.baseURL + '/');
		}

		if (options.params) {
			url +=
				(~url.indexOf('?') ? '&' : '?') +
				(options.paramsSerializer ? options.paramsSerializer(options.params) : new URLSearchParams(options.params));
		}

		const fetchFunc = options.fetch || fetch;
		const method = (_method || options.method || 'get').toUpperCase();
		const hasBody = data && method !== 'GET' && method !== 'HEAD';

		const baseFetchOptions = {
			method: method,
			body: data,
			headers: deepMerge(options.headers, customHeaders, true),
			credentials: options.withCredentials ? 'include' : _undefined,
			signal: options.signal
		};

		// Handle upload progress with streaming
		let request = null;
		if (hasBody && options.onUploadProgress && typeof Request !== 'undefined' && typeof ReadableStream !== 'undefined') {
			try {
				request = new Request(url, baseFetchOptions);
				request = wrapRequestWithProgress(request, options.onUploadProgress, data);
			} catch (e) {
				// Fallback to regular fetch if streaming fails
				request = null;
			}
		}

		return fetchFunc(request || url, request ? undefined : baseFetchOptions)
			.then((res) => {
				// Handle download progress
				if (options.onDownloadProgress && typeof ReadableStream !== 'undefined') {
					res = wrapResponseWithProgress(res, options.onDownloadProgress);
				}

				for (const i in res) {
					if (typeof res[i] != 'function') response[i] = res[i];
				}

				// Make headers accessible as object (axios/inertia compatibility)
				if (res.headers && typeof res.headers.get === 'function') {
					response.headers = /** @type {any} */ (new Proxy(res.headers, {
						get(target, prop) {
							if (typeof prop === 'string' && !['get', 'has', 'forEach', 'entries', 'keys', 'values'].includes(prop)) {
								return target.get(prop) || target.get(prop.toLowerCase());
							}
							return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
						}
					}));
				}

				if (options.responseType == 'stream') {
					response.data = res.body;
					return response;
				}

				return res[options.responseType || 'text']()
					.then((data) => {
						response.data = data;
						if (options.responseType !== 'text' && typeof data === 'string') {
							try {
								response.data = JSON.parse(data);
							} catch (e) {}
						}
					})
					.catch(Object)
					.then(() => {
						const ok = options.validateStatus ? options.validateStatus(res.status) : res.ok;
						if (ok) {
							return response;
						} else {
							const error = new Error(`Request failed with status code ${res.status}`);
							error.response = response;
							error.config = options;
							error.isAxiosError = true;
							return Promise.reject(error);
						}
					});
			})
			.catch((error) => {
				// Handle abort errors
				if ((error && error.name === 'AbortError') || (error && error.code === 'ERR_CANCELED')) {
					const cancelError = new Error('canceled');
					cancelError.name = 'AbortError';
					cancelError.message = 'canceled';
					return Promise.reject(cancelError);
				}

				// For network errors, don't add response property
				// For HTTP errors, response should already be set above
				if (!error.response && error.message && /fetch|network/i.test(error.message)) {
					// Network error - no response
					return Promise.reject(error);
				}

				// Re-throw other errors
				return Promise.reject(error);
			});
	}

	/**
	 * @public
	 * @type {AbortController}
	 */
	redaxios.CancelToken = /** @type {any} */ (typeof AbortController == 'function' ? AbortController : Object);

	/**
	 * @public
	 * @type {Options}
	 */
	redaxios.defaults = defaults;

	/**
	 * @public
	 */
	redaxios.create = create;

	return redaxios;
}

const axios = create();

// Export named exports for compatibility with axios (matching axios's export pattern)
export const isCancel = axios.isCancel;
export const isAxiosError = axios.isAxiosError;
export const mergeConfig = axios.mergeConfig;
export const CancelToken = axios.CancelToken;
export const all = axios.all;
export const spread = axios.spread;

export default axios;
