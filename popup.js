const API_URL = 'https://ai-autofill-mvp.onrender.com/api';

const defaultSettings = {
  token: '',
  profileId: '',
  includeSensitive: false
};

let lastPreview = null;

function setStatus(text, error = false) {
  const status = document.getElementById('status');
  status.textContent = text;
  status.style.color = error ? '#a12d2d' : '#2d7a45';
}

function setDetails(text) {
  document.getElementById('details').textContent = text || '';
}

async function getSettings() {
  return chrome.storage.sync.get(defaultSettings);
}

async function saveSettings() {
  const payload = {
    token: document.getElementById('token').value.trim(),
    profileId: document.getElementById('profileSelect').value,
    includeSensitive: document.getElementById('includeSensitive').checked
  };
  await chrome.storage.sync.set(payload);
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Request failed');
  return data;
}

function authHeaders(token) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  };
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendTabMessage(tabId, payload) {
  try {
    return await chrome.tabs.sendMessage(tabId, payload);
  } catch (_error) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
    return chrome.tabs.sendMessage(tabId, payload);
  }
}

function renderProfiles(profiles, selectedId) {
  const select = document.getElementById('profileSelect');
  select.innerHTML = '';
  for (const profile of profiles) {
    const option = document.createElement('option');
    option.value = String(profile.id);
    option.textContent = `${profile.name}${profile.is_default ? ' (default)' : ''}`;
    select.appendChild(option);
  }
  const defaultProfile = profiles.find((p) => p.is_default) || profiles[0];
  const selectedProfile = profiles.find((p) => String(p.id) === String(selectedId));

  // Prefer the server-side default profile unless the saved selection already points to it.
  if (selectedProfile && selectedProfile.is_default) {
    select.value = String(selectedProfile.id);
  } else if (defaultProfile) {
    select.value = String(defaultProfile.id);
  }
}

async function loadProfiles(token, selectedId) {
  const profiles = await fetchJson(`${API_URL}/profile/profiles`, {
    headers: authHeaders(token)
  });
  renderProfiles(profiles, selectedId);
}

function summarizePreview(preview) {
  const lines = [];
  lines.push(`Detected: ${preview.summary.total_detected}`);
  lines.push(`Matched: ${preview.summary.matched}`);
  lines.push(`Skipped: ${preview.summary.skipped}`);
  lines.push(`Unsupported: ${preview.summary.unsupported}`);
  lines.push('');
  lines.push('Top matches:');
  preview.matches.slice(0, 8).forEach((match) => {
    lines.push(`- ${match.label || '(no label)'} -> ${match.field_title} (${Math.round(match.confidence * 100)}%)`);
  });
  return lines.join('\n');
}

async function runPreview() {
  const settings = await getSettings();
  if (!settings.token) throw new Error('Token missing. Save token first.');

  const tab = await getActiveTab();
  const detected = await sendTabMessage(tab.id, { type: 'DETECT_FIELDS' });
  const profileId = document.getElementById('profileSelect').value || settings.profileId;
  const includeSensitive = document.getElementById('includeSensitive').checked;

  const preview = await fetchJson(`${API_URL}/profile/preview`, {
    method: 'POST',
    headers: authHeaders(settings.token),
    body: JSON.stringify({
      profile_id: Number(profileId),
      domain: detected.domain || new URL(tab.url).hostname.toLowerCase(),
      include_sensitive: includeSensitive,
      detected_fields: detected.detected_fields || []
    })
  });

  lastPreview = { ...preview, domain: detected.domain || new URL(tab.url).hostname.toLowerCase() };
  setDetails(summarizePreview(preview));
  setStatus(`Preview ready: ${preview.summary.matched} matches.`);
  return { tab, profileId };
}

async function saveMappings(token, profileId, domain, matches) {
  const mappings = matches
    .filter((m) => m.key && m.field_id)
    .map((m) => ({ selector_key: m.key, field_id: m.field_id }));
  if (!mappings.length) return;

  await fetchJson(`${API_URL}/profile/mappings`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      profile_id: Number(profileId),
      domain,
      mappings
    })
  });
}

async function runApply() {
  const settings = await getSettings();
  if (!lastPreview) {
    await runPreview();
  }
  if (!lastPreview || !lastPreview.matches.length) {
    setStatus('No matches to apply.', true);
    return;
  }

  const tab = await getActiveTab();
  const applyResult = await sendTabMessage(tab.id, {
    type: 'APPLY_MATCHES',
    matches: lastPreview.matches
  });

  await saveMappings(
    settings.token,
    document.getElementById('profileSelect').value || settings.profileId,
    lastPreview.domain,
    lastPreview.matches
  );

  const applied = applyResult?.applied || 0;
  const failed = applyResult?.failed || 0;
  setStatus(`Applied ${applied} fields${failed ? `, failed ${failed}` : ''}.`);
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const settings = await getSettings();
    document.getElementById('token').value = settings.token;
    document.getElementById('includeSensitive').checked = Boolean(settings.includeSensitive);

    if (settings.token) {
      await loadProfiles(settings.token, settings.profileId);
    }
  } catch (error) {
    setStatus(error.message, true);
  }

  document.getElementById('save').addEventListener('click', async () => {
    try {
      await saveSettings();
      const settings = await getSettings();
      if (settings.token) {
        await loadProfiles(settings.token, settings.profileId);
        await saveSettings();
      }
      setStatus('Settings saved.');
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  document.getElementById('preview').addEventListener('click', () => {
    runPreview().catch((error) => setStatus(error.message, true));
  });

  document.getElementById('autofill').addEventListener('click', () => {
    runApply().catch((error) => setStatus(error.message, true));
  });
});
