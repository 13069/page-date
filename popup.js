const DEFAULT_SETTINGS = {
  enabled: true,
  clickMode: false,
  showPageDate: true,
  analyzeImages: true,
  analyzePosts: true,
  analyzeText: true,
  analyzeContainers: true,
  apiKey: 'pagedate_sk_live_8f2c1a9e4b7d3f6c',
  apiUrl: 'http://localhost:3847'
};

const toggles = {
  enabled: document.getElementById('toggle-enabled'),
  clickMode: document.getElementById('toggle-click'),
  showPageDate: document.getElementById('toggle-page-date'),
  analyzeImages: document.getElementById('toggle-images'),
  analyzePosts: document.getElementById('toggle-posts'),
  analyzeText: document.getElementById('toggle-text'),
  analyzeContainers: document.getElementById('toggle-containers')
};

const apiUrlInput = document.getElementById('api-url');
const apiKeyInput = document.getElementById('api-key');
const statusText = document.getElementById('status-text');
const infoPageDate = document.getElementById('info-page-date');
const infoScanned = document.getElementById('info-scanned');
const infoDated = document.getElementById('info-dated');
const infoCms = document.getElementById('info-cms');
const quotaScans = document.getElementById('quota-scans');
const quotaRemaining = document.getElementById('quota-remaining');
const btnRescan = document.getElementById('btn-rescan');
const btnResetQuota = document.getElementById('btn-reset-quota');

function loadSettings() {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
    toggles.enabled.checked = settings.enabled;
    toggles.clickMode.checked = settings.clickMode;
    toggles.showPageDate.checked = settings.showPageDate;
    toggles.analyzeImages.checked = settings.analyzeImages;
    toggles.analyzePosts.checked = settings.analyzePosts;
    toggles.analyzeText.checked = settings.analyzeText;
    toggles.analyzeContainers.checked = settings.analyzeContainers;
    apiUrlInput.value = settings.apiUrl || DEFAULT_SETTINGS.apiUrl;
    apiKeyInput.value = settings.apiKey || DEFAULT_SETTINGS.apiKey;
    updateStatus(settings.enabled);
    loadQuota();
  });
}

function getSettings() {
  return {
    enabled: toggles.enabled.checked,
    clickMode: toggles.clickMode.checked,
    showPageDate: toggles.showPageDate.checked,
    analyzeImages: toggles.analyzeImages.checked,
    analyzePosts: toggles.analyzePosts.checked,
    analyzeText: toggles.analyzeText.checked,
    analyzeContainers: toggles.analyzeContainers.checked,
    apiUrl: apiUrlInput.value.trim() || DEFAULT_SETTINGS.apiUrl,
    apiKey: apiKeyInput.value.trim() || DEFAULT_SETTINGS.apiKey
  };
}

function saveSettings() {
  chrome.storage.sync.set(getSettings());
  updateStatus(toggles.enabled.checked);
  loadQuota();
}

function updateStatus(enabled) {
  statusText.textContent = enabled ? 'Status: Active' : 'Status: Paused';
  statusText.classList.toggle('inactive', !enabled);
}

function formatDate(date) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function loadQuota() {
  chrome.runtime.sendMessage({ type: 'GET_QUOTA' }, (response) => {
    if (!response?.ok) {
      quotaScans.textContent = '—';
      quotaRemaining.textContent = '—';
      return;
    }
    const q = response.quota;
    quotaScans.textContent = `${q.scansUsed} / ${q.dailyScanLimit}`;
    quotaRemaining.textContent = String(q.scansRemaining);
  });
}

async function loadPageInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_STATUS' });
    if (!response) return;

    const pd = response.pageDate;
    infoPageDate.textContent = pd ? `${pd.inferred ? '~' : ''}${formatDate(pd.date)}` : 'Not detected';

    const s = response.scanned;
    const d = response.dated;
    infoScanned.textContent = s ? `📷${s.images} 📝${s.posts} 💬${s.text} 📦${s.containers}` : '—';
    infoDated.textContent = d ? `📷${d.images} 📝${d.posts} 💬${d.text} 📦${d.containers}` : '—';
    infoCms.textContent = response.cms || 'Unknown';
  } catch {
    infoPageDate.textContent = '—';
    infoScanned.textContent = '—';
    infoDated.textContent = '—';
    infoCms.textContent = '—';
  }
}

async function rescanPage() {
  btnRescan.disabled = true;
  saveSettings();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await chrome.tabs.sendMessage(tab.id, { type: 'RESCAN' });
      await new Promise((r) => setTimeout(r, 2000));
      await loadPageInfo();
      loadQuota();
    }
  } finally {
    btnRescan.disabled = false;
  }
}

btnResetQuota.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'RESET_QUOTA' }, () => loadQuota());
});

Object.values(toggles).forEach((t) => t.addEventListener('change', saveSettings));
apiUrlInput.addEventListener('change', saveSettings);
apiKeyInput.addEventListener('change', saveSettings);
btnRescan.addEventListener('click', rescanPage);

loadSettings();
loadPageInfo();
