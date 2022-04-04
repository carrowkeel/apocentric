
/*
const processMessage = (container, ws, message_data) => {
	switch(message_data.type) {
		case 'request':
			if (receiving.includes(message_data.request_id))
				return;
			const request = message_data.parts && message_data.parts > 1 ? await wsReceiveParts(ws, 'request', message_data.request_id, [[message_data.part, message_data.data]]) : decodeWS(message_data.data);
			Promise.all(request.collection ? request.collection.map(batch => options.local_queue({framework: request.framework, sources: request.sources, fixed_params: request.fixed_params, variable_params: batch})) : [options.local_queue(request)]).then(results => {
				return wsSendParts(ws, {type: 'result', request_id: message_data.request_id, connection_id: message_data.connection_id, machine_id: options.id}, results);
			});
			break;
	}
};
*/

export const resource = (env, {resource, settings}, elem, storage={}) => ({
	render: async () => {
		const threads = settings ? settings.used : (resource.cost > 0 ? 0 : resource.capacity);
		const frameworks = resource.frameworks.split(',').map(framework => `<a data-framework="${framework}">.${framework}</a>`).join('');
		elem.classList.add('item'); // Temp
		elem.dataset.status = settings ? settings.status : 0;
		elem.dataset.used = threads;
		elem.innerHTML = `<div class="details"><a class="name">${resource.name === 'node' ? resource.machine_id : resource.name}</a><div class="cost" data-cost="${resource.cost}">\$${resource.cost}/min</div><div class="frameworks">${frameworks}</div></div><input class="threads" placeholder="${resource.capacity}" value="${threads}"><div class="clear"></div>`;
		elem.dispatchEvent(new Event('init'));
		elem.dispatchEvent(new Event('done'));
	},
	hooks: [
		['[data-module="resource"]', 'establishrtc', async e => {
			const connection_id = e.target.dataset.connection_id;
			await addModule(e.target, 'rtc', {connection_id});
			e.target.querySelector('[data-module="rtc"]').dispatchEvent(new Event('connect'));
		}],
		['[data-module="resource"]', 'processrtc', async e => {
			const connection_id = e.target.dataset.connection_id;
			console.log(e.detail);
			if (!e.target.querySelector('[data-module="rtc"]'))
				await addModule(e.target, 'rtc', {connection_id});
			e.target.querySelector('[data-module="rtc"]').dispatchEvent(new CustomEvent('receivedata', {detail: e.detail}));
		}],
		['[data-module="resource"]', 'send', e => {
			if (e.target.dataset.connectionId === 'local')
				return;
			if (e.target.querySelector('[data-module="rtc"]') && e.target.querySelector('[data-module="rtc"]').dataset.status === 'connected')
				return e.target.querySelector('[data-module="rtc"]').dispatchEvent(new CustomEvent('send', {detail: e.detail}));
			// Locate ws element...
			const ws = e.target.closest('.apocentric').querySelector('[data-module="ws"]');
			// Decide where to handle problems with data unsuitable to be sent via WebSocket (i.e. too big)
			ws.dispatchEvent(new CustomEvent('send', {detail: e.detail}));
		}],
		['[data-module="resource"]', 'message', e => {
			const message = e.detail.message;
			console.log(message);
			switch(message.type) {
				case 'rtc':
					return elem.dispatchEvent(new CustomEvent('processrtc', {detail: message.data})); // Remove later
				default:
					console.log(e);
			}
		}],
		['[data-module="rtc"]', 'connected', e => {
			elem.classList.add('rtc');
		}],
		['.apocentric', 'resourcestatus', e => {
			const active_threads = e.detail.workers.filter(v => v !== undefined).length;
			const used = active_threads / e.detail.threads;
			e.target.closest('.apocentric').querySelector('.resources-icon').dataset.notify = active_threads;
		}],
		['.resources-menu .name', 'click', e => {
			elem.dispatchEvent(new Event('establishrtc'));
			//e.target.closest('[data-connection_id]').classList.toggle('disabled');
		}],
		['.resources-menu .threads', 'focusout', e => {
			e.target.closest('[data-module="resource"]').dataset.threads = e.target.value;
			const machines = Array.from(e.target.closest('.apocentric').querySelectorAll('[data-machine_id]')).reduce((a,machine) => Object.assign(a, {[machine.dataset.machine_id]: {used: +(machine.querySelector('input.threads').value)}}), {});
			// Update settings in apc
			// cachedSettings({machines});
		}]
	]
});
