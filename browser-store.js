/* Browser-only demonstration storage. The Python manager remains the backend authority. */
'use strict';

window.SEPBrowserStore = (() => {
  const key = `sep-task-workspace:${new URL('.', location.href).pathname}:v1`;
  const statuses = ['pending', 'executing', 'halted', 'completed', 'aborted', 'cancelled'];
  let schemaPromise;
  const fail = (text) => { throw new Error(text); };
  const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

  // Only the keywords present in the project's canonical task schema are needed.
  function validate(value, rule, path, root) {
    if (rule === false) fail(`${path} is not allowed for this task type.`);
    if (rule.$ref) return validate(value, rule.$ref.slice(2).split('/').reduce((node, part) => node[part], root), path, root);
    if (rule.type) {
      const correct = {object: isObject(value), array: Array.isArray(value), string: typeof value === 'string', boolean: typeof value === 'boolean', integer: Number.isInteger(value)};
      if (!correct[rule.type]) fail(`${path} must be a ${rule.type}.`);
    }
    if (rule.const !== undefined && value !== rule.const) fail(`${path} must be ${rule.const}.`);
    if (rule.enum && !rule.enum.includes(value)) fail(`${path} must be one of: ${rule.enum.join(', ')}.`);
    if (rule.minLength !== undefined && [...value].length < rule.minLength) fail(`${path} must not be empty.`);
    if (rule.minimum !== undefined && value < rule.minimum) fail(`${path} must be at least ${rule.minimum}.`);
    if (rule.pattern && !new RegExp(rule.pattern).test(value)) fail(`${path} has an invalid format.`);
    if (rule.format === 'date') {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
      if (!match) fail(`${path} must be a valid YYYY-MM-DD date.`);
      const [, year, month, day] = match.map(Number);
      const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) fail(`${path} must be a valid calendar date.`);
    }
    if (isObject(value)) {
      for (const name of rule.required || []) {
        if (!Object.hasOwn(value, name)) fail(`Missing required field '${path}.${name}'.`);
      }
      for (const [name, item] of Object.entries(value)) {
        if (rule.properties && Object.hasOwn(rule.properties, name)) validate(item, rule.properties[name], `${path}.${name}`, root);
        else if (rule.additionalProperties === false) fail(`${path}.${name} is not allowed.`);
      }
    }
    for (const branch of rule.allOf || []) {
      if (branch.if) {
        let matched = true;
        try { validate(value, branch.if, path, root); } catch { matched = false; }
        if (matched) validate(value, branch.then, path, root);
      } else validate(value, branch, path, root);
    }
    if (rule.oneOf) {
      const matches = rule.oneOf.filter((branch) => {
        try { validate(value, branch, path, root); return true; } catch { return false; }
      });
      if (matches.length !== 1) fail(`${path} must contain a valid repeat rule with a positive interval and, for fixed repetition, a positive count.`);
    }
  }

  async function getSchema() {
    schemaPromise ||= fetch('./task.schema.json').then((response) => {
      if (!response.ok) fail('The task schema could not be loaded. Reload this page.');
      return response.json();
    }).catch((error) => { schemaPromise = null; throw error; });
    return schemaPromise;
  }
  function read(schema) {
    let entries;
    try { entries = JSON.parse(localStorage.getItem(key) || '[]'); }
    catch { fail('Saved browser data could not be read. Check browser storage permissions.'); }
    if (!Array.isArray(entries)) fail('The saved browser workspace is invalid.');
    const ids = new Set();
    for (const entry of entries) {
      if (!isObject(entry) || !statuses.includes(entry.status) || !Number.isInteger(entry.completed_occurrences) || entry.completed_occurrences < 0 || typeof entry.stop_requested !== 'boolean') fail('A saved browser task has an invalid runtime state.');
      validate(entry.task, schema, 'task', schema);
      if (ids.has(entry.task.task_id)) fail('The saved browser workspace contains duplicate task IDs.');
      ids.add(entry.task.task_id);
    }
    return entries;
  }
  function save(entries) {
    try { localStorage.setItem(key, JSON.stringify(entries)); }
    catch { fail('Tasks could not be saved. Browser storage may be full or disabled.'); }
  }
  function hasRuns(entry) {
    const repeat = entry.task.schedule?.repeat;
    return repeat && (repeat.mode === 'until_cancelled' || entry.completed_occurrences < repeat.count + 1);
  }
  function canCancel(entry) {
    return !entry.stop_requested && (['pending', 'executing', 'halted'].includes(entry.status) || (entry.status === 'completed' && hasRuns(entry)));
  }
  function isDue(entry) {
    if (entry.stop_requested || !['pending', 'completed'].includes(entry.status)) return false;
    const schedule = entry.task.schedule;
    if (!schedule) return entry.status === 'pending';
    if (entry.status === 'completed' && !hasRuns(entry)) return false;
    if (schedule.repeat?.mode === 'count' && !hasRuns(entry)) return false;
    const next = new Date(`${schedule.scheduled_date}T${schedule.scheduled_time}`);
    if (schedule.repeat) next.setMinutes(next.getMinutes() + schedule.repeat.interval_minutes * entry.completed_occurrences);
    return next <= new Date();
  }
  async function request(path, payload) {
    const schema = await getSchema();
    const entries = read(schema);
    if (path === '/api/tasks' && payload === undefined) {
      return {entries, due_task_ids: entries.filter(isDue).map((entry) => entry.task.task_id), cancellable_task_ids: entries.filter(canCancel).map((entry) => entry.task.task_id)};
    }
    if (path === '/api/tasks') {
      if (!Array.isArray(payload)) fail('Task input must be a JSON array.');
      const ids = new Set(entries.map((entry) => entry.task.task_id));
      const added = payload.map((task, index) => {
        try {
          validate(task, schema, 'task', schema);
          if (ids.has(task.task_id)) fail(`duplicate task ID '${task.task_id}'`);
          ids.add(task.task_id);
        } catch (error) { fail(`Task at index ${index}: ${error.message}`); }
        return {task, status: 'pending', completed_occurrences: 0, stop_requested: false};
      });
      if (added.length) save([...entries, ...added]);
      return {added: added.length};
    }
    if (path === '/api/cancel') {
      const entry = entries.find((item) => item.task.task_id === payload.task_id);
      if (!entry) fail('This task no longer exists. Refresh the workspace.');
      if (!canCancel(entry)) fail('This task cannot be cancelled in its current state.');
      if (entry.status === 'executing') entry.stop_requested = true;
      else entry.status = 'cancelled';
      save(entries);
      return {stop_requested: entry.stop_requested, message: entry.stop_requested ? 'Stop requested.' : 'Task cancelled.'};
    }
    fail('Unknown workspace operation.');
  }
  return {request};
})();
