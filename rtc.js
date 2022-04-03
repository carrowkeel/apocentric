
const handleChannelStatus = (rtc_elem, event, user) => {
	if (event.type === 'open') {
		rtc_elem.dispatchEvent(new CustomEvent('channelconnected', {detail: {channel: event.target}}));
	} else if (event.type === 'close') {
		rtc_elem.dispatchEvent(new Event('channeldisconnected'));
	}
};

const addDataChannel = (rtc_elem, event, user, _channel) => {
	const channel = _channel || event.channel;
	channel.addEventListener('message', event => receiveMessage(rtc_elem, event, user));
	channel.addEventListener('open', event => handleChannelStatus(rtc_elem, event, user));
	channel.addEventListener('close', event => handleChannelStatus(rtc_elem, event, user));
	return channel;
};

const receiveMessage = (rtc_elem, event, user) => {
	const data = JSON.parse(event.data);
	console.log(data);
	rtc_elem.dispatchEvent(new CustomEvent('receivemessage', {detail: data}));
};

const sendCandidate = (apc, event, user) => {
	if (event.candidate) {
		apc.dispatchEvent(new CustomEvent('message', {detail: {type: 'rtc', user, data: {type: 'ice_candidate', user, data: event.candidate}}}));
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

const createPeerConnection = (rtc_elem, apc, user, ice_queue, active = true) => {
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
	connection.addEventListener('icecandidate', event => sendCandidate(apc, event, user));
	connection.addEventListener('icecandidateerror', event => console.log(event));
	connection.addEventListener('signalingstatechange', event => handleSignalingState(connection, event, user));
	connection.addEventListener('iceconnectionstatechange', event => handleConnectionState(connection, event, user));
	connection.addEventListener('icegatheringstatechange', event => processIceQueue(connection, ice_queue));
	if (active)
		addDataChannel(rtc_elem, undefined, user, connection.createDataChannel(user));
	else
		connection.addEventListener('datachannel', event => addDataChannel(rtc_elem, event, user));
	return connection;
};

const processOffer = async (apc, user, connection, offer) => {
	return connection.setRemoteDescription(offer)
		.then(() => connection.createAnswer())
		.then(answer => connection.setLocalDescription(answer))
		.then(() => apc.dispatchEvent(new CustomEvent('message', {detail: {type: 'rtc', user, data: {type: 'answer', user, data: connection.localDescription}}})))
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

const sendOffer = (apc, user, connection) => {
	connection.createOffer()
		.then(offer => connection.setLocalDescription(offer))
		.then(() => apc.dispatchEvent(new CustomEvent('message', {detail: {type: 'rtc', user, data: {type: 'offer', user, data: connection.localDescription}}})))
		.catch(e => console.log(e));
};

const process = async (apc, user, connection, ice_queue, rtc_data) => {
	switch (rtc_data.type) {
		case 'offer':
			processOffer(apc, user, connection, rtc_data.data); // Implement queue
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
export const rtc = (env, {connection_id: ws_connection_id}, elem, storage={ice_queue: []}) => ({
	render: async () => {
		elem.dispatchEvent(new Event('done'));
	},
	hooks: [
		['[data-module="rtc"]', 'connect', async e => {
			const apc = e.target.closest('.apocentric');
			storage.peer_connection = createPeerConnection(elem, apc, ws_connection_id, storage.ice_queue); // Find a way to have this not in storage
			sendOffer(apc, ws_connection_id, storage.peer_connection);
		}],
		['[data-module="rtc"]', 'receivedata', e => {
			const apc = e.target.closest('.apocentric');
			if (!storage.peer_connection)
				storage.peer_connection = createPeerConnection(elem, apc, ws_connection_id, storage.ice_queue, false);
			process(apc, ws_connection_id, storage.peer_connection, storage.ice_queue, e.detail.rtc_data);
		}],
		['[data-module="rtc"]', 'channelconnected', e => {
			storage.channel = e.detail.channel;
			elem.dispatchEvent(new Event('connected'));
			console.log(storage.channel);
		}],
		['[data-module="rtc"]', 'channeldisconnected', e => {
		}],
		['[data-module="rtc"]', 'message', e => {
			storage.channel.send(JSON.stringify(e.detail.data));
		}],
		['[data-module="rtc"]', 'receivemessage', e => {
			console.log(e.detail.data);
		}],
		['[data-module="rtc"]', 'disconnect', e => {
			storage.peer_connection.close();
		}]
	]
});
