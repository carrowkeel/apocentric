
const range = (start,end) => Array.from(Array(end-start)).map((v,i)=>i+start);
const sum = arr => arr.reduce((a,v) => a + v, 0);
const randint = (m,m1) => Math.floor(Math.random() * (m1 - m)) + m;
const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const generateID = l => Array.from(new Array(l)).map(v=>letters[randint(0, letters.length)]).join('');

const parseJSON = (text, default_value={}) => {
	try {
		if (text === null)
			throw 'JSON string missing';
		return JSON.parse(text);
	} catch (e) {
		return default_value;
	}
};

const spawnWorker = (options, workers, i, request, stream) => new Promise(resolve => {
	if (workers[i] === undefined) {
		workers[i] = new Worker(options.worker_script || '/worker.js');
	}
	workers[i].postMessage(Object.assign({}, request, {credentials: options.getCredentials()}));
	workers[i].addEventListener('message', e => {
		const message = e.data;
		switch(message.type) {
			case 'dynamics':
				return stream(message.data);
			default:
				stream(false);
				resolve(message.data);
		}
	});
});

const workerQueue = (container, options, workers=Array.from(new Array(options.threads)), queue=[]) => (request, stream=()=>{}) => {
	container.dispatchEvent(new CustomEvent('resourcestatus', {detail: {workers, threads: options.threads}}));
	const deploy = (workers, thread) => spawnWorker(options, workers, thread, request, stream).then(result => {
		if (queue.length > 0) {
			const {r, d} = queue.shift();
			r(d(workers, thread));
		} else {
			workers[thread].terminate();
			workers[thread] = undefined;
			container.dispatchEvent(new CustomEvent('resourcestatus', {detail: {workers, threads: options.threads}}));
		}
		return result;
	});
	const i = workers.indexOf(undefined);
	if (i === -1) {
		return new Promise(r => {
			queue.push({r, d: deploy});
		});
	}
	return deploy(workers, i);
};

const getID = () => {
	if (localStorage.getItem('apc_machine_id'))
		return localStorage.getItem('apc_machine_id');
	const id = generateID(6);
	localStorage.setItem('apc_machine_id', id)
	return id;
};

const getName = () => {
	if (localStorage.getItem('apc_machine_name'))
		return localStorage.getItem('apc_machine_name');
	const name = 'node';
	localStorage.setItem('apc_machine_name', name)
	return name;
};

const batchJobs = (jobs, threads, time=100, min_time=1000) => {
	const n = Math.min(threads, Math.ceil(jobs.length * time / min_time), jobs.length);
	const batch_size = Math.ceil(jobs.length / n);
	const batches = range(0, n).map(i => jobs.slice(i * batch_size, (i + 1) * batch_size));
	return batches.filter(v => v.length > 0);
};

const distributeDynamics = (container, request) => new Promise((resolve, reject) => {
	const {framework, sources, params} = request;
	const resources = Array.from(container.querySelectorAll('[data-module="resource"]'))
		.filter(resource => resource.dataset.used > 0 && resource.dataset.frameworks.split(',').includes(framework))
		.sort((a,b) => resource.dataset.connection_id === 'local' || b.dataset.used - a.dataset.used);
	if (resources.length === 0)
		throw 'No available threads';
	const resource = resources[0]; // Just use first resource for the moment
	const request_id = generateID(8);
	resource.dispatchEvent(new CustomEvent('send', {detail: {type: 'request', request_id, data: {framework, sources, fixed_params: params}}}));
	if (resource.dataset.connection_id === 'local') {
		resource.addEventListener('message', e => {
			const message = e.detail.message;
			if (message.type !== 'result' || message.request_id !== request_id)
				return;
			if (message.data instanceof ReadableStream)
				resolve(message.data);
			else
				reject(`Incorrect result data format: ${typeof message.data}`);
		});
	} else {
		resolve(new ReadableStream({
			start(controller) {
				resource.addEventListener('message', e => {
					const message = e.detail.message;
					if (message.type !== 'result' || message.request_id !== request_id)
						return;
					if (message.data?.stream_closed)
						controller.close();
					else
						controller.enqueue(message.data);
				});
			}
		}));
	}
});

