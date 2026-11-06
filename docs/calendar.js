'use strict';

const DAY_MS = 86_400_000;
const $ = (id) => document.getElementById(id);
const dateFormat = new Intl.DateTimeFormat('en-US', {
  month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
});
const monthFormat = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });
const dateValue = (value) => new Date(`${value}T00:00:00Z`);
const labelFor = (day) => `${day.count.toLocaleString('en-US')} ${day.count === 1 ? 'contribution' : 'contributions'} on ${dateFormat.format(dateValue(day.date))}`;

// Validate the published snapshot before presenting any counts. A failed refresh
// must never turn into a plausible-looking calendar of zero contributions.
function validateSnapshot(data) {
  if (data.username !== 'pablocamarillo' || !Array.isArray(data.days) ||
      data.days.length < 365 || data.days.length > 371 ||
      !Number.isSafeInteger(data.total) || data.total < 0) {
    throw new Error('Invalid contribution snapshot.');
  }
  let previous = null;
  let total = 0;
  for (const day of data.days) {
    const timestamp = dateValue(day.date).getTime();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date) || !Number.isFinite(timestamp) ||
        new Date(timestamp).toISOString().slice(0, 10) !== day.date ||
        (previous !== null && timestamp - previous !== DAY_MS) ||
        !Number.isSafeInteger(day.count) || day.count < 0 ||
        !Number.isInteger(day.level) || day.level < 0 || day.level > 4 ||
        ((day.count === 0) !== (day.level === 0))) {
      throw new Error('Invalid daily contribution data.');
    }
    previous = timestamp;
    total += day.count;
  }
  if (total !== data.total || data.from !== data.days[0].date ||
      data.to !== data.days.at(-1).date ||
      typeof data.fetched_at !== 'string' || !Number.isFinite(Date.parse(data.fetched_at))) {
    throw new Error('Contribution snapshot metadata does not match its days.');
  }
  const source = new URL(data.source);
  if (source.origin !== 'https://github.com' || source.pathname !== '/users/pablocamarillo/contributions') {
    throw new Error('Unrecognized contribution source.');
  }
  return data;
}

function renderCalendar(data) {
  const first = dateValue(data.from);
  const offset = first.getUTCDay();
  const weeks = Math.ceil((offset + data.days.length) / 7);
  $('months').style.setProperty('--weeks', weeks);
  const monthLabels = [];
  let lastMonth = '';
  let lastColumn = -4;
  data.days.forEach((day, index) => {
    const month = day.date.slice(0, 7);
    const column = Math.floor((index + offset) / 7);
    if (month !== lastMonth) {
      // The initial partial month and final partial month can occupy one week.
      // Avoid overlapping text while keeping every contribution cell intact.
      if (column - lastColumn >= 3 && column < weeks - 1) {
        const label = document.createElement('span');
        label.textContent = monthFormat.format(dateValue(day.date));
        label.style.gridColumn = String(column + 2);
        monthLabels.push(label);
        lastColumn = column;
      }
      lastMonth = month;
    }
  });
  $('months').replaceChildren(...monthLabels);

  const buttons = [];
  const rows = [];
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  for (let row = 0; row < 7; row += 1) {
    const tr = document.createElement('tr');
    tr.setAttribute('role', 'row');
    const th = document.createElement('th');
    th.scope = 'row';
    th.setAttribute('role', 'rowheader');
    const weekday = document.createElement('span');
    weekday.textContent = weekdays[row];
    if (![1, 3, 5].includes(row)) weekday.className = 'visually-hidden';
    th.append(weekday);
    tr.append(th);
    for (let column = 0; column < weeks; column += 1) {
      const index = column * 7 + row - offset;
      const td = document.createElement('td');
      td.setAttribute('role', 'gridcell');
      if (index >= 0 && index < data.days.length) {
        const day = data.days[index];
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `day level-${day.level}`;
        button.tabIndex = index === data.days.length - 1 ? 0 : -1;
        button.setAttribute('aria-label', labelFor(day));
        button.dataset.date = day.date;
        button.dataset.count = String(day.count);
        button.dataset.level = String(day.level);
        button.dataset.index = String(index);
        buttons[index] = button;
        td.append(button);
      } else {
        td.setAttribute('aria-disabled', 'true');
        td.setAttribute('aria-label', 'Outside the displayed date range');
      }
      tr.append(td);
    }
    rows.push(tr);
  }
  $('days').replaceChildren(...rows);
  $('calendar-title').textContent = `${data.total.toLocaleString('en-US')} contributions in the last year`;
  $('range').textContent = `${dateFormat.format(first)} — ${dateFormat.format(dateValue(data.to))}`;
  $('source-link').href = data.source;
  const fetched = new Date(data.fetched_at);
  $('updated').textContent = `Last refreshed ${new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC',
  }).format(fetched)} UTC · Updated daily.`;
  const stale = Date.now() - fetched.getTime() > 2 * DAY_MS;
  $('status').textContent = stale ? 'This saved snapshot is more than 48 hours old. Check the GitHub source for the latest activity.' : '';
  $('status').classList.toggle('warning', stale);
  $('status').hidden = !stale;
  $('calendar-content').hidden = false;
  attachInteraction(buttons);
  // Keep the most recent activity in view on narrow screens.
  $('calendar-scroll').scrollLeft = $('calendar-scroll').scrollWidth;
}

