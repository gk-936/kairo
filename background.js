
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

  chrome.contextMenus.create({
    id: 'generateAltText',
    title: 'Generate Alt Text with Chrome AI',
    contexts: ['image']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'summarize' && info.selectionText) {
    handleSummarizeClick(info, tab);
  } else if (info.menuItemId === 'generateAltText' && info.srcUrl) {
    handleGenerateAltTextClick(info, tab);
  }
});

async function handleSummarizeClick(info, tab) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: summarizeAndShowPayload,
      args: [info.selectionText]
    });
  } catch (error) {
    console.error('Failed to inject summarization script:', error);
  }
}

async function handleGenerateAltTextClick(info, tab) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: showPopupPayload,
      args: ['Generating alt text...']
    });

    // The generateAltText function now handles streaming and history
    await generateAltText(info.srcUrl, tab.id);

  } catch (error) {
    console.error('Failed to generate alt text:', error);
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

    const altTexts = [];
    for (const url of imageUrls) {
      try {
        const altText = await getFullAltText(url);
        await addToHistory({ type: 'alt-text', text: altText });
        altTexts.push({ url, altText });
      } catch (error) {
        console.error(`Error generating alt text for ${url}:`, error);
        altTexts.push({ url, altText: `Error: ${error.message}` });
      }
    }
    sendResponse({ type: 'altTextGenerated', altTexts });
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

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: showPopupPayload,
      args: ['Capturing screen...']
    });

    const imageDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    if (!imageDataUrl) {
      throw new Error("Failed to capture the screen.");
    }

    await generateChartNarrative(imageDataUrl, tab.id);

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
async function generateAltText(imageUrl, tabId) {
  try {
    const availability = await LanguageModel.availability();
    if (availability === 'unavailable') {
      throw new Error('The Language Model is not available.');
    }

    const session = await LanguageModel.create({ expectedInputs: [{ type: 'image' }] });
    const imageBlob = await (await fetch(imageUrl)).blob();

    const stream = session.promptStreaming([
      {
        role: 'user',
        content: [
          { type: 'text', value: 'Generate a concise and descriptive alt text for this image. Focus on key visual elements and context.' },
          { type: 'image', value: imageBlob }
        ]
      }
    ]);

    let fullAltText = "";
    for await (const chunk of stream) {
      fullAltText += chunk;
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: showPopupPayload,
        args: [`Alt Text: ${fullAltText}`]
      });
    }

    session.destroy();

    if (!fullAltText) {
      throw new Error("The AI model could not generate alt text.");
    }

    await addToHistory({ type: 'alt-text', text: fullAltText });

  } catch (error) {
    console.error("Error generating alt text:", error);
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: showPopupPayload,
      args: [`Error: ${error.message}`]
    });
  }
}

// This version returns the full text result, used for the popup
async function getFullAltText(imageUrl) {
  try {
    const availability = await LanguageModel.availability();
    if (availability === 'unavailable') {
      throw new Error('The Language Model is not available.');
    }

    const session = await LanguageModel.create({ expectedInputs: [{ type: 'image' }] });
    const imageBlob = await (await fetch(imageUrl)).blob();

    const stream = session.promptStreaming([
      {
        role: 'user',
        content: [
          { type: 'text', value: 'Generate a concise and descriptive alt text for this image. Focus on key visual elements and context.' },
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
        throw new Error("The AI model could not generate alt text.");
    }
    return result;

  } catch (error) {
    console.error("Error generating alt text:", error);
    return `Alt text generation failed: ${error.message}`;
  }
}

async function generateChartNarrative(imageDataUrl, tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: showPopupPayload,
      args: ['Image captured. Analyzing chart...', imageDataUrl]
    });

    const availability = await LanguageModel.availability();
    if (availability === 'unavailable') {
      throw new Error('The Language Model is not available.');
    }

    const session = await LanguageModel.create({ expectedInputs: [{ type: 'image' }] });
    const imageBlob = await (await fetch(imageDataUrl)).blob();

    const prompt = `Analyze the chart or graph in this image and generate a coherent, human-readable narrative explaining its key insights. Identify major trends, outliers, relationships between variables, and statistical conclusions. Provide a descriptive text summary that helps a user understand the story the data is telling.`;

    const stream = session.promptStreaming([
      {
        role: 'user',
        content: [
          { type: 'text', value: prompt },
          { type: 'image', value: imageBlob }
        ]
      }
    ]);

    let fullNarrative = "";
    for await (const chunk of stream) {
      fullNarrative += chunk;
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: showPopupPayload,
        args: [fullNarrative, imageDataUrl]
      });
    }

    session.destroy();

    if (!fullNarrative) {
      throw new Error("The AI model could not generate a narrative.");
    }

    await addToHistory({ type: 'chart-narrative', text: fullNarrative });

  } catch (error) {
    console.error("Error generating chart narrative:", error);
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: showPopupPayload,
      args: [`Error: ${error.message}`]
    });
  }
}


// --- Script Injection Payloads ---

function showPopupPayload(text, imageUrl) {
  let popup = document.getElementById('chrome-ai-summary');
  const title = "Chrome AI Summary";

  if (popup) {
    const contentDiv = popup.querySelector('div.content');
    contentDiv.innerHTML = text;
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
      <div class="content" style="margin-bottom: 12px;">${imageHtml}${text}</div>
      <button onclick="this.parentElement.remove()" style="background: #4285f4; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer;">Close</button>
    `;
    document.body.appendChild(popup);
  }
}

async function summarizeAndShowPayload(text) {
  function showPopup(text) {
    let popup = document.getElementById('chrome-ai-summary');
    const contentDiv = popup ? popup.querySelector('div:nth-child(2)') : null;

    if (popup && contentDiv) {
        contentDiv.innerHTML = text || '<div>Generating summary...</div>';
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
            <div style="margin-bottom: 12px;">${text || '<div>Generating summary...</div>'}</div>
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
