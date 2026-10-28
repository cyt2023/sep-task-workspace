'use strict';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const labels = {robot_call: 'Robot call', medication_delivery: 'Medication delivery', sample_delivery: 'Sample delivery', waste_delivery: 'Waste delivery', patient_assistance: 'Patient assistance'};
const browserMode = $('meta[name="sep-storage"]').content === 'browser';
const state = {entries: [], due: new Set(), cancellable: new Set(), view: 'all', loaded: false};
let detailId = null;
let cancelId = null;
let importTasks = null;
let toastTimer;
$('#browser-notice').hidden = !browserMode;

async function api(path, payload) {
  if (browserMode) return window.SEPBrowserStore.request(path, payload);
  const options = payload === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)};
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data;
}
function message(selector, text = '') {
  const element = $(selector);
  element.textContent = text;
  element.hidden = !text;
}
function toast(text) {
  clearTimeout(toastTimer);
  message('#toast', text);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4000);
}
function statusHTML(entry) {
  const status = entry.stop_requested ? 'stopping' : entry.status === 'pending' && state.due.has(entry.task.task_id) ? 'ready' : entry.status;
  const names = {pending: 'Pending', ready: 'Ready', executing: 'In progress', completed: 'Completed', halted: 'Halted', aborted: 'Aborted', cancelled: 'Cancelled', stopping: 'Stop requested'};
  return `<span class="status ${status}">${names[status]}</span>`;
}
function formatDate(schedule) {
  return new Date(`${schedule.scheduled_date}T${schedule.scheduled_time}`).toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric'});
}
function timingHTML(task) {
  const schedule = task.schedule;
  if (!schedule) return 'Immediate';
  const repeat = schedule.repeat;
  const repetition = repeat ? `<small>Every ${repeat.interval_minutes} min${repeat.mode === 'count' ? ` · ${repeat.count + 1} runs` : ' · Until cancelled'}</small>` : '';
  return `${escapeHTML(formatDate(schedule))}<small>${escapeHTML(schedule.scheduled_time)}</small>${repetition}`;
}
function render() {
  $('#total-count').textContent = state.entries.length;
  $('#due-count').textContent = state.due.size;
  const entries = state.entries.filter((entry) => state.view === 'all' || state.due.has(entry.task.task_id));
  $('#task-rows').innerHTML = entries.map((entry) => {
    const task = entry.task;
    const id = escapeHTML(task.task_id);
    const location = task.task_type === 'robot_call' ? escapeHTML(task.target_location) : `${escapeHTML(task.pickup_point)}<small>to ${escapeHTML(task.dropoff_point)}</small>`;
    return `<tr><td data-label="Task"><strong>${labels[task.task_type]}</strong><small class="task-id" title="${id}">${id}</small>${task.emergency ? '<small class="emergency-label">Emergency</small>' : ''}</td><td data-label="Location">${location}</td><td data-label="Timing">${timingHTML(task)}</td><td data-label="Status">${statusHTML(entry)}</td><td class="row-actions"><button class="row-button" data-detail="${id}" aria-label="Details for ${id}">Details</button>${state.cancellable.has(task.task_id) ? `<button class="row-button cancel-button" data-cancel="${id}" aria-label="Cancel ${id}">Cancel</button>` : ''}</td></tr>`;
  }).join('');
  $('#empty-state').hidden = entries.length > 0;
  $('#empty-title').textContent = state.view === 'due' ? 'No tasks due now' : 'No tasks yet';
  $('#empty-description').textContent = state.view === 'due' ? 'Scheduled tasks will appear here when they are due.' : 'Create a task or import a JSON file to get started.';
  $('#empty-create').hidden = state.view === 'due';
}
async function refresh() {
  $('#refresh').disabled = true;
  try {
    const data = await api('/api/tasks');
    state.entries = data.entries;
    state.due = new Set(data.due_task_ids);
    state.cancellable = new Set(data.cancellable_task_ids);
    state.loaded = true;
    message('#page-error');
    $('#connection-label').textContent = `Updated ${new Date().toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'})}`;
    render();
    if ($('#detail-dialog').open) renderDetail();
  } catch (error) {
    $('#connection-label').textContent = browserMode ? 'Storage unavailable' : 'Connection unavailable';
    message('#page-error', `${error.message}${state.loaded ? ' The list shows the last successful refresh.' : ''}`);
  } finally { $('#refresh').disabled = false; }
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
  $('#repeat-hint').textContent = `${Number($('#create-form').elements.count.value) + 1} runs in total, including the first run.`;
  setFieldGroup('#wait-field', $('#wait-toggle').checked);
}
function openCreate() {
  $('#create-form').reset();
  $('#advanced-options').open = false;
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
  const task = {task_id: data.get('task_id').trim() || crypto.randomUUID(), task_type: data.get('task_type'), user: data.get('user').trim()};
  ['target_location', 'pickup_point', 'dropoff_point', 'package'].forEach((key) => { if (data.has(key)) task[key] = data.get(key).trim(); });
  if (data.get('timing') !== 'now') {
    task.schedule = {scheduled_date: data.get('scheduled_date'), scheduled_time: data.get('scheduled_time')};
    if (['count', 'until_cancelled'].includes(data.get('timing'))) {
      task.schedule.repeat = {mode: data.get('timing'), interval_minutes: Number(data.get('interval_minutes'))};
      if (data.get('timing') === 'count') task.schedule.repeat.count = Number(data.get('count'));
    }
  }
  if (data.has('emergency')) task.emergency = true;
  if (data.has('end_condition')) task.wait = {end_condition: data.get('end_condition').trim()};
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
  const entry = state.entries.find((item) => item.task.task_id === detailId);
  if (!entry) { $('#detail-dialog').close(); return; }
  const task = entry.task;
  $('#detail-title').textContent = labels[task.task_type];
  const fields = [['Task ID', task.task_id], ['Requested by', task.user], ['Destination', task.target_location], ['Pickup point', task.pickup_point], ['Dropoff point', task.dropoff_point], ['Package', task.package], ['Start', task.schedule ? `${formatDate(task.schedule)} at ${task.schedule.scheduled_time}` : 'Immediate'], ['Completed runs', entry.completed_occurrences], ['Repetition', task.schedule?.repeat ? `Every ${task.schedule.repeat.interval_minutes} minutes · ${task.schedule.repeat.mode === 'count' ? `${task.schedule.repeat.count + 1} total runs` : 'Until cancelled'}` : 'None'], ['Waiting condition', task.wait?.end_condition], ['Emergency', task.emergency ? 'Yes' : 'No']];
  $('#detail-content').innerHTML = `${statusHTML(entry)}<dl class="detail-grid">${fields.filter(([,value]) => value !== undefined).map(([name,value]) => `<div><dt>${name}</dt><dd>${escapeHTML(value)}</dd></div>`).join('')}</dl>${entry.stop_requested ? '<p class="field-hint">Waiting for the execution layer to confirm that the robot has stopped.</p>' : ''}`;
  $('#detail-actions').innerHTML = `<button class="button secondary" data-close="detail-dialog">Close</button>${state.cancellable.has(detailId) ? `<button class="button danger" data-cancel="${escapeHTML(detailId)}">Cancel task</button>` : ''}`;
}
function openCancellation(id) {
  const entry = state.entries.find((item) => item.task.task_id === id);
  if (!entry) return;
  cancelId = id;
  $('#detail-dialog').close();
  message('#cancel-error');
  $('#cancel-description').textContent = entry.status === 'executing' ? 'Record a stop request and cancel future repetitions. This task stays in progress until a stop is confirmed.' : 'This will cancel the task and any remaining repetitions.';
  $('#cancel-dialog').showModal();
}

