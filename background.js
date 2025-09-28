

let modelStatus = 'Checking...';

// --- History Management ---

async function addToHistory(item) {
  const { history = [] } = await chrome.storage.local.get('history');
  history.unshift(item); // Add to the beginning
  if (history.length > 20) {
    history.pop();
  }
  await chrome.storage.local.set({ history });
}

// --- Context Menu Setup and Handlers ---

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'summarize',
    title: 'Summarize with Chrome AI',
    contexts: ['selection']
  });

  // Consolidated menu item for all image analysis
  chrome.contextMenus.create({
    id: 'analyzeImage',
    title: 'Analyze Image with AI',
    contexts: ['image']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'summarize' && info.selectionText) {
    handleSummarizeClick(info, tab);
  } else if (info.menuItemId === 'analyzeImage' && info.srcUrl) {
    handleAnalyzeImageClick(info, tab);
  }
});

async function handleSummarizeClick(info, tab) {
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['marked.min.js'] });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: summarizeAndShowPayload,
      args: [info.selectionText]
    });
  } catch (error) {
    console.error('Failed to inject summarization script:', error);
  }
}

async function handleAnalyzeImageClick(info, tab) {
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['marked.min.js'] });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: showPopupPayload,
      args: ['Analyzing image...', info.srcUrl]
    });

    await analyzeImage(info.srcUrl, tab.id);

  } catch (error) {
    console.error('Failed to analyze image:', error);
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: showPopupPayload,
      args: [`Error: ${error.message}`]
    });
  }
}

// --- Message Listeners from Popup and Content Scripts ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'getStatus') {
    chrome.runtime.sendMessage({ type: 'statusUpdate', status: modelStatus });
  } else if (message.type === 'generateAltText') {
    handleGenerateAltTextFromPopup(sender.tab, sendResponse);
    return true; 
  } else if (message.type === 'addToHistory') {
    addToHistory(message.item);
  } else if (message.type === 'generateChartNarrative') {
    handleGenerateChartNarrative();
  }
});

async function handleGenerateAltTextFromPopup(tab, sendResponse) {
  try {
    const injectionResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => Array.from(document.querySelectorAll('img')).map(img => img.src)
    });

    if (!injectionResults || !injectionResults[0] || !injectionResults[0].result) {
      throw new Error("Could not get image URLs from the page.");
    }

    const imageUrls = injectionResults[0].result;
    if (imageUrls.length === 0) {
      sendResponse({ type: 'altTextError', error: "No images found on the page." });
      return;
    }

    const results = [];
    for (const url of imageUrls) {
      try {
        const analysis = await getFullImageAnalysis(url);
        await addToHistory({ type: 'image-analysis', text: analysis });
        results.push({ url, altText: analysis });
      } catch (error) {
        console.error(`Error analyzing image for ${url}:`, error);
        results.push({ url, altText: `Error: ${error.message}` });
      }
    }
    sendResponse({ type: 'altTextGenerated', altTexts: results });
  } catch (error) {
    console.error('Failed to inject script or get image URLs:', error);
    sendResponse({ type: 'altTextError', error: error.message });
  }
}

async function handleGenerateChartNarrative() {
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      throw new Error("Could not find an active tab to capture.");
    }

    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['marked.min.js'] });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: showPopupPayload,
      args: ['Capturing screen...']
    });

    const imageDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    if (!imageDataUrl) {
      throw new Error("Failed to capture the screen.");
    }

    await analyzeImage(imageDataUrl, tab.id, true);

  } catch (error) {
    console.error('Failed to generate chart narrative:', error);
    if (tab && tab.id) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: showPopupPayload,
        args: [`Error: ${error.message}`]
      });
    }
  }
}

// --- AI Generation Functions ---

// This version streams the result to a UI popup
async function analyzeImage(imageUrl, tabId, isScreenshot = false) {
  try {
    if (isScreenshot) {
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: showPopupPayload,
            args: ['Image captured. Analyzing...', imageUrl]
        });
    }

    const availability = await LanguageModel.availability();
    if (availability === 'unavailable') {
      throw new Error('The Language Model is not available.');
    }

    const session = await LanguageModel.create({ expectedInputs: [{ type: 'image' }] });
    const imageBlob = await (await fetch(imageUrl)).blob();

    const prompt = `Analyze the following image. First, determine if it is a data visualization (like a chart or graph) or a general photograph/picture.
- If it is a data visualization, provide a detailed narrative explaining its key insights. Identify major trends, outliers, and the story the data is telling.
- If it is a general photograph or picture, generate a concise and descriptive alt text for it.
Provide only the resulting narrative or the alt text.`;

    const stream = session.promptStreaming([
      {
        role: 'user',
        content: [
          { type: 'text', value: prompt },
          { type: 'image', value: imageBlob }
        ]
      }
    ]);

    let fullAnalysis = "";
    for await (const chunk of stream) {
      fullAnalysis += chunk;
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: showPopupPayload,
        args: [fullAnalysis, imageUrl]
      });
    }

    session.destroy();

    if (!fullAnalysis) {
      throw new Error("The AI model could not analyze the image.");
    }

    await addToHistory({ type: 'image-analysis', text: fullAnalysis });

  } catch (error) {
    console.error("Error analyzing image:", error);
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: showPopupPayload,
      args: [`Error: ${error.message}`]
    });
  }
}

