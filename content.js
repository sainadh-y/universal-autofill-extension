function normalizeText(text = '') {
  return String(text)
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function textContentOf(node) {
  return String(node?.innerText || node?.textContent || '').trim();
}

function uniqueNonEmpty(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function firstText(values) {
  return uniqueNonEmpty(values)[0] || '';
}

function getAriaText(element) {
  const ariaLabel = String(element?.getAttribute?.('aria-label') || '').trim();
  if (ariaLabel) return ariaLabel;

  const labelledBy = String(element?.getAttribute?.('aria-labelledby') || '')
    .split(/\s+/)
    .map((id) => document.getElementById(id))
    .filter(Boolean)
    .map((node) => textContentOf(node));

  return firstText(labelledBy);
}

function isVisible(element) {
  if (!element || !element.isConnected) return false;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function clickElement(element) {
  element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  element.click();
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function dispatchValueEvents(element) {
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new Event('blur', { bubbles: true }));
}

function getLabelText(element) {
  const ariaText = getAriaText(element);
  if (ariaText) return ariaText;

  if (element.labels && element.labels.length > 0) {
    const directLabel = Array.from(element.labels)
      .map((label) => textContentOf(label))
      .find(Boolean);
    if (directLabel) return directLabel;
  }

  if (element.id) {
    const explicit = document.querySelector(`label[for="${element.id}"]`);
    const explicitText = textContentOf(explicit);
    if (explicitText) return explicitText;
  }

  const parentLabel = element.closest('label');
  const parentLabelText = textContentOf(parentLabel);
  if (parentLabelText) return parentLabelText;

  const fallbackParts = [
    element.name,
    element.id,
    element.placeholder,
    element.getAttribute('autocomplete')
  ].filter(Boolean);

  const previous = element.previousElementSibling;
  if (previous) {
    const prevText = previous.innerText || previous.textContent || '';
    if (prevText.trim()) fallbackParts.push(prevText);
  }

  const container = element.closest('div, td, th, section, article, li, p');
  if (container) {
    const containerText = (container.innerText || container.textContent || '').trim();
    if (containerText) fallbackParts.push(containerText.slice(0, 120));
  }

  return [...new Set(fallbackParts.map((part) => String(part).trim()).filter(Boolean))].join(' ').trim();
}

function selectorKey(element, index) {
  return [
    element.tagName.toLowerCase(),
    element.type || '',
    element.name || '',
    element.id || '',
    element.placeholder || '',
    index
  ].join('|');
}

function customSelectorKey(kind, element, index) {
  return [
    'custom',
    kind,
    element.id || '',
    element.getAttribute('name') || '',
    element.getAttribute('aria-label') || '',
    index
  ].join('|');
}

function getOptionText(option) {
  return firstText([
    getAriaText(option),
    option.getAttribute('data-value'),
    option.getAttribute('value'),
    textContentOf(option)
  ]);
}

function minimalGroupRoot(option, role) {
  let node = option.parentElement;
  let best = null;

  while (node && node !== document.body) {
    const count = node.querySelectorAll(`[role="${role}"]`).length;
    if (count > 1) {
      best = node;
      node = node.parentElement;
      continue;
    }
    if (best) break;
    node = node.parentElement;
  }

  return best;
}

function getCustomControlLabel(element) {
  const direct = getAriaText(element);
  if (direct) return direct;

  const fieldset = element.closest('fieldset');
  const legendText = textContentOf(fieldset?.querySelector('legend'));
  if (legendText) return legendText;

  const previous = firstText([
    textContentOf(element.previousElementSibling),
    textContentOf(element.parentElement?.previousElementSibling)
  ]);
  if (previous) return previous;

  const container = element.closest('section, article, li, div, td, th, form');
  if (container) {
    const candidates = uniqueNonEmpty(
      Array.from(container.children)
        .filter((child) => child !== element && !child.contains(element))
        .map((child) => textContentOf(child))
        .filter((text) => text && text.length <= 120)
    );
    if (candidates.length > 0) return candidates[0];
  }

  return '';
}

function collectNativeControls() {
  return Array.from(document.querySelectorAll('input, textarea, select'))
    .filter((element) => {
      const type = (element.type || element.tagName.toLowerCase()).toLowerCase();
      if (element.disabled || element.readOnly) return false;
      if (['hidden', 'password', 'file', 'submit', 'button', 'reset'].includes(type)) return false;
      return true;
    })
    .map((element, index) => ({
      mode: 'native',
      element,
      key: selectorKey(element, index),
      tag: element.tagName.toLowerCase(),
      type: (element.type || element.tagName.toLowerCase()).toLowerCase(),
      label: getLabelText(element),
      name: element.name || '',
      id: element.id || '',
      placeholder: element.placeholder || '',
      aria_label: element.getAttribute('aria-label') || ''
    }));
}

function collectCustomControls() {
  const controls = [];
  const seen = new Set();

  const addControl = (kind, element, typeOverride) => {
    if (!element || seen.has(element)) return;
    if (!isVisible(element)) return;
    seen.add(element);
    controls.push({
      mode: 'custom',
      kind,
      element,
      key: customSelectorKey(kind, element, controls.length),
      tag: 'custom',
      type: typeOverride,
      label: getCustomControlLabel(element),
      name: element.getAttribute('name') || '',
      id: element.id || '',
      placeholder: '',
      aria_label: element.getAttribute('aria-label') || ''
    });
  };

  document.querySelectorAll('[role="radiogroup"]').forEach((element) => addControl('radiogroup', element, 'radio'));

  document.querySelectorAll('[role="combobox"], [role="listbox"]').forEach((element) => {
    if (element.matches('select')) return;
    const type = element.getAttribute('aria-multiselectable') === 'true' ? 'multiselect' : 'select';
    addControl('select', element, type);
  });

  const groupedCheckboxRoots = new Set();
  document.querySelectorAll('[role="checkbox"]').forEach((option) => {
    if (option.matches('input')) return;
    const root = minimalGroupRoot(option, 'checkbox');
    if (root) groupedCheckboxRoots.add(root);
  });
  groupedCheckboxRoots.forEach((root) => addControl('checkbox-group', root, 'multiselect'));

  document.querySelectorAll('[role="checkbox"]').forEach((element) => {
    if (element.matches('input')) return;
    if (Array.from(groupedCheckboxRoots).some((root) => root.contains(element))) return;
    addControl('checkbox', element, 'checkbox');
  });

  document.querySelectorAll('[role="radio"]').forEach((element) => {
    if (element.matches('input')) return;
    if (element.closest('[role="radiogroup"]')) return;
    const root = minimalGroupRoot(element, 'radio');
    if (root) {
      addControl('radio-group', root, 'radio');
      return;
    }
    addControl('radio', element, 'radio');
  });

  return controls;
}

function collectControls() {
  return [...collectNativeControls(), ...collectCustomControls()];
}

function detectFields() {
  const detected = [];
  const all = collectControls();

  all.forEach((element, index) => {
    detected.push({
      selector_key: element.key || selectorKey(element.element, index),
      tag: element.tag,
      type: element.type === 'textarea' ? 'textarea' : element.type,
      label: element.label,
      name: element.name,
      id: element.id,
      placeholder: element.placeholder,
      aria_label: element.aria_label,
      mode: element.mode
    });
  });

  return detected;
}

function setNativeValue(element, value) {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value');
  if (descriptor?.set) descriptor.set.call(element, value);
  else element.value = value;
}

function normalizeDateValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  }

  const dmy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeTimeValue(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';

  const hm = raw.match(/^(\d{1,2}):(\d{2})(?:\s*(am|pm))?$/);
  if (hm) {
    let hour = Number(hm[1]);
    const minute = hm[2];
    const suffix = hm[3];
    if (suffix === 'pm' && hour < 12) hour += 12;
    if (suffix === 'am' && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:${minute}`;
  }

  const hourOnly = raw.match(/^(\d{1,2})\s*(am|pm)$/);
  if (hourOnly) {
    let hour = Number(hourOnly[1]);
    const suffix = hourOnly[2];
    if (suffix === 'pm' && hour < 12) hour += 12;
    if (suffix === 'am' && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:00`;
  }

  return raw;
}

function fillSelect(element, value) {
  const target = normalizeText(value);
  const options = Array.from(element.options || []);
  if (!options.length) return false;

  const selected = options.find((option) => {
    const optionText = normalizeText(option.textContent || '');
    const optionValue = normalizeText(option.value || '');
    return optionText === target || optionValue === target || optionText.includes(target) || target.includes(optionText);
  });

  if (!selected) return false;
  element.value = selected.value;
  dispatchValueEvents(element);
  return true;
}

function fillCheckbox(element, value) {
  const truthy = ['true', '1', 'on', 'checked', 'yes', 'y'];
  const desired = truthy.includes(normalizeText(value));
  element.checked = desired;
  dispatchValueEvents(element);
  return element.checked === desired;
}

function fillRadio(element, value) {
  if (!element.name) return false;
  const group = Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(element.name)}"]`));
  const target = normalizeText(value);
  const option = group.find((radio) => {
    const text = normalizeText(`${radio.value || ''} ${getLabelText(radio)}`);
    return text.includes(target) || target.includes(text);
  });

  if (!option) return false;
  option.checked = true;
  dispatchValueEvents(option);
  return option.checked === true;
}

function fillCustomCheckbox(element, value) {
  const target = normalizeText(value);
  const truthy = ['true', '1', 'on', 'checked', 'yes', 'y'];
  const desired = truthy.includes(target);
  const current = element.getAttribute('aria-checked') === 'true';
  if (current !== desired) clickElement(element);
  return (element.getAttribute('aria-checked') === 'true') === desired;
}

function fillCustomCheckboxGroup(root, value) {
  const wanted = uniqueNonEmpty(String(value || '').split(',').map((part) => normalizeText(part)));
  const options = Array.from(root.querySelectorAll('[role="checkbox"]')).filter(isVisible);
  if (!options.length) return false;

  if (!wanted.length) {
    return true;
  }

  let matched = 0;
  for (const option of options) {
    const optionText = normalizeText(getOptionText(option));
    const shouldCheck = wanted.some((item) => optionText === item || optionText.includes(item) || item.includes(optionText));
    const isChecked = option.getAttribute('aria-checked') === 'true';
    if (shouldCheck && !isChecked) clickElement(option);
  }

  for (const option of options) {
    const optionText = normalizeText(getOptionText(option));
    const isChecked = option.getAttribute('aria-checked') === 'true';
    if (wanted.some((item) => optionText === item || optionText.includes(item) || item.includes(optionText)) && isChecked) {
      matched += 1;
    }
  }

  return matched > 0;
}

function fillCustomRadioGroup(root, value) {
  const target = normalizeText(value);
  const options = Array.from(root.querySelectorAll('[role="radio"]')).filter(isVisible);
  const option = options.find((candidate) => {
    const text = normalizeText(getOptionText(candidate));
    return text === target || text.includes(target) || target.includes(text);
  });
  if (!option) return false;
  clickElement(option);
  return option.getAttribute('aria-checked') === 'true';
}

function getCustomSelectOptions(root) {
  const controlled = root.getAttribute('aria-controls');
  const fromControlled = controlled ? document.getElementById(controlled) : null;
  const optionSources = [fromControlled, document.body, root].filter(Boolean);
  const found = [];

  for (const source of optionSources) {
    Array.from(source.querySelectorAll('[role="option"]')).forEach((option) => {
      if (!found.includes(option) && isVisible(option)) found.push(option);
    });
    if (found.length > 0) break;
  }

  return found;
}

function getCustomSelectTrigger(root) {
  const candidates = [
    root,
    root.querySelector('[aria-haspopup="listbox"]'),
    root.querySelector('[role="button"]'),
    root.querySelector('[tabindex]')
  ].filter(Boolean);

  return candidates.find(isVisible) || root;
}

function isCustomOptionSelected(root, option, targetValue) {
  const target = normalizeText(targetValue);
  const optionText = normalizeText(getOptionText(option));
  const rootText = normalizeText(textContentOf(root));
  const selectedByOption = option.getAttribute('aria-selected') === 'true' || option.getAttribute('aria-checked') === 'true';
  const activeDescendantId = root.getAttribute('aria-activedescendant');
  const activeOption = activeDescendantId ? document.getElementById(activeDescendantId) : null;
  const activeText = normalizeText(getOptionText(activeOption || {}));

  return (
    (selectedByOption && (optionText === target || optionText.includes(target) || target.includes(optionText))) ||
    activeText === target ||
    rootText.includes(target)
  );
}

async function fillCustomSelect(root, value) {
  const target = normalizeText(value);
  if (!target) return false;

  clickElement(getCustomSelectTrigger(root));
  await wait(120);

  const options = getCustomSelectOptions(root);
  const option = options.find((candidate) => {
    const text = normalizeText(getOptionText(candidate));
    return text === target || text.includes(target) || target.includes(text);
  });

  if (!option) return false;
  clickElement(option);
  await wait(120);

  return isCustomOptionSelected(root, option, target);
}

async function fillCustomMultiSelect(root, value) {
  const wanted = uniqueNonEmpty(String(value || '').split(',').map((part) => normalizeText(part)));
  if (!wanted.length) return false;

  clickElement(getCustomSelectTrigger(root));
  await wait(120);

  const options = getCustomSelectOptions(root);
  if (!options.length) return false;

  let matched = 0;
  for (const item of wanted) {
    const option = options.find((candidate) => {
      const text = normalizeText(getOptionText(candidate));
      return text === item || text.includes(item) || item.includes(text);
    });
    if (!option) continue;
    if (!isCustomOptionSelected(root, option, item)) {
      clickElement(option);
      await wait(40);
    }
    if (isCustomOptionSelected(root, option, item)) matched += 1;
    await wait(30);
  }

  return matched > 0;
}

function fillCustomRadio(element, value) {
  const target = normalizeText(value);
  const text = normalizeText(getOptionText(element));
  if (!(text === target || text.includes(target) || target.includes(text))) return false;
  clickElement(element);
  return element.getAttribute('aria-checked') === 'true';
}

async function fillControl(control, value) {
  const element = control.element;
  if (control.mode === 'custom') {
    if (control.kind === 'checkbox') return fillCustomCheckbox(element, value);
    if (control.kind === 'checkbox-group') return fillCustomCheckboxGroup(element, value);
    if (control.kind === 'radio') return fillCustomRadio(element, value);
    if (control.kind === 'radiogroup' || control.kind === 'radio-group') return fillCustomRadioGroup(element, value);
    if (control.kind === 'select') {
      if (control.type === 'multiselect') return fillCustomMultiSelect(element, value);
      return fillCustomSelect(element, value);
    }
  }

  const tag = element.tagName.toLowerCase();
  const type = (element.type || tag).toLowerCase();

  if (tag === 'select') return fillSelect(element, value);
  if (type === 'checkbox') return fillCheckbox(element, value);
  if (type === 'radio') return fillRadio(element, value);

  let normalizedValue = String(value ?? '');
  if (type === 'date') normalizedValue = normalizeDateValue(value);
  if (type === 'time') normalizedValue = normalizeTimeValue(value);
  if (type === 'datetime-local') {
    const datePart = normalizeDateValue(value);
    const timePart = normalizeTimeValue(value);
    if (datePart && timePart) normalizedValue = `${datePart}T${timePart}`;
  }

  setNativeValue(element, normalizedValue);
  dispatchValueEvents(element);
  return String(element.value) === String(normalizedValue) || normalizeText(element.value) === normalizeText(normalizedValue);
}

async function applyMatches(matches) {
  const all = collectControls();
  const keyed = new Map();

  all.forEach((control) => {
    keyed.set(control.key, control);
  });

  let applied = 0;
  let failed = 0;

  for (const match of matches || []) {
    const key = String(match.key || '');
    const control = keyed.get(key);
    if (!control) {
      failed += 1;
      continue;
    }

    if (await fillControl(control, match.field_value)) applied += 1;
    else failed += 1;
  }

  return { applied, failed };
}

if (!window.__AI_AUTOFILL_LISTENER_ADDED__) {
  window.__AI_AUTOFILL_LISTENER_ADDED__ = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'DETECT_FIELDS') {
      sendResponse({ detected_fields: detectFields(), domain: window.location.hostname.toLowerCase() });
      return true;
    }

    if (message.type === 'APPLY_MATCHES') {
      applyMatches(message.matches || [])
        .then((result) => sendResponse(result))
        .catch(() => sendResponse({ applied: 0, failed: (message.matches || []).length }));
      return true;
    }

    return false;
  });
}