const distribute = (container, request) => {
	const {id, framework, sources, fixed_params, variable_params} = request;
	const resources = Array.from(container.querySelectorAll('[data-module="resource"]'))
		.filter(resource => resource.dataset.used > 0 && resource.dataset.frameworks.split(',').includes(framework))
		.sort((a,b) => a.local || b.dataset.used - a.dataset.used);
	const threads = sum(resources.map(resource => +(resource.dataset.used)));
	if (threads === 0)
		throw 'No available threads';
	const jobs = [];
	const batches = batchJobs(variable_params, threads);
	let pointer = 0;
	const request_id = generateID(8);
	return Promise.all(resources.map(resource => new Promise(resolve => {
			const available_threads = +(resource.dataset.used);
			if (available_threads === 0 || pointer >= batches.length)
				return resolve([]);
			const request = {type: 'request', request_id, data: {framework, sources, fixed_params, collection: batches.slice(pointer, pointer + available_threads)}};
			pointer += available_threads;
			resource.addEventListener('message', e => {
				const message = e.detail.message;
				if (message.type === 'result' && message.request_id === request_id) {
					const result = message.data.reduce((a,batch) => a.concat(batch), []);
					resolve(result);
				}
			});
			resource.dispatchEvent(new CustomEvent('send', {detail: request}));
		})))
		.then(results => results.reduce((a,result) => a.concat(result), []));
};

const addResource = (container, options, resource, duplicates=false) => {
	if (!duplicates && (resource.machine_id === options.id))
		return;
	container.querySelectorAll(`[data-machine_id="${resource.machine_id}"]`).forEach(item => item.remove());
	const settings = cachedSettings();
	addModule(container, 'resource', {resource, settings: settings.machines[resource.machine_id], frameworks: resource.frameworks, machine_id: resource.machine_id, connection_id: resource.connection_id});
};

const addJobItem = (container, job) => {
	const elem = document.createElement('div');
	elem.classList.add('item');
	for (const attr in job)
		elem.dataset[attr] = job[attr];
	elem.innerHTML = `<div class="details"><a class="name">${job.name}</a></div><div class="progress"><div data-progress="0%"></div></div><div class="clear"></div>`;
	container.appendChild(elem);
};

const cachedSettings = (update={}, key='apc_settings') => {
	const options = Object.assign(parseJSON(localStorage.getItem(key), {connected: false, machines: {}}), update);
	localStorage.setItem(key, JSON.stringify(options));
	return options;
};

