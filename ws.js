
const range = (start,end) => Array.from(Array(end-start)).map((v,i)=>i+start);

const decodeBase64 = base64 => {
	const binary = atob(base64);
	const decoded = new Uint8Array(binary.length);
	for (const i in decoded)
		decoded[i] = binary.charCodeAt(i);
	return decoded;
};

const decodeWS = async base64 => {
	const {pako} = await import('./pako.js');
	const decompressed = pako.ungzip(decodeBase64(base64), {to: 'string'});
	return JSON.parse(decompressed);
};

const wsSendParts = async (ws, request, message_data, limit = 30 * 1024) => {
	const {pako} = await import('./pako.js');
	const compressed = pako.gzip(JSON.stringify(message_data));
	const base64 = btoa([].reduce.call(compressed, (p,c) => p+String.fromCharCode(c),''));
	if (base64.length > limit) {
		const parts = Math.ceil(base64.length / limit);
		for (const part of range(0, parts))
			ws.send(JSON.stringify({...request, part, parts, data: base64.slice(part * limit, (part + 1) * limit)}));
	} else
		ws.send(JSON.stringify({...request, data: base64}));
};

const wsReceiveParts = (ws, type, request_id, parts = []) => new Promise((resolve, reject) => {
	ws.addEventListener('message', e => {
		const message_data = JSON.parse(e.data);
		if (message_data.type !== type || message_data.request_id !== request_id)
			return;
		if (message_data.parts)
			parts.push([message_data.part, message_data.data]);
		if (message_data.parts === parts.length) {
			const combined = parts.sort((a,b) => a[0] - b[0]).map(v => v[1]).join('');
			decodeWS(combined).then(resolve);
		} else if (!message_data.parts) {
			const result = decodeWS(message_data.data);
			resolve(result);
		}
	});
});

const wsRequest = (options, machine, message_data) => new Promise(async (resolve, reject) => {
	switch(machine.type) {
		case 'node':
			const request_id = generateID(8);
			wsReceiveParts(options.ws, 'result', request_id).then(resolve);
			return wsSendParts(options.ws, {request_id, type: 'request', machine}, message_data);
	}
});

const processMessage = (container, ws) => { // Connect to module events
	const message_data = JSON.parse(e.data);
	switch(message_data.type) {
		case 'request':
			if (receiving.includes(message_data.request_id))
				return;
			const request = message_data.parts && message_data.parts > 1 ? await wsReceiveParts(ws, 'request', message_data.request_id, [[message_data.part, message_data.data]]) : decodeWS(message_data.data);
			Promise.all(request.collection ? request.collection.map(batch => options.local_queue({framework: request.framework, sources: request.sources, fixed_params: request.fixed_params, variable_params: batch})) : [options.local_queue(request)]).then(results => {
				return wsSendParts(ws, {type: 'result', request_id: message_data.request_id, connection_id: message_data.connection_id, machine_id: options.id}, results);
			});
			break;
		case 'resources':
			message_data.resources.forEach(resource => addResource(container.querySelector('[data-tab-content="resources"]'), options, resource));
			break;
		case 'connected': // New resource connected/disconnected - possibly process in apc
			addResource(container.querySelector('[data-tab-content="resources"]'), options, message_data.resource);
			break;
		case 'disconnected':
			container.querySelectorAll(`[data-connection_id="${message_data.connection_id}"]`).forEach(item => item.remove());
			break;
		case 'rtc':
			container.querySelector(`[data-connection_id="${message_data.connection_id}"]`).dispatchEvent(new CustomEvent('processrtc', {detail: {rtc_data: message_data.data, ws: ws}}));
			break;
	}
};

const connectWebSocket = (container, url) => {
	const ws = new WebSocket();
	ws.addEventListener('open', e => {
		container.dispatchEvent(new Event('connected'));
	});
	ws.addEventListener('close', e => {
		container.dispatchEvent(new Event('disconnected'));
	});
	ws.addEventListener('error', error => {
		console.log(e);
		container.dispatchEvent(new CustomEvent('error', {detail: {error}}));
	});
	ws.addEventListener('message', async e => {
		processMessage(container, ws);
	});
	return ws;
};

export const ws = (env, {options, local}, elem, storage={receiving: []}) => ({
	render: async () => {
		elem.innerHTML = `<a class="connect" data-icon="n">Connect</a>`;
		elem.dispatchEvent(new Event('done'));
	},
	hooks: [
		['[data-module="ws"]', 'connect', e => {
			const token = options.getCredentials('token');
			if (!token)
				return;
			const params = new URLSearchParams({authorization: token, ...local});
			elem.dataset.status = 'connecting';
			elem.querySelector('a.connect').textContent = 'Connecting';
			storage.ws = connectWebSocket(`${options.url}/?${params.toString()}`);
		}],
		['[data-module="ws"]', 'connected', e => {
			elem.dataset.status = 'connected';
			elem.querySelector('a.connect').textContent = 'Connected';
			options.ws.send(JSON.stringify({type: 'connected', local}));
		}],
		['[data-module="ws"]', 'disconnected', e => {
			if (elem.dataset.status === 'connected') // Check why it disconnected
				storage.ws = connectWebSocket(container, options, local);
			elem.dataset.status = 'disconnected';
			elem.querySelector('a.connect').textContent = 'Connect';

			// Move this to apc.js, this clears the resource menu when disconnected (it could instead simply disable the resources)
			container.querySelectorAll('[data-tab-content="resources"] [data-connection_id]:not([data-connection_id="local"])').forEach(item => item.remove());
		}],
		['[data-module="ws"]', 'send', e => {
			const {type, user, data} = e.detail;
			// Here add message splitting etc.
			storage.ws.send(JSON.stringify({type, connection_id: user, data}));
		}],
	]
});