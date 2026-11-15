const status = document.querySelector('#focus-status');
const message = document.querySelector('#message');
const form = document.querySelector('#domain-form');
const input = document.querySelector('#domain-input');
const list = document.querySelector('#domain-list');
const count = document.querySelector('#domain-count');
const emptyState = document.querySelector('#empty-state');

function send(type, payload = {}) {
  return chrome.runtime.sendMessage({ version: 1, type, ...payload });
}

function render(state) {
  const locked = Boolean(state.focusLock && Date.parse(state.focusLock.expectedEndAt) > Date.now());
  status.textContent = locked
    ? `Blocklist locked until ${new Date(state.focusLock.expectedEndAt).toLocaleTimeString()}.`
    : 'No active focus session.';
  input.disabled = locked;
  const addButton = form.querySelector('button[type="submit"]');
  addButton.disabled = locked;
  list.replaceChildren();
  for (const domain of state.blocklist) {
    const item = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = domain;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.disabled = locked;
    remove.setAttribute('aria-label', `Remove ${domain}`);
    remove.addEventListener('click', () => void removeDomain(domain));
    item.append(label, remove);
    list.append(item);
  }
  count.textContent = String(state.blocklist.length);
  emptyState.hidden = state.blocklist.length > 0;
}

async function refresh() {
  try {
    const result = await send('studyvault.extension.get-state.v1');
    if (!result?.ok) throw new Error('Could not load the blocklist.');
    render(result.state);
  } catch {
    status.textContent = 'Could not load extension state.';
  }
}

async function removeDomain(domain) {
  message.textContent = '';
  try {
    const result = await send('studyvault.extension.remove-domain.v1', { domain });
    if (!result?.ok) throw new Error(errorText(result?.error));
    render(result.state);
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : 'Could not update the blocklist.';
    await refresh();
  }
}

function errorText(code) {
  if (code === 'blocklist-locked') return 'The blocklist is locked during a focus session.';
  if (code === 'blocklist-full') return 'The blocklist limit has been reached.';
  if (code === 'invalid-domain') return 'Enter a domain such as example.com.';
  return 'Could not update the blocklist.';
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = '';
  try {
    const result = await send('studyvault.extension.add-domain.v1', { domain: input.value });
    if (!result?.ok) throw new Error(errorText(result?.error));
    input.value = '';
    render(result.state);
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : 'Could not update the blocklist.';
  }
});

void refresh();