export const apc = (env, {options}, elem, storage={}) => ({
	render: async () => {
		// Maybe move options initialization elsewhere
		options.id = getID();
		storage.local_queue = workerQueue(elem, options);
		storage.local_resource = {machine_id: options.id, type: 'node', name: getName(), capacity: options.threads, cost: 0, time: 100, frameworks: options.frameworks.join(',')};
		elem.innerHTML = `<a class="resources-icon" data-icon="n"></a><div class="resources-menu user-menu menu"><div class="tabs"><a data-tab="resources">Resources</a><a data-tab="jobs">Jobs</a></div><div class="resources" data-tab-content="resources"></div><div class="jobs" data-tab-content="jobs" data-empty="No jobs currently running"></div><div class="websocket state-change"></div></div>`;
		addModule(elem.querySelector('.websocket'), 'ws', {options: {url: options.url, getCredentials: options.getCredentials}, local: storage.local_resource}, true);
		elem.dispatchEvent(new Event('init'));
		elem.dispatchEvent(new Event('done'));
	},
	hooks: [
		['[data-module="apc"]', 'init', e => {
			addResource(elem.querySelector('[data-tab-content="resources"]'), options, Object.assign({}, storage.local_resource, {connection_id: 'local'}), true);
			elem.querySelector('[data-tab]').click();
		}],
		['[data-module="apc"]', 'dynamics', async e => {
			e.detail.resolve(distributeDynamics(elem, e.detail.request));
		}],
		['[data-module="apc"]', 'distribute', async e => {
			//addJobItem(elem.querySelector('[data-tab-content="jobs"]'), {job: e.detail.id, name: e.detail.name});
			try {
				const results = await distribute(elem, e.detail);
				e.detail.resolve(results);
			} catch (err) {
				e.detail.reject(err);
			}
		}],
		['[data-module="apc"]', 'job', e => {
			const request = e.detail.request;
			switch(true) {
				case request.data.collection !== undefined:
					return Promise.all(request.data.collection.map(batch => {
						return storage.local_queue({framework: request.data.framework, sources: request.data.sources, fixed_params: request.data.fixed_params, variable_params: batch});
					})).then(e.detail.resolve);
				default:
					const dynamics_stream = new ReadableStream({
						start(controller) {
							storage.local_queue(request.data, (data) => data ? controller.enqueue(data) : controller.close());
						}
					});
					e.detail.resolve(dynamics_stream);
			}
		}],
		['[data-module="apc"]', 'resourcestatus', e => {
			const active_threads = e.detail.workers.filter(v => v !== undefined).length;
			const used = active_threads / e.detail.threads;
			elem.querySelector('.resources-icon').dataset.notify = active_threads;
		}],
		['[data-module="ws"]', 'message', e => {
			const message = e.detail.message;
			switch(message.type) {
				case 'resources':
					return message.data.forEach(resource => addResource(elem.querySelector('[data-tab-content="resources"]'), options, resource));
				case 'connected':
					return addResource(elem.querySelector('[data-tab-content="resources"]'), options, message.data);
				case 'disconnected':
					return elem.querySelectorAll(`[data-module="resource"][data-connection_id="${message.connection_id}"]`).forEach(item => item.remove());
				default:
					return elem.querySelector(`[data-module="resource"][data-connection_id="${message.user}"]`).dispatchEvent(new CustomEvent('message', {detail: e.detail}));
			}
			// Consider case where resource doesn't exist yet
		}],
		['.resources-menu [data-tab]', 'click', e => {
			const menu = e.target.closest('.resources-menu');
			menu.querySelectorAll('[data-tab]').forEach(elem => elem.classList.remove('selected'));
			e.target.classList.add('selected');
			menu.querySelectorAll('[data-tab-content]').forEach(elem => elem.classList.remove('show'));
			menu.querySelector(`[data-tab-content="${e.target.dataset.tab}"]`).classList.add('show');
		}],
		['.resources-icon', 'click', e => {
			const nav = e.target.closest('nav');
			nav.querySelector('.resources-menu').classList.toggle('show');
		}],
		['.resources-menu .threads', 'focusout', e => {
			const machines = Array.from(elem.querySelectorAll('[data-machine_id]')).reduce((a,machine) => Object.assign(a, {[machine.dataset.machine_id]: {used: +(machine.querySelector('input.threads').value)}}), {});
			cachedSettings({machines});
		}],
		['[data-job]', 'init', e => {
			if (e.target.innerHTML === '')
				e.target.innerHTML = `<div class="progress"><div data-progress="0%"></div></div>`;
			e.target.dataset.start = performance.now();
			e.target.dataset.estimate = e.detail.time; // Implement time estimate, this is just 100ms * runs
			e.target.dataset.batches = e.detail.batches;
			e.target.dataset.processed = 0;
		}],
		['[data-job]', 'progress', e => {
			const bar = e.target.querySelector('[data-progress]');
			e.target.dataset.processed = +(e.target.dataset.processed) + e.detail.processed;
			const progress = e.target.dataset.processed / e.target.dataset.batches;
			bar.dataset.progress = Math.round(progress * 100) + '%';
			bar.style.width = progress * 100 + '%';
		}],
		['[data-job]', 'complete', e => {
			const bar = e.target.querySelector('[data-progress]');
			const time = performance.now() - e.target.dataset.start;
			setTimeout(() => e.target.remove(), 1000);
		}]
	]
});
