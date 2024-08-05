
export const resource = (env, {resource, settings, active}, elem, storage={}) => ({
	render: async () => {
		const threads = settings ? settings.used : resource.capacity;
		const frameworks = resource.frameworks.split(',').map(framework => `<a data-framework="${framework}">.${framework}</a>`).join('');
		elem.classList.add('item'); // Temp
		//elem.dataset.status = settings ? settings.status : 0;
		elem.dataset.connectionState = resource.connection_id === 'local' ? 3 : 1;
		elem.dataset.used = threads;
		elem.innerHTML = `<div class="details"><a class="name">${resource.connection_id === 'local' ? 'Local' : resource.name === 'node' ? resource.machine_id : resource.name}</a><div class="frameworks">${frameworks}</div></div><input class="threads" placeholder="${resource.capacity}" value="${threads}"><div class="clear"></div>`;
		elem.dispatchEvent(new Event('init'));
		elem.dispatchEvent(new Event('done'));
	},
	hooks: [
		['[data-module="resource"]', 'init', e => {
			if (elem.dataset.connection_id !== 'local' && active)
				elem.dispatchEvent(new Event('establishrtc'));
		}],
		['[data-module="resource"]', 'wsconnected', async e => {
			if (e.detail?.connection_id)
				elem.dataset.connection_id = e.detail.connection_id;
			elem.dataset.connectionState |= 1;
			elem.dispatchEvent(new Event('connectionstatechange'));
		}],
		['[data-module="resource"]', 'wsdisconnected', async e => {
			elem.dataset.connectionState &= ~1;
			elem.dispatchEvent(new Event('connectionstatechange'));
		}],
		['[data-module="resource"]', 'establishrtc', async e => {
			const connection_id = e.target.dataset.connection_id;
			// Remove previous modules? if disconnected?
			e.target.querySelectorAll('[data-module="rtc"]').forEach(rtc => rtc.remove());
			await addModule(e.target, 'rtc', {connection_id});
			e.target.querySelector('[data-module="rtc"]').dispatchEvent(new Event('connect'));
		}],
		['[data-module="resource"]', 'processrtc', async e => {
			const connection_id = e.target.dataset.connection_id;
			if (!e.target.querySelector('[data-module="rtc"]') && e.detail.type === 'offer') // Only offer can initiate rtc, need to check if this will make ice candidates get lost
				addModule(e.target, 'rtc', {connection_id, rtc_data: e.detail});
			else
				e.target.querySelector('[data-module="rtc"]').dispatchEvent(new CustomEvent('receivedata', {detail: e.detail}));
		}],
		['[data-module="resource"]', 'send', e => {
			if (e.target.dataset.connection_id === 'local')
				return elem.dispatchEvent(new CustomEvent('message', {detail: {message: e.detail}}));
			if (e.target.querySelector('[data-module="rtc"]') && e.target.querySelector('[data-module="rtc"]').dataset.status === 'connected')
				return e.target.querySelector('[data-module="rtc"]').dispatchEvent(new CustomEvent('send', {detail: e.detail}));
			// Locate ws element...
			const ws = e.target.closest('.apocentric').querySelector('[data-module="ws"]');
			// Decide where to handle problems with data unsuitable to be sent via WebSocket (i.e. too big)
			ws.dispatchEvent(new CustomEvent('send', {detail: Object.assign(e.detail, {user: e.target.dataset.connection_id})}));
		}],
		['[data-module="resource"]', 'message', e => {
			const message = e.detail.message;
			switch(message.type) {
				case 'rtc':
					return elem.dispatchEvent(new CustomEvent('processrtc', {detail: message.data}));
				case 'request': { // Should this be here or in apc
					return new Promise((resolve, reject) => {
						elem.closest('[data-module="apc"]').dispatchEvent(new CustomEvent('job', {detail: {request: message, resolve}}));
					}).then(result => elem.dispatchEvent(new CustomEvent('send', {detail: {type: 'result', request_id: message.request_id, data: result}})));
				}
			}
		}],
		['[data-module="rtc"]', 'connected', e => {
			elem.dataset.connectionState |= 2;
			elem.dispatchEvent(new Event('connectionstatechange'));
		}],
		['[data-module="rtc"]', 'disconnected', e => {
			elem.dataset.connectionState &= ~2;
			elem.dispatchEvent(new Event('connectionstatechange'));
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
			e.target.closest('[data-module="resource"]').dataset.used = e.target.value;
			// const machines = Array.from(e.target.closest('.apocentric').querySelectorAll('[data-machine_id]')).reduce((a,machine) => Object.assign(a, {[machine.dataset.machine_id]: {used: +(machine.querySelector('input.threads').value)}}), {});
			// Update settings in apc
			// cachedSettings({machines});
		}]
	]
});
