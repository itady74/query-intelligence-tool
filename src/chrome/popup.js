import { generateQueries } from '@core/rules-engine';
import { classifyIntents } from '@core/intent-classifier';
import { normalizeAndDeduplicate } from '@core/normalizer';
import { fetchGoogleSuggestions } from '@core/google-suggest-provider';
import { exportToCSV } from '@utils/csv-exporter';
import { logger } from '@utils/logger';

let currentResults = [];
let activeTab = 'all';

function setLoading(isLoading) {
  const btn = document.getElementById('generate-btn');
  if (!btn) return;
  btn.disabled = isLoading;
  btn.textContent = isLoading ? 'Generating…' : 'Generate Queries';
}

function renderResults() {
  const container = document.getElementById('results');
  if (!container) return;

  const filtered =
    activeTab === 'all'
      ? currentResults
      : currentResults.filter((item) => item.intent === activeTab || item.source === activeTab);

  if (!filtered.length) {
    container.innerHTML = '<p class="empty">No queries yet. اضغط Generate عشان تبدأ.</p>';
    return;
  }

  container.innerHTML = filtered
    .map(
      (item) => `
      <div class="result-item">
        <span class="result-query">${item.query}</span>
        <span class="result-pill intent-${item.intent}">${item.intent}</span>
        <span class="result-pill source-${item.source}">${item.source}</span>
      </div>
    `,
    )
    .join('');
}

function setupTabs() {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      activeTab = tab.dataset.tab;
      renderResults();
    });
  });
}

async function getSeedFromContentScript() {
  return new Promise((resolve) => {
    try {
      chrome.tabs &&
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const tab = tabs[0];
          if (!tab || !tab.id) return resolve('');

          chrome.tabs.sendMessage(
            tab.id,
            { type: 'QIT_GET_SEED' },
            (response) => {
              if (chrome.runtime.lastError) {
                logger.warn('Content script unavailable', chrome.runtime.lastError);
                return resolve('');
              }
              resolve((response && response.seed) || '');
            },
          );
        });
    } catch (e) {
      logger.error('Error getting seed from content script', e);
      resolve('');
    }
  });
}

async function handleGenerate() {
  const textarea = document.getElementById('seed-input');
  const aiProvider = document.getElementById('ai-provider');
  if (!textarea || !aiProvider) return;

  let seed = textarea.value.trim();
  if (!seed) {
    seed = await getSeedFromContentScript();
    textarea.value = seed;
  }

  if (!seed) {
    textarea.focus();
    return;
  }

  setLoading(true);

  try {
    const [googleSuggestions, ruleExpansions] = await Promise.all([
      fetchGoogleSuggestions(seed),
      generateQueries(seed, 'ar', 'eg'),
    ]);

    const combined = [
      ...googleSuggestions.map((q) => ({ query: q, source: 'google', seed, locale: 'eg' })),
      ...ruleExpansions,
    ];

    const normalized = normalizeAndDeduplicate(combined);
    currentResults = classifyIntents(normalized);
    renderResults();
  } catch (e) {
    logger.error('Failed to generate queries', e);
  } finally {
    setLoading(false);
  }
}

function handleCopy() {
  if (!currentResults.length) return;
  const text = currentResults.map((item) => item.query).join('\n');
  navigator.clipboard
    .writeText(text)
    .then(() => {
      logger.log('Copied queries to clipboard');
    })
    .catch((e) => logger.error('Clipboard copy failed', e));
}

function handleCSV() {
  if (!currentResults.length) return;
  const csv = exportToCSV(currentResults);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'queries.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function init() {
  document.getElementById('generate-btn')?.addEventListener('click', handleGenerate);
  document.getElementById('copy-btn')?.addEventListener('click', handleCopy);
  document.getElementById('csv-btn')?.addEventListener('click', handleCSV);

  setupTabs();

  // Pre-fill seed from content script if available
  getSeedFromContentScript().then((seed) => {
    if (seed) {
      const textarea = document.getElementById('seed-input');
      if (textarea && !textarea.value) {
        textarea.value = seed;
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
