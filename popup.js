document.addEventListener('DOMContentLoaded', () => {
  const statusDiv = document.getElementById('status');
  const simplifyBtn = document.getElementById('simplify');
  const translateBtn = document.getElementById('translate');
  const altTextBtn = document.getElementById('alt-text');
  const chartNarratorBtn = document.getElementById('chart-narrator');
  const ttsBtn = document.getElementById('tts');
  const darkModeToggle = document.getElementById('dark-mode');
  const closePopupBtn = document.getElementById('close-popup');
  const historyList = document.getElementById('history-list');
  const clearHistoryBtn = document.getElementById('clear-history');

  // --- History Functions ---

  function loadHistory() {
    chrome.storage.local.get({ history: [] }, (result) => {
      historyList.innerHTML = '';
      if (result.history.length === 0) {
        historyList.innerHTML = '<p>No history yet.</p>';
        return;
      }
      result.history.forEach(item => {
        const div = document.createElement('div');
        div.className = 'history-item';
        div.textContent = item.text.substring(0, 100) + (item.text.length > 100 ? '...' : '');
        div.title = item.text; // Show full text on hover
        historyList.appendChild(div);
      });
    });
  }

  clearHistoryBtn.addEventListener('click', () => {
    chrome.storage.local.set({ history: [] }, () => {
      loadHistory();
    });
  });

  // Initial load of history
  loadHistory();

  // Request status from background script when popup is opened
  chrome.runtime.sendMessage({ type: 'getStatus' });

  // Listen for messages from the background script
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'statusUpdate') {
      statusDiv.textContent = message.status;
    } else if (message.type === 'altTextGenerated') {
      const altTextResultsDiv = document.getElementById('alt-text-results');
      altTextResultsDiv.innerHTML = ''; // Clear previous results
      if (message.altTexts && message.altTexts.length > 0) {
        message.altTexts.forEach(item => {
          const p = document.createElement('p');
          p.textContent = `Image: ${item.url.substring(0, 50)}... - Alt Text: ${item.altText}`;
          altTextResultsDiv.appendChild(p);
        });
      } else {
        altTextResultsDiv.textContent = 'No images found or alt text generated.';
      }
      loadHistory(); // Reload history after new items are generated
    } else if (message.type === 'altTextError') {
      const altTextResultsDiv = document.getElementById('alt-text-results');
      altTextResultsDiv.textContent = `Error: ${message.error}`;
    }
  });

  // --- Feature Button Listeners (Placeholders) ---

  simplifyBtn.addEventListener('click', () => {
    console.log('Simplify text button clicked');
    // Placeholder for simplify text functionality
  });

  translateBtn.addEventListener('click', () => {
    console.log('Translate & Simplify button clicked');
    // Placeholder for translate & simplify functionality
  });

  altTextBtn.addEventListener('click', () => {
    console.log('Generate Alt Text button clicked');
    const altTextResultsDiv = document.getElementById('alt-text-results');
    altTextResultsDiv.textContent = 'Generating alt text...';
    chrome.runtime.sendMessage({ type: 'generateAltText' });
  });

  chartNarratorBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'generateChartNarrative' });
    window.close(); // Close the popup as the result will be shown on the page
  });

  ttsBtn.addEventListener('click', () => {
    console.log('Text-to-Speech button clicked');
    // Placeholder for TTS functionality
  });

  // --- Dark Mode Toggle ---

  darkModeToggle.addEventListener('change', () => {
    document.body.classList.toggle('dark-mode', darkModeToggle.checked);
  });

  // --- Close Popup Button ---
  closePopupBtn.addEventListener('click', () => {
    window.close(); // Closes the popup window
  });
});