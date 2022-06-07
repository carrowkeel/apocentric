
const range = (start,end) => Array.from(Array(end-start)).map((v,i)=>i+start);

const decodeBase64 = base64 => {
	const binary = atob(base64);
	const decoded = new Uint8Array(binary.length);
	for (const i in decoded)
		decoded[i] = binary.charCodeAt(i);
	return decoded;
};

const compress = async (data) => {
	const {pako} = await import('./pako.js');
	const compressed = pako.gzip(JSON.stringify(data));
	return btoa([].reduce.call(compressed, (p,c) => p+String.fromCharCode(c),''));
}

const decompress = async base64_compressed => {
	const {pako} = await import('./pako.js');
	return pako.ungzip(decodeBase64(base64_compressed), {to: 'string'});
};

const wsReceiveParts = (ws, request_id, parts = [], n = 0) => new Promise((resolve, reject) => {
	ws.addEventListener('message', e => {
		const message_data = JSON.parse(e.data);
		if (message_data.request_id !== request_id)
			return;
		parts.push([message_data.part, message_data.data]);
		if (message_data.parts === parts.length)
			resolve(parts.sort((a,b) => a[0] - b[0]).map(v => v[1]).join(''));
	});
});

const wsSend = async (ws, request, websocket_frame_limit = 30 * 1024, compression_threshold = 10 * 1024) => { // Fix issue with json encoding
	if (request.data instanceof ReadableStream) // For the moment, do not transmit stream data via websocket (an alternative is to turn the stream into chunks)
		throw 'Attempting to transmit stream via WebSocket';
	const compression_type = JSON.stringify(request.data).length > compression_threshold ? 'gzip' : 'none';
	const compressed = compression_type === 'gzip' ? await compress(request.data) : request.data;
	if (compressed.length > websocket_frame_limit) { // This is only relevant for JSON encoded because compressed can be an object, fix
		const parts = Math.ceil(compressed.length / websocket_frame_limit);
		for (const part of range(0, parts))
			ws.send(JSON.stringify(Object.assign(request, {part, parts, compression: compression_type, data: compressed.slice(part * websocket_frame_limit, (part + 1) * websocket_frame_limit)})));
	} else
		ws.send(JSON.stringify(Object.assign(request, {compression: compression_type, data: compressed})));
};

const decodeMessage = async (ws, message_data, receiving) => {
	const compressed = message_data.parts > 1 && message_data.request_id ? await wsReceiveParts(ws, message_data.request_id, [[message_data.part, message_data.data]], receiving.push(message_data.request_id)) : message_data.data; // Maybe some redundancy here, what is in parts is definitely compressed
	const decompressed = message_data.compression === 'gzip' ? parseJSON(await decompress(compressed)) : compressed;
	return Object.assign(message_data, {data: decompressed});
};

const connectWebSocket = (container, url, getCredentials, receiving = []) => {
	const ws = new WebSocket(url);
	ws.addEventListener('open', e => {
		container.dispatchEvent(new Event('connected'));
	});
	ws.addEventListener('close', e => {
		container.dispatchEvent(new Event('disconnected'));
	});
	ws.addEventListener('error', error => {
		container.dispatchEvent(new CustomEvent('error', {detail: {error}}));
		container.dispatchEvent(new Event('disconnected'));
	});
	ws.addEventListener('message', async e => {
		const message_data = parseJSON(e.data);
		if (message_data.user_id !== undefined && message_data.user_id !== getCredentials('user_id')) {
			console.warn(`Ignoring message from user '${message_data.user_id}'`);
			return;
		}
		if (message_data.request_id && receiving.includes(message_data.request_id))
			return;
		const message = await decodeMessage(ws, message_data, receiving);
		container.dispatchEvent(new CustomEvent('message', {detail: {message}}));
	});
	return ws;
};

export const ws = (env, {options, local}, elem, storage={receiving: []}) => ({
	render: async () => {
		elem.innerHTML = `<a class="connect" data-icon="n">Connect</a>`; // cachedSettings().connected for autoconnect
		elem.dataset.status = 'disconnected';
		if (options.getCredentials('token'))
			elem.dispatchEvent(new Event('connect'));
		elem.dispatchEvent(new Event('done'));
	},
	hooks: [
		['[data-module="ws"]', 'connect', e => {
			if (storage.ws && storage.ws.readyState <= 1)
				return; // Possibly check if status is "connecting"
			const token = options.getCredentials('token');
			if (!token)
				return;
			const params = new URLSearchParams({authorization: token, ...local}); // Maybe get local resource from DOM
			elem.dataset.status = 'connecting';
			elem.querySelector('.connect').textContent = 'Connecting';
			storage.ws = connectWebSocket(elem, `${options.url}/?${params.toString()}`, options.getCredentials);
		}],
		['[data-module="ws"]', 'disconnect', e => {
			if (!storage.ws)
				return;
			elem.dataset.status = 'disconnected';
			elem.querySelector('.connect').textContent = 'Connect';
			storage.ws.close();
		}],
		['[data-module="ws"]', 'connected', e => {
			elem.dataset.status = 'connected';
			elem.querySelector('.connect').textContent = 'Connected';
			elem.dispatchEvent(new CustomEvent('send', {detail: {type: 'connected', data: local}}));
		}],
		['[data-module="ws"]', 'disconnected', e => {
			if (elem.dataset.status !== 'disconnected') // Check why it disconnected
				return elem.dispatchEvent(new Event('connect'));
			elem.dataset.status = 'disconnected';
			elem.querySelector('.connect').textContent = 'Connect';
		}],
		['[data-module="ws"]', 'send', e => {
			return wsSend(storage.ws, e.detail);
		}],
		['[data-module="ws"]', 'message', e => {
		}],
		['.connect', 'click', e => {
			if (elem.dataset.status === 'disconnected') {
				//cachedSettings({connected: true});
				elem.dispatchEvent(new Event('connect'));
			} else {
				//cachedSettings({connected: false});
				elem.dispatchEvent(new Event('disconnect'));
			}
		}],
	]
});