// This version returns the full text result
async function getFullImageAnalysis(imageUrl) {
  try {
    const availability = await LanguageModel.availability();
    if (availability === 'unavailable') {
      throw new Error('The Language Model is not available.');
    }

    const session = await LanguageModel.create({ expectedInputs: [{ type: 'image' }] });
    const imageBlob = await (await fetch(imageUrl)).blob();

    const prompt = `Analyze the following image. First, determine if it is a data visualization (like a chart or graph) or a general photograph/picture.
- If it is a data visualization, provide a detailed narrative explaining its key insights. Identify major trends, outliers, and the story the data is telling.
- If it is a general photograph or picture, generate a concise and descriptive alt text for it.
Provide only the resulting narrative or the alt text.`;

    const stream = session.promptStreaming([
      {
        role: 'user',
        content: [
          { type: 'text', value: prompt },
          { type: 'image', value: imageBlob }
        ]
      }
    ]);

    let result = "";
    for await (const chunk of stream) {
      result += chunk;
    }

    session.destroy();
    
    if (!result) {
        throw new Error("The AI model could not analyze the image.");
    }
    return result;

  } catch (error) {
    console.error("Error analyzing image:", error);
    return `Image analysis failed: ${error.message}`;
  }
}

// --- Script Injection Payloads ---

function showPopupPayload(text, imageUrl) {
  let popup = document.getElementById('chrome-ai-summary');
  const title = "Chrome AI Summary";

  const contentHtml = text ? marked.parse(text) : '';

  if (popup) {
    const contentDiv = popup.querySelector('div.content');
    contentDiv.innerHTML = contentHtml;
    if (imageUrl) {
      let img = popup.querySelector('img');
      if (!img) {
        img = document.createElement('img');
        contentDiv.prepend(img);
      }
      img.src = imageUrl;
      img.style.cssText = 'max-width: 100%; max-height: 200px; margin-bottom: 10px;';
    } else {
      const img = popup.querySelector('img');
      if (img) img.remove();
    }
  } else {
    popup = document.createElement('div');
    popup.id = 'chrome-ai-summary';
    popup.style.cssText = `
      position: fixed; top: 20px; right: 20px; max-width: 400px;
      background: white; border: 2px solid #4285f4; border-radius: 8px;
      padding: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 10000;
      font-family: Arial, sans-serif; font-size: 14px; line-height: 1.4;
    `;
    const imageHtml = imageUrl ? `<img src="${imageUrl}" style="max-width: 100%; max-height: 200px; margin-bottom: 10px;" />` : '';
    popup.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 8px; color: #4285f4;">${title}</div>
      <div class="content" style="max-height: 300px; overflow-y: auto; margin-bottom: 12px;">${imageHtml}${contentHtml}</div>
      <button onclick="this.parentElement.remove()" style="background: #4285f4; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer;">Close</button>
    `;
    document.body.appendChild(popup);
  }
}

async function summarizeAndShowPayload(text) {
  function showPopup(text) {
    let popup = document.getElementById('chrome-ai-summary');
    const contentDiv = popup ? popup.querySelector('div.content') : null;

    const contentHtml = text ? marked.parse(text) : '<div>Generating summary...</div>';

    if (popup && contentDiv) {
        contentDiv.innerHTML = contentHtml;
    } else {
        popup = document.createElement('div');
        popup.id = 'chrome-ai-summary';
        popup.style.cssText = `
            position: fixed; top: 20px; right: 20px; max-width: 400px;
            background: white; border: 2px solid #4285f4; border-radius: 8px;
            padding: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 10000;
            font-family: Arial, sans-serif; font-size: 14px; line-height: 1.4;
        `;
        popup.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 8px; color: #4285f4;">Chrome AI Summary</div>
            <div class="content" style="max-height: 300px; overflow-y: auto; margin-bottom: 12px;">${contentHtml}</div>
            <button onclick="this.parentElement.remove()" style="background: #4285f4; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer;">Close</button>
        `;
        document.body.appendChild(popup);
    }
  }

  try {
    if (typeof Summarizer === 'undefined') {
      throw new Error('Summarizer API not available');
    }

    const availability = await Summarizer.availability();
    if (availability === 'unavailable') {
      throw new Error('Summarizer not available. Enable at chrome://settings/ai');
    }

    const summarizerOptions = {
      type: 'key-points',
      format: 'plain-text',
      length: 'medium',
    };

    if (availability === 'downloadable') {
      showPopup('Downloading summarizer model...');
      summarizerOptions.monitor = (m) => {
        m.addEventListener('downloadprogress', (e) => {
          const percentage = Math.round((e.loaded / e.total) * 100);
          showPopup(`Downloading summarizer model... ${percentage}%`);
        });
      };
    }

    const summarizer = await Summarizer.create(summarizerOptions);
    const stream = summarizer.summarizeStreaming(text);
    
    let fullSummary = "";
    showPopup(""); // This will show "Generating summary..."
    for await (const chunk of stream) {
      fullSummary += chunk;
      showPopup(fullSummary);
    }
    summarizer.destroy();

    if (!fullSummary) {
      throw new Error("The AI model could not generate a summary.");
    }

    // Add the completed summary to history
    chrome.runtime.sendMessage({ type: 'addToHistory', item: { type: 'summary', text: fullSummary } });

  } catch (error) {
    showPopup('Error: ' + error.message);
  }
}
