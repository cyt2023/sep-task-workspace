'use strict';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 10h18m-12 4h1m4 0h1m-6 3h1"/>',
  history: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6m3-3v5l3 2"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  refresh: '<path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/>',
  search: '<circle cx="10" cy="10" r="6.5"/><path d="m15 15 5 5"/>',
  call: '<rect x="5" y="7" width="14" height="11" rx="3"/><path d="M12 3v4m-4 5h.01M16 12h.01M9 15h6M2 11v3m20-3v3M9 18v3m6-3v3"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  medication: '<path d="m8 4-4 4a5 5 0 0 0 7 7l4-4a5 5 0 0 0-7-7Zm-2 2 7 7m3 2 4 4m-4 0 4-4"/>',
  sample: '<path d="M8 3h8m-6 0v6L5 18a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M8 14h8"/>',
  waste: '<path d="M4 6h16M9 3h6l1 3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
  patient: '<circle cx="12" cy="7" r="3"/><path d="M5 21v-3a7 7 0 0 1 14 0v3M12 14v6m-3-3h6"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.layers}</svg>`;
const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function fillIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon); });
}
fillIcons();

const labels = { robot_call: 'Robot call', medication_delivery: 'Medication delivery', sample_delivery: 'Sample delivery', waste_delivery: 'Waste delivery', patient_assistance: 'Patient assistance' };
const typeIcons = { robot_call: 'call', medication_delivery: 'medication', sample_delivery: 'sample', waste_delivery: 'waste', patient_assistance: 'patient' };
const state = { entries: [], due: new Set(), cancellable: new Set(), view: 'all', filter: 'all', search: '', type: 'all', loaded: false, connected: false };
let detailId = null;
let cancelId = null;
let importTasks = null;
let toastTimer;
const browserMode = $('meta[name="sep-storage"]').content === 'browser';
if (browserMode) {
  $('#browser-notice').hidden = false;
  $('.sidebar-footer div > span').textContent = 'Browser demo';
  $('.table-footer > span:first-child').lastChild.textContent = ' Saved in this browser';
  $('.upcoming-note').textContent = 'Scheduled times follow your browser’s local clock.';
}

async function api(path, payload) {
  if (browserMode) return window.SEPBrowserStore.request(path, payload);
  const options = payload === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data;
}
function message(selector, text = '') { const el = $(selector); el.textContent = text; el.hidden = !text; }
function toast(text) { clearTimeout(toastTimer); message('#toast', text); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 6500); }
function isRemaining(entry) {
  if (['aborted', 'cancelled'].includes(entry.status)) return false;
  if (entry.status !== 'completed') return true;
  const repeat = entry.task.schedule?.repeat;
  return repeat && (repeat.mode === 'until_cancelled' || entry.completed_occurrences < repeat.count + 1);
}
function scheduledEntries() { return state.entries.filter((e) => e.task.schedule && isRemaining(e) && !state.due.has(e.task.task_id) && e.status !== 'executing' && e.status !== 'halted'); }
function statusHTML(entry) {
  const status = entry.stop_requested ? 'stopping' : entry.status === 'pending' && state.due.has(entry.task.task_id) ? 'ready' : entry.status;
  const names = { pending: 'Pending', ready: 'Ready', executing: 'In progress', completed: 'Completed', halted: 'Halted', aborted: 'Aborted', cancelled: 'Cancelled', stopping: 'Stop requested' };
  return `<span class="status ${status}">${names[status]}</span>`;
}
function formatDate(schedule) {
  return new Date(`${schedule.scheduled_date}T${schedule.scheduled_time}`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function nextSchedule(entry) {
  const schedule = entry.task.schedule;
  const date = new Date(`${schedule.scheduled_date}T${schedule.scheduled_time}`);
  if (schedule.repeat) date.setMinutes(date.getMinutes() + schedule.repeat.interval_minutes * entry.completed_occurrences);
  return date;
}
function timingHTML(entry) {
  const schedule = entry.task.schedule;
  if (!schedule) return '<span class="timing-main">Immediate</span><span class="timing-sub">One-time task</span>';
  const repeat = schedule.repeat;
  const sub = repeat ? `Every ${repeat.interval_minutes} min · ${repeat.mode === 'count' ? `${entry.completed_occurrences}/${repeat.count + 1} runs` : 'Until cancelled'}` : formatDate(schedule);
  return `<span class="timing-main">${escapeHTML(schedule.scheduled_time)}${repeat ? ' · Repeating' : ''}</span><span class="timing-sub">${escapeHTML(sub)}</span>`;
}
function matchesView(entry) {
  if (state.view === 'due') return state.due.has(entry.task.task_id);
  if (state.view === 'scheduled') return scheduledEntries().includes(entry);
  if (state.view === 'history') return ['completed', 'cancelled', 'aborted'].includes(entry.status);
  return true;
}
function render() {
  $('#stat-total').textContent = state.entries.length;
  $('#stat-due').textContent = state.due.size;
  $('#stat-scheduled').textContent = scheduledEntries().length;
  $('#stat-completed').textContent = state.entries.reduce((sum, e) => sum + e.completed_occurrences, 0);
  $('#nav-total').textContent = state.entries.length;
  $('#nav-due').textContent = state.due.size;
  $('#table-total').textContent = `${state.entries.length} task${state.entries.length === 1 ? '' : 's'} in workspace`;
  const entries = state.entries.filter((entry) => matchesView(entry) &&
    (state.filter === 'all' || entry.status === state.filter) &&
    (state.type === 'all' || entry.task.task_type === state.type) &&
    JSON.stringify(entry.task).toLowerCase().includes(state.search.toLowerCase()));
  $('#visible-count').textContent = entries.length;
  $('#task-rows').innerHTML = entries.map((entry) => {
    const task = entry.task;
    const route = task.task_type === 'robot_call' ? escapeHTML(task.target_location) : `${escapeHTML(task.pickup_point)}<span>to ${escapeHTML(task.dropoff_point)}</span>`;
    return `<tr><td><div class="task-cell"><span class="task-icon ${task.task_type}">${icon(typeIcons[task.task_type])}</span><div><button class="task-name" data-detail="${escapeHTML(task.task_id)}">${labels[task.task_type]}</button><span class="task-id" title="${escapeHTML(task.task_id)}">${escapeHTML(task.task_id)}</span>${task.emergency ? '<span class="emergency-tag">Emergency</span>' : ''}</div></div></td><td class="route">${route}</td><td>${timingHTML(entry)}</td><td>${statusHTML(entry)}</td><td><button class="icon-button" data-detail="${escapeHTML(task.task_id)}" aria-label="Details for ${escapeHTML(task.task_id)}">${icon('chevron')}</button></td></tr>`;
  }).join('');
  $('#empty-state').hidden = entries.length > 0;
  if (!entries.length) {
    const fresh = !state.entries.length;
    const filtered = state.filter !== 'all' || state.search || state.type !== 'all';
    $('#empty-title').textContent = fresh ? 'A fresh start.' : filtered ? 'No matching tasks.' : state.view === 'due' ? 'Nothing due right now.' : state.view === 'scheduled' ? 'No tasks waiting on a schedule.' : 'No tasks here yet.';
    $('#empty-description').textContent = fresh ? 'Add your first task and give the next step a place to land.' : filtered ? 'Try another search or clear your filters.' : 'Create a task or explore another workspace view.';
    $('#empty-create').hidden = !!filtered;
    $('#clear-filters').hidden = !filtered;
  }
  const upcoming = scheduledEntries().sort((a, b) => nextSchedule(a) - nextSchedule(b)).slice(0, 3);
  $('#upcoming-list').innerHTML = upcoming.length ? upcoming.map((e) => {
    const date = nextSchedule(e);
    return `<button class="upcoming-item" data-detail="${escapeHTML(e.task.task_id)}"><span class="upcoming-date"><span>${escapeHTML(date.toLocaleDateString('en-GB', {month:'short'}))}</span>${date.getDate()}</span><span><strong>${labels[e.task.task_type]}</strong><small>${escapeHTML(date.toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'}))} · ${escapeHTML(e.task.target_location || e.task.dropoff_point)}</small></span></button>`;
  }).join('') : '<p class="upcoming-empty">Room for what’s next.<br>Your scheduled tasks will appear here.</p>';
}
async function refresh() {
  const refreshButton = $('#refresh');
  refreshButton.disabled = true;
  try {
    const data = await api('/api/tasks');
    state.entries = data.entries;
    state.due = new Set(data.due_task_ids);
    state.cancellable = new Set(data.cancellable_task_ids);
    state.loaded = true;
    state.connected = true;
    $('#connection-dot').className = 'connection-dot connected';
    $('#connection-label').textContent = browserMode ? 'Browser storage ready' : 'Workspace connected';
    $('#updated-at').textContent = `Updated ${new Date().toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'})}`;
    message('#page-error');
    render();
    if ($('#detail-dialog').open && detailId) renderDetail();
    return true;
  } catch (error) {
    state.connected = false;
    $('#connection-dot').className = 'connection-dot error';
    $('#connection-label').textContent = browserMode ? 'Storage unavailable' : 'Connection unavailable';
    message('#page-error', `Could not refresh tasks. ${error.message} ${state.loaded ? 'The list shows the last successful refresh.' : browserMode ? 'Check browser storage permissions and reload the page.' : 'Check that the local workspace server is running.'}`);
    return false;
  } finally { refreshButton.disabled = false; }
}
function switchView(view) {
  state.view = view;
  state.filter = 'all';
  state.search = '';
  state.type = 'all';
  $('#search').value = '';
  $('#type-filter').value = 'all';
  const names = { all: 'Overview', due: 'Ready to run', scheduled: 'Scheduled', history: 'History' };
  const titles = { all: 'A little more organized.<br>A lot more in motion.', due: 'The next steps,<br>ready when you are.', scheduled: 'A place for<br>what comes next.', history: 'Every task has<br>a story to tell.' };
  $('#breadcrumb-view').textContent = names[view];
  $('#page-title').innerHTML = titles[view];
  $('#task-panel-title').firstChild.textContent = `${view === 'all' ? 'Your task list' : names[view]} `;
  $$('.nav-item').forEach((el) => { el.classList.toggle('active', el.dataset.view === view); if (el.dataset.view === view) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); });
  $$('.tab').forEach((el) => { el.classList.toggle('active', el.dataset.filter === 'all'); el.setAttribute('aria-pressed', String(el.dataset.filter === 'all')); });
  render();
}
function setFieldGroup(selector, visible) {
  const group = $(selector);
  group.hidden = !visible;
  group.querySelectorAll('input').forEach((input) => { input.disabled = !visible; input.required = visible; });
}
function updateForm() {
  const type = $('#task-type').value;
  setFieldGroup('#target-field', type === 'robot_call');
  setFieldGroup('#route-fields', type !== 'robot_call');
  setFieldGroup('#package-field', type.endsWith('_delivery'));
  const timing = $('#timing').value;
  setFieldGroup('#schedule-fields', timing !== 'now');
  setFieldGroup('#repeat-fields', ['count', 'until_cancelled'].includes(timing));
  setFieldGroup('#count-field', timing === 'count');
  $('#repeat-hint').hidden = timing !== 'count';
  $('#repeat-hint').textContent = `The first run plus ${$('#create-form').elements.count.value || 0} repeats. ${Number($('#create-form').elements.count.value) + 1} runs in total.`;
  setFieldGroup('#wait-field', $('#wait-toggle').checked);
}
function openCreate() {
  $('#create-form').reset();
  message('#create-error');
  const date = new Date();
  const pad = (v) => String(v).padStart(2, '0');
  $('#create-form').elements.scheduled_date.value = `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
  $('#create-form').elements.scheduled_time.value = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  updateForm();
  $('#create-dialog').showModal();
}
function buildTask(form) {
  const data = new FormData(form);
  const task = { task_id: data.get('task_id').trim() || crypto.randomUUID(), task_type: data.get('task_type'), user: data.get('user').trim() };
  ['target_location', 'pickup_point', 'dropoff_point', 'package'].forEach((key) => { if (data.has(key)) task[key] = data.get(key).trim(); });
  if (data.get('timing') !== 'now') {
    task.schedule = { scheduled_date: data.get('scheduled_date'), scheduled_time: data.get('scheduled_time') };
    if (['count', 'until_cancelled'].includes(data.get('timing'))) {
      task.schedule.repeat = { mode: data.get('timing'), interval_minutes: Number(data.get('interval_minutes')) };
      if (data.get('timing') === 'count') task.schedule.repeat.count = Number(data.get('count'));
    }
  }
  if (data.has('emergency')) task.emergency = true;
  if (data.has('end_condition')) task.wait = { end_condition: data.get('end_condition').trim() };
  return task;
}
async function saveFromForm(form, errorSelector, tasks, success) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  message(errorSelector);
  try {
    const result = await api('/api/tasks', tasks);
    success(result);
    await refresh();
  } catch (error) { message(errorSelector, error.message); }
  finally { button.disabled = false; }
}
function renderDetail() {
  const entry = state.entries.find((e) => e.task.task_id === detailId);
  if (!entry) { $('#detail-dialog').close(); return; }
  const task = entry.task;
  $('#detail-title').textContent = labels[task.task_type];
  const fields = [['Task ID', task.task_id], ['Requested by', task.user], ['Destination', task.target_location], ['Pickup point', task.pickup_point], ['Dropoff point', task.dropoff_point], ['Package', task.package], ['Start', task.schedule ? `${formatDate(task.schedule)} at ${task.schedule.scheduled_time}` : 'As soon as possible'], ['Completed runs', entry.completed_occurrences], ['Repetition', task.schedule?.repeat ? `Every ${task.schedule.repeat.interval_minutes} minutes · ${task.schedule.repeat.mode === 'count' ? `${task.schedule.repeat.count + 1} total runs` : 'Until cancelled'}` : 'One-time task'], ['Waiting condition', task.wait?.end_condition], ['Emergency', task.emergency ? 'Yes' : 'No']];
  $('#detail-content').innerHTML = `${statusHTML(entry)}<dl class="detail-grid">${fields.filter(([,value]) => value !== undefined).map(([key, value]) => `<div class="detail-field"><dt>${key}</dt><dd>${escapeHTML(value)}</dd></div>`).join('')}</dl>${entry.stop_requested ? '<p class="detail-note">Cancellation has been recorded. This task stays in progress until the execution layer confirms the robot has stopped.</p>' : ''}<details class="raw-data"><summary>View saved record</summary><pre>${escapeHTML(JSON.stringify(entry, null, 2))}</pre></details>`;
  $('#detail-actions').innerHTML = `<button class="button secondary" data-close="detail-dialog">Close</button>${state.cancellable.has(detailId) ? '<button class="button danger" id="detail-cancel">Cancel task</button>' : ''}`;
  $('#detail-cancel')?.addEventListener('click', () => {
    cancelId = detailId;
    $('#detail-dialog').close();
    message('#cancel-error');
    $('#cancel-description').textContent = entry.status === 'executing' ? 'This task is in progress. Record a stop request and cancel all future repetitions. It will remain in progress until a stop confirmation arrives.' : 'This cancels the task and all of its remaining repetitions. Completed runs will be kept in its history.';
    $('#cancel-dialog').showModal();
  });
}

document.addEventListener('click', (event) => {
  const view = event.target.closest('[data-view]');
  if (view) switchView(view.dataset.view);
  const close = event.target.closest('[data-close]');
  if (close) $(`#${close.dataset.close}`).close();
  const detail = event.target.closest('[data-detail]');
  if (detail) { detailId = detail.dataset.detail; renderDetail(); $('#detail-dialog').showModal(); }
});
$$('.tab').forEach((el) => el.addEventListener('click', () => {
  state.filter = el.dataset.filter;
  $$('.tab').forEach((tab) => { tab.classList.toggle('active', tab === el); tab.setAttribute('aria-pressed', String(tab === el)); });
  render();
}));
$('#search').addEventListener('input', (e) => { state.search = e.target.value; render(); });
$('#type-filter').addEventListener('change', (e) => { state.type = e.target.value; render(); });
$('#clear-filters').addEventListener('click', () => switchView(state.view));
$('#refresh').addEventListener('click', refresh);
$('#create-open').addEventListener('click', openCreate);
$('#empty-create').addEventListener('click', openCreate);
$('#guide-open').addEventListener('click', () => $('#guide-dialog').showModal());
$('#task-type').addEventListener('change', updateForm);
$('#timing').addEventListener('change', updateForm);
$('#wait-toggle').addEventListener('change', updateForm);
$('#create-form').elements.count.addEventListener('input', updateForm);
$('#create-form').addEventListener('submit', (event) => {
  event.preventDefault();
  saveFromForm(event.currentTarget, '#create-error', [buildTask(event.currentTarget)], () => { $('#create-dialog').close(); toast('Task created. Your next step is saved.'); });
});
$('#quick-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const task = { task_id: crypto.randomUUID(), task_type: 'robot_call', target_location: form.elements.location.value.trim(), user: form.elements.user.value.trim() };
  saveFromForm(form, '#quick-error', [task], () => { form.reset(); toast('Robot call created and ready for its first run.'); });
});
$('#import-open').addEventListener('click', () => {
  $('#import-form').reset(); importTasks = null; $('#import-preview').value = ''; $('#import-submit').disabled = true; message('#import-error'); $('#import-dialog').showModal();
});
$('#import-file').addEventListener('change', async (event) => {
  importTasks = null;
  $('#import-submit').disabled = true;
  $('#import-preview').value = '';
  message('#import-error');
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('Choose a JSON file smaller than 2 MB.');
    const parsed = JSON.parse(await file.text());
    if (!Array.isArray(parsed)) throw new Error('The file must contain a JSON array of task objects.');
    importTasks = parsed;
    $('#import-preview').value = JSON.stringify(parsed, null, 2);
    $('#import-submit').disabled = false;
    $('#import-submit').textContent = `Import ${parsed.length} task${parsed.length === 1 ? '' : 's'}`;
  } catch (error) { message('#import-error', error.message); }
});
$('#import-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (importTasks === null) return;
  saveFromForm(event.currentTarget, '#import-error', importTasks, (result) => { $('#import-dialog').close(); toast(`${result.added} task${result.added === 1 ? '' : 's'} imported. Everything is saved.`); });
});
$('#cancel-confirm').addEventListener('click', async (event) => {
  event.currentTarget.disabled = true;
  message('#cancel-error');
  try {
    const result = await api('/api/cancel', { task_id: cancelId });
    $('#cancel-dialog').close();
    toast(result.stop_requested ? 'Cancellation recorded. Waiting for execution-layer stop confirmation.' : 'Task cancelled. Its history is saved.');
    await refresh();
  } catch (error) { message('#cancel-error', error.message); }
  finally { $('#cancel-confirm').disabled = false; }
});
$('#today').textContent = new Date().toLocaleDateString('en-GB', {weekday:'short',day:'numeric',month:'short',year:'numeric'});
updateForm();
refresh();
setInterval(() => { if (!document.hidden && !document.querySelector('dialog[open]')) refresh(); }, 30000);