document.addEventListener('click', (event) => {
  const close = event.target.closest('[data-close]');
  if (close) $(`#${close.dataset.close}`).close();
  const view = event.target.closest('[data-view]');
  if (view) {
    state.view = view.dataset.view;
    $$('.tab').forEach((tab) => { tab.classList.toggle('active', tab === view); tab.setAttribute('aria-pressed', String(tab === view)); });
    render();
  }
  const detail = event.target.closest('[data-detail]');
  if (detail) { detailId = detail.dataset.detail; renderDetail(); $('#detail-dialog').showModal(); }
  const cancel = event.target.closest('[data-cancel]');
  if (cancel) openCancellation(cancel.dataset.cancel);
});
$('#refresh').addEventListener('click', refresh);
$('#create-open').addEventListener('click', openCreate);
$('#empty-create').addEventListener('click', openCreate);
$('#task-type').addEventListener('change', updateForm);
$('#timing').addEventListener('change', updateForm);
$('#wait-toggle').addEventListener('change', updateForm);
$('#create-form').elements.count.addEventListener('input', updateForm);
$('#create-form').addEventListener('submit', (event) => {
  event.preventDefault();
  saveFromForm(event.currentTarget, '#create-error', [buildTask(event.currentTarget)], () => { $('#create-dialog').close(); toast('Task created.'); });
});
$('#import-open').addEventListener('click', () => {
  $('#import-form').reset();
  $('#import-preview').value = '';
  $('#import-dialog .preview').open = false;
  importTasks = null;
  $('#import-submit').disabled = true;
  $('#import-submit').textContent = 'Import tasks';
  message('#import-error');
  $('#import-dialog').showModal();
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
  saveFromForm(event.currentTarget, '#import-error', importTasks, (result) => { $('#import-dialog').close(); toast(`${result.added} task${result.added === 1 ? '' : 's'} imported.`); });
});
$('#cancel-confirm').addEventListener('click', async () => {
  $('#cancel-confirm').disabled = true;
  message('#cancel-error');
  try {
    const result = await api('/api/cancel', {task_id: cancelId});
    $('#cancel-dialog').close();
    toast(result.stop_requested ? 'Stop requested. Waiting for confirmation.' : 'Task cancelled.');
    await refresh();
  } catch (error) { message('#cancel-error', error.message); }
  finally { $('#cancel-confirm').disabled = false; }
});
updateForm();
refresh();
setInterval(() => { if (!document.hidden && !document.querySelector('dialog[open]')) refresh(); }, 30000);
