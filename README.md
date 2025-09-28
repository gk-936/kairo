# Chrome AI Summarizer

A minimal Chrome extension that uses Chrome's built-in AI to summarize selected text.

## Installation

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked" and select this folder
4. Enable Chrome AI features:
   - Go to `chrome://settings/ai` and enable AI features
   - Or go to `chrome://flags/` and enable:
     - `#prompt-api-for-gemini-nano`
     - `#optimization-guide-on-device-model`
   - Restart Chrome

## Usage

1. Select any text on a webpage
2. Right-click and choose "Summarize with Chrome AI"
3. View the summary in the popup that appears

## Requirements

- Chrome 138+ stable (or Chrome Canary/Dev)
- Chrome AI features enabled at chrome://settings/ai
- At least 22 GB free storage space
- GPU with more than 4 GB VRAM
- Gemini Nano model downloaded (happens automatically)

## Testing

1. Go to any news article or long text
2. Select a paragraph or section
3. Right-click → "Summarize with Chrome AI"
4. Check if summary appears in top-right popup