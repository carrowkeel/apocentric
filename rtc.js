
const range = (start,end) => Array.from(Array(end-start)).map((v,i)=>i+start);

const decodeBase64 = base64 => {
	const binary = atob(base64);
	const decoded = new Uint8Array(binary.length);
	for (const i in decoded)
		decoded[i] = binary.charCodeAt(i);
	return decoded;
};

const compress = (data) => {
	const json_string = JSON.stringify(data);
	return json_string;
//	return btoa([].reduce.call(json_string, (p,c) => p+String.fromCharCode(c),''));
}

const decompress = base64 => {
	return base64;
	//return decodeBase64(base64);
};

const rtcReceiveParts = (channel, request_id, parts = [], n = 0) => new Promise((resolve, reject) => {
	channel.addEventListener('message', e => { // Remove listener when resolved
		const message_data = JSON.parse(e.data);
		if (message_data.request_id !== request_id)
			return;
		parts.push([message_data.part, message_data.data]);
		if (message_data.parts === parts.length)
			resolve(parts.sort((a,b) => a[0] - b[0]).map(v => v[1]).join(''));
	});
});

const decodeMessage = async (channel, message_data, receiving) => {
	const compressed = message_data.parts > 1 && message_data.request_id ? await rtcReceiveParts(channel, message_data.request_id, [[message_data.part, message_data.data]], receiving.push(message_data.request_id)) : message_data.data;
	const decompressed = message_data.compression === 'base64' ? parseJSON(decompress(compressed)) : compressed;
	return Object.assign(message_data, {data: decompressed});
};

const rtcSend = async (channel, request, rtc_message_limit = 100 * 1024) => { // The limit is higher so this could be increased
	const compressed = compress(request.data);
	if (compressed.length > rtc_message_limit) {
		const parts = Math.ceil(compressed.length / rtc_message_limit);
		for (const part of range(0, parts)) {
			const data = JSON.stringify(Object.assign(request, {part, parts, compression: 'base64', data: compressed.slice(part * rtc_message_limit, (part + 1) * rtc_message_limit)}));
			channel.send(data);
		}
	} else
		channel.send(JSON.stringify(request));
};

const handleChannelStatus = (rtc_elem, event, user) => { // Fix inconsistency of using "event" vs "e" in this file
	if (event.type === 'open') {
		rtc_elem.dispatchEvent(new CustomEvent('channelconnected', {detail: {channel: event.target}}));
	} else if (event.type === 'close') {
		rtc_elem.dispatchEvent(new Event('channeldisconnected'));
	}
};

const addDataChannel = (rtc_elem, event, user, receiving, _channel) => {
	const channel = _channel || event.channel;
	channel.addEventListener('message', event => receiveMessage(rtc_elem, event, user, receiving));
	channel.addEventListener('open', event => handleChannelStatus(rtc_elem, event, user));
	channel.addEventListener('close', event => handleChannelStatus(rtc_elem, event, user));
	return channel;
};

const receiveMessage = async (rtc_elem, event, user, receiving) => {
	const message_data = parseJSON(event.data);
	if (message_data.request_id && receiving.includes(message_data.request_id))
		return;
	const channel = event.target;
	const message = await decodeMessage(channel, message_data, receiving);
	rtc_elem.dispatchEvent(new CustomEvent('message', {detail: {message}}));
};

const sendCandidate = (resource, event, user) => {
	if (event.candidate) {
		resource.dispatchEvent(new CustomEvent('send', {detail: {type: 'rtc', data: {type: 'ice_candidate', user, data: event.candidate}}}));
	}
};

const processIceQueue = async (connection, queue) => {
	while (connection.signalingState === 'stable' && connection.iceConnectionState !== 'connected' && queue && queue.length > 0) {
		try {
			await connection.addIceCandidate(queue.shift());
		} catch (e) {
			console.log(e);
		}
	}
};

const handleSignalingState = async (connection, event, user) => {
};

const handleConnectionState = async (connection, event, user) => {
	if (connection.iceConnectionState === 'failed')
		connection.restartIce();
};