function attachInteraction(buttons) {
  const tooltip = $('day-tooltip');
  let activeButton = null;
  let tabStop = buttons.at(-1);
  const reposition = () => {
    if (!activeButton || tooltip.hidden) return;
    const rect = activeButton.getBoundingClientRect();
    const viewport = $('calendar-scroll').getBoundingClientRect();
    if (rect.right < viewport.left + 38 || rect.left > viewport.right) {
      tooltip.hidden = true;
      return;
    }
    const tip = tooltip.getBoundingClientRect();
    const left = Math.min(window.innerWidth - tip.width - 8, Math.max(8, rect.left + rect.width / 2 - tip.width / 2));
    const top = rect.top - tip.height - 10;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top < 8 ? rect.bottom + 10 : top}px`;
  };
  const show = (button) => {
    activeButton = button;
    tooltip.textContent = button.getAttribute('aria-label');
    tooltip.hidden = false;
    reposition();
  };
  const hide = () => { tooltip.hidden = true; activeButton = null; };
  for (const button of buttons) {
    button.addEventListener('pointerenter', () => show(button));
    button.addEventListener('pointerleave', () => {
      if (document.activeElement === button) return;
      if (buttons.includes(document.activeElement)) show(document.activeElement);
      else hide();
    });
    button.addEventListener('focus', () => {
      tabStop.tabIndex = -1;
      button.tabIndex = 0;
      tabStop = button;
      button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      show(button);
    });
    button.addEventListener('blur', hide);
    button.addEventListener('click', () => { button.focus(); show(button); });
    button.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { hide(); return; }
      const index = Number(button.dataset.index);
      const shifts = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
      let next;
      if (Object.hasOwn(shifts, event.key)) next = index + shifts[event.key];
      else if (event.key === 'Home') next = event.ctrlKey ? 0 : index - dateValue(button.dataset.date).getUTCDay();
      else if (event.key === 'End') next = event.ctrlKey ? buttons.length - 1 : index + 6 - dateValue(button.dataset.date).getUTCDay();
      else return;
      event.preventDefault();
      buttons[Math.max(0, Math.min(buttons.length - 1, next))].focus();
    });
  }
  $('calendar-scroll').addEventListener('scroll', reposition, { passive: true });
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, { passive: true });
  document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.day')) hide();
  });
}

async function loadCalendar() {
  try {
    const response = await fetch('./data/contributions.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Snapshot HTTP ${response.status}`);
    renderCalendar(validateSnapshot(await response.json()));
  } catch (error) {
    $('calendar-title').textContent = 'Contribution data is unavailable';
    $('status').hidden = false;
    $('status').classList.add('warning');
    $('status').textContent = 'The saved calendar could not be loaded or verified. Open the GitHub source below to see the latest activity.';
    console.error('Unable to load the contribution calendar:', error);
  }
}

loadCalendar();
