
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
			if (!e.target.querySelector('[data-module="rtc"]'))
				await addModule(e.target, 'rtc', {connection_id});
			e.target.querySelector('[data-module="rtc"]').dispatchEvent(new CustomEvent('receivedata', {detail: e.detail}));
		}],
		['[data-module="resource"]', 'rtcconnected', e => {
			console.log(resource, 'rtcconnected');
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
			const machines = Array.from(e.target.closest('.apocentric').querySelectorAll('[data-machine_id]')).reduce((a,machine) => Object.assign(a, {[machine.dataset.machine_id]: {used: +(machine.querySelector('input.threads').value)}}), {});
			// Update settings in apc
			// cachedSettings({machines});
		}]
	]
});