const createPeerConnection = (rtc_elem, resource, user, ice_queue, receiving, active = true) => {
	const google_stun = {
		urls: [
			'stun:stun.l.google.com:19302',
			'stun:stun1.l.google.com:19302',
			'stun:stun2.l.google.com:19302',
			'stun:stun3.l.google.com:19302',
			'stun:stun4.l.google.com:19302'
		]
	};
	const connection = new RTCPeerConnection({iceServers: [google_stun]});
	connection.addEventListener('icecandidate', event => sendCandidate(resource, event, user));
	connection.addEventListener('icecandidateerror', event => console.log(event));
	connection.addEventListener('signalingstatechange', event => handleSignalingState(connection, event, user));
	connection.addEventListener('iceconnectionstatechange', event => handleConnectionState(connection, event, user));
	connection.addEventListener('icegatheringstatechange', event => processIceQueue(connection, ice_queue));
	if (active)
		addDataChannel(rtc_elem, undefined, user, receiving, connection.createDataChannel(user));
	else
		connection.addEventListener('datachannel', event => addDataChannel(rtc_elem, event, user, receiving));
	return connection;
};

const processOffer = async (resource, user, connection, offer) => {
	return connection.setRemoteDescription(offer)
		.then(() => connection.createAnswer())
		.then(answer => connection.setLocalDescription(answer))
		.then(() => resource.dispatchEvent(new CustomEvent('send', {detail: {type: 'rtc', data: {type: 'answer', user, data: connection.localDescription}}})))
		.catch(e => console.log('Error processing offer: '+e));
};

const processAnswer = (connection, answer) => {
	if (connection.signalingState !== 'have-local-offer')
		return console.log(`Setting answer with ${connection ? connection.signalingState : 'no client'} state`, 'RTC process answer');
	connection.setRemoteDescription(answer)
		.catch(e => {
			console.log(e, 'RTC process answer');
			connection.restartIce();
		});
};

const sendOffer = (resource, user, connection) => {
	connection.createOffer()
		.then(offer => connection.setLocalDescription(offer))
		.then(() => resource.dispatchEvent(new CustomEvent('send', {detail: {type: 'rtc', data: {type: 'offer', user, data: connection.localDescription}}})))
		.catch(e => console.log(e));
};

const process = async (resource, user, connection, ice_queue, rtc_data) => {
	switch (rtc_data.type) {
		case 'offer':
			processOffer(resource, user, connection, rtc_data.data); // Implement queue
			break;
		case 'answer':
			processAnswer(connection, rtc_data.data);
			break;
		case 'ice_candidate':
			ice_queue.push(rtc_data.data);
			processIceQueue(connection, ice_queue);
			break;
	}
};

// Missing: configuration for local STUN server
export const rtc = (env, {connection_id: ws_connection_id, rtc_data}, elem, storage={ice_queue: [], receiving: []}) => ({
	render: async () => {
		if (rtc_data)
			elem.dispatchEvent(new CustomEvent('receivedata', {detail: rtc_data}));
		elem.dispatchEvent(new Event('done'));
	},
	hooks: [
		['[data-module="rtc"]', 'connect', async e => {
			const resource = e.target.closest('[data-module="resource"]');
			storage.peer_connection = createPeerConnection(elem, resource, ws_connection_id, storage.ice_queue, storage.receiving); // Find a way to have this not in storage
			sendOffer(resource, ws_connection_id, storage.peer_connection);
		}],
		['[data-module="rtc"]', 'receivedata', e => {
			const resource = e.target.closest('[data-module="resource"]');
			if (!storage.peer_connection)
				storage.peer_connection = createPeerConnection(elem, resource, ws_connection_id, storage.ice_queue, storage.receiving, false);
			process(resource, ws_connection_id, storage.peer_connection, storage.ice_queue, e.detail);
		}],
		['[data-module="rtc"]', 'channelconnected', e => { // Update connection state
			storage.channel = e.detail.channel;
			elem.dataset.status = 'connected';
			elem.dispatchEvent(new Event('connected'));
		}],
		['[data-module="rtc"]', 'channeldisconnected', e => {
			elem.dataset.status = 'disconnected';
		}],
		['[data-module="rtc"]', 'send', e => {
			try {
				rtcSend(storage.channel, e.detail);
			} catch (e) {
				console.log(e);
			}
		}],
		['[data-module="rtc"]', 'message', e => {
			elem.closest('[data-module="resource"]').dispatchEvent(new CustomEvent('message', {detail: e.detail}));
		}],
		['[data-module="rtc"]', 'disconnect', e => {
			storage.peer_connection.close();
		}]
	]
});
