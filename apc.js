
const range = (start,end) => Array.from(Array(end-start)).map((v,i)=>i+start);
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

const spawnWorker = (options, workers, i, request) => new Promise(resolve => {
	if (workers[i] === undefined) {
		workers[i] = new Worker(options.worker_script || '/worker.js');
	}
	workers[i].postMessage(Object.assign({}, request, {credentials: options.getCredentials()}));
	workers[i].addEventListener('message', e => {
		resolve(e.data);
	});
});

const workerQueue = (container, options, workers=Array.from(new Array(options.threads)), queue=[]) => (request) => {
	container.dispatchEvent(new CustomEvent('resourcestatus', {detail: {workers, threads: options.threads}}));
	const deploy = (workers, thread) => spawnWorker(options, workers, thread, request).then(result => {
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

/*
	local:
		const request = Promise.all(collection.map(batch => options.local_queue({framework, sources, fixed_params, variable_params: batch})));
	remote:
		const request = wsRequest(options, machine, {framework, sources, fixed_params, collection})


	const {id, framework, sources, fixed_params, variable_params} = request;
	const [machines, batches] = batchSet(_machines, framework, variable_params, 100);
	const requests = [];
	let pointer = 0;
	while (pointer < batches.length) {
		while (machines.length > 0 && pointer < batches.length) {
			const machine = machines.shift();
			const collection = batches.slice(pointer, pointer + +(machine.threads));
			const request = message();
			requests.push(request.then(batches => batches.reduce((a,batch) => a.concat(batch), [])));
			pointer += collection.length;
		}
	}
	return Promise.all(requests).then(results => {
		return results.reduce((a,result) => a.concat(result), []);
	});
*/

// Dist model: optimize batch size based on threads (greedy - distribute to more threads so long as time exceeds a basic run time threshold)
// Loop through resources starting with local resource and assign batches to "used" threads

/*

distribute

const resources = Array.from(container.querySelectorAll('[data-module="resource"]'))
	.filter(resource => resource.dataset.frameworks.split(',').includes(framework))
	.sort((a,b) => a.local || a.dataset.threads - b.dataset.threads); // Update data-threads with value of input[name="threads"]
const threads = sum(resources.map(resource => +(resource.dataset.threads)));
const jobs = [];
const batches = batchJobs(jobs, threads);
let pointer = 0;
return Promise.all(resources.map(resource => resource.dispatchEvent(new CustomEvent('send', {detail: {type: 'request', user: resource.connection_id, data: batches.slice(pointer += +(resource.dataset.threads), +(resource.dataset.threads))}}))))
	.then(results => results.reduce((a,result) => a.concat(result), []));

*/

const batchSet = (resources, framework, params_set, time, min_time = 1000) => {
	const compatible_nodes = resources.filter(resource => resource.frameworks.split(',').includes(framework));
	const free_threads = compatible_nodes.reduce((a,v) => a + +(v.threads), 0);
	if (free_threads === 0)
		return [[], []];
	const n = Math.min(free_threads, Math.ceil(params_set.length * time / min_time), params_set.length);
	const batch_size = Math.ceil(params_set.length / n);
	const batches = range(0, n).map(i => params_set.slice(i * batch_size, (i + 1) * batch_size));
	return [compatible_nodes, batches.filter(v => v.length > 0)];
};

const distribute = async (options, _machines, request) => {
	const {id, framework, sources, fixed_params, variable_params} = request;
	const time = 100; // Time in milliseconds to complete single run, implement time estimation for multiple frameworks
	const [machines, batches] = batchSet(_machines, framework, variable_params, time);
	if (batches.length === 0)
		throw 'No available threads';
	document.querySelectorAll(`[data-job="${id}"]`).forEach(elem => elem.dispatchEvent(new CustomEvent('init', {detail: {batches: batches.length, time: Math.ceil(time * variable_params.length / batches.length)}})));
	const requests = [];
	let pointer = 0;
	while (pointer < batches.length) {
		while (machines.length > 0 && pointer < batches.length) {
			const machine = machines.shift();
			const collection = batches.slice(pointer, pointer + +(machine.threads));
			const request = machine.connection_id === 'local' ?
				Promise.all(collection.map(batch => options.local_queue({framework, sources, fixed_params, variable_params: batch}).then(result => {
					document.querySelectorAll(`[data-job="${id}"]`).forEach(elem => elem.dispatchEvent(new CustomEvent('progress', {detail: {processed: 1}})));
					return result;
				}))) :
				wsRequest(options, machine, {framework, sources, fixed_params, collection}).then(results => {
					document.querySelectorAll(`[data-job="${id}"]`).forEach(elem => elem.dispatchEvent(new CustomEvent('progress', {detail: {processed: collection.length}})));
					return results;
				});
			requests.push(request.then(batches => batches.reduce((a,batch) => a.concat(batch), [])));
			pointer += collection.length;
		}
	}
	return Promise.all(requests).then(results => {
		document.querySelectorAll(`[data-job="${id}"]`).forEach(elem => elem.dispatchEvent(new CustomEvent('complete', {detail: {}})));
		return results.reduce((a,result) => a.concat(result), []);
	});
};

const addResource = (container, options, resource, duplicates=false) => {
	if (!duplicates && (resource.machine_id === options.id))
		return;
	container.querySelectorAll(`[data-machine_id="${resource.machine_id}"]`).forEach(item => item.remove());
	const settings = cachedSettings();
	addModule(container, 'resource', {resource, settings: settings[resource.machine_id], machine_id: resource.machine_id, connection_id: resource.connection_id});
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
		options.local_queue = workerQueue(elem, options);
		options.local_resource = {machine_id: options.id, type: 'node', name: getName(), capacity: options.threads, cost: 0, time: 100, frameworks: options.frameworks.join(',')};
		elem.innerHTML = `<a class="resources-icon" data-icon="n"></a><div class="resources-menu user-menu menu"><div class="tabs"><a data-tab="resources">Resources</a><a data-tab="jobs">Jobs</a></div><div class="resources" data-tab-content="resources"></div><div class="jobs" data-tab-content="jobs" data-empty="No jobs currently running"></div><div class="websocket"></div></div>`;
		addModule(elem.querySelector('.websocket'), 'ws', {options: {url: options.url, getCredentials: options.getCredentials}, local: options.local_resource}, true);
		elem.dispatchEvent(new Event('init'));
		elem.dispatchEvent(new Event('done'));
	},
	hooks: [
		['[data-module="apc"]', 'init', e => {
			addResource(elem.querySelector('[data-tab-content="resources"]'), options, Object.assign({}, options.local_resource, {connection_id: 'local'}), true);
			elem.querySelector('[data-tab]').click();
		}],
		['[data-module="apc"]', 'distribute', async e => {
			const machines = Array.from(elem.querySelectorAll('[data-machine_id]')).map(v => Object.assign({}, v.dataset, {threads: v.querySelector('input.threads').value}));
			addJobItem(elem.querySelector('[data-tab-content="jobs"]'), {job: e.detail.id, name: e.detail.name});
			try {
				const results = await distribute(options, machines, e.detail);
				e.detail.resolve(results);
			} catch (err) {
				e.detail.reject(err);
			}
		}],
		['[data-module="apc"]', 'resourcestatus', e => {
			const active_threads = e.detail.workers.filter(v => v !== undefined).length;
			const used = active_threads / e.detail.threads;
			elem.querySelector('.resources-icon').dataset.notify = active_threads;
		}],
		['[data-module="ws"]', 'message', e => {
			const message = e.detail.message;
			console.log(message);
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
			// Get connection_id, route to resource, consider resource listening to ws vs. ws passing on event to 
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
