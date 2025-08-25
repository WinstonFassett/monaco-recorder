# Monaco Recorder

A lightweight, framework-agnostic library for recording and replaying user interactions in Monaco Editor. Capture typing, selections, cursor movements, and autocomplete interactions to create demos, tutorials, or reproduce bugs.

## Features

- 🎥 **Record & Replay** - Capture all user interactions and play them back with timing control
- 🚀 **Zero Build** - Pure ES modules, no build step required
- 📦 **Framework Agnostic** - Works with React, Vue, Angular, or vanilla JavaScript
- ⚡ **Lightweight** - No dependencies beyond Monaco Editor
- 🎯 **TypeScript Support** - Full type definitions included
- 🔧 **Configurable** - Control what events to capture and playback speed
- 📋 **Serializable** - Save and load recordings as JSON

## Demo

🔗 [Live Demos](https://WinstonFassett.github.io/monaco-recorder/)

## Installation

```bash
npm install monaco-recorder
```

## Quick Start

### ES Modules (Recommended)

```javascript
import createMonacoRecorder from 'monaco-recorder';

// Assuming you have monaco and editor instances
const recorder = createMonacoRecorder(editor, monaco);

// Start recording
const stopRecording = recorder.start();

// Stop and get events
const events = stopRecording();

// Play back the recording
recorder.play(events, {
  speed: 200,        // 200% speed
  minDelayMs: 0,     // Min delay between events
  maxDelayMs: 1000,  // Max delay between events
  onProgress: (current, total) => console.log(`${current}/${total}`),
  onDone: () => console.log('Playback complete')
});
```

### Separate Recording and Playback

```javascript
import { createRecorder, createPlayback, serializeEvents, deserializeEvents } from 'monaco-recorder';

// Recording only
const recorder = createRecorder(editor, monaco, {
  captureSelection: true,
  captureKeys: false,
  captureSuggest: true
});

const stopRecording = recorder.start();
// ... user interactions ...
const events = stopRecording();

// Serialize for storage/transmission
const json = serializeEvents(events);

// Later, load and play back
const loadedEvents = deserializeEvents(json);
const playback = createPlayback(editor, monaco);
playback.play(loadedEvents);
```

## API Reference

### `createMonacoRecorder(editor, monaco, options?)`

Creates a combined recorder/player instance.

**Parameters:**
- `editor` - Monaco editor instance
- `monaco` - Monaco library instance  
- `options` - Recording configuration (optional)

**Returns:** `RecorderAPI`

### `createRecorder(editor, monaco, options?)`

Creates a recording-only instance.

**Returns:** `{ start, stop, getEvents }`

### `createPlayback(editor, monaco, options?)`

Creates a playback-only instance.

**Returns:** `{ play, stopPlayback }`

### Recording Options

```typescript
interface RecorderOptions {
  captureSelection?: boolean;  // Record cursor selections (default: true)
  captureKeys?: boolean;       // Record key presses (default: false) 
  captureSuggest?: boolean;    // Record autocomplete interactions (default: true)
}
```

### Playback Options

```typescript
interface PlayOptions {
  speed?: number;              // Playback speed % (default: 100)
  minDelayMs?: number;         // Minimum delay between events (default: 0)
  maxDelayMs?: number;         // Maximum delay between events (default: 1000)
  onProgress?: (current: number, total: number, event: RecorderEvent) => void;
  onDone?: () => void;
}
```

### Event Types

The library captures these interaction types:

- `initialState` - Editor content and cursor position at recording start
- `contentChange` - Text modifications  
- `cursorPosition` - Cursor movements
- `cursorSelection` - Text selections
- `keyDown` - Key press events (when enabled)
- `suggestShow/Hide` - Autocomplete menu visibility
- `suggestFocus` - Autocomplete item focus changes

## Usage Examples

### React Integration

```jsx
import React, { useRef, useEffect, useState } from 'react';
import * as monaco from 'monaco-editor';
import createMonacoRecorder from 'monaco-recorder';

function CodeEditor() {
  const containerRef = useRef();
  const editorRef = useRef();
  const recorderRef = useRef();
  const [recording, setRecording] = useState([]);

  useEffect(() => {
    const editor = monaco.editor.create(containerRef.current, {
      value: 'console.log("Hello World");',
      language: 'javascript'
    });
    
    editorRef.current = editor;
    recorderRef.current = createMonacoRecorder(editor, monaco);
    
    return () => editor.dispose();
  }, []);

  const startRecording = () => {
    const stop = recorderRef.current.start();
    // Store stop function to call later
  };

  const playRecording = () => {
    recorderRef.current.play(recording, { speed: 150 });
  };

  return (
    <div>
      <button onClick={startRecording}>Record</button>
      <button onClick={playRecording}>Play</button>
      <div ref={containerRef} style={{ height: 400 }} />
    </div>
  );
}
```

### Vanilla JavaScript

```html
<!DOCTYPE html>
<html>
<head>
  <script src="https://unpkg.com/monaco-editor@0.45.0/min/vs/loader.js"></script>
</head>
<body>
  <div id="editor"></div>
  
  <script type="module">
    import createMonacoRecorder from './node_modules/monaco-recorder/monaco-recorder.js';
    
    require.config({ paths: { vs: 'https://unpkg.com/monaco-editor@0.45.0/min/vs' }});
    require(['vs/editor/editor.main'], () => {
      const editor = monaco.editor.create(document.getElementById('editor'), {
        value: 'function hello() {\n  console.log("Hello world!");\n}',
        language: 'javascript'
      });
      
      const recorder = createMonacoRecorder(editor, monaco);
      
      // Example: Record for 10 seconds then play back
      const stop = recorder.start();
      setTimeout(() => {
        const events = stop();
        recorder.play(events);
      }, 10000);
    });
  </script>
</body>
</html>
```

### Advanced Usage

```javascript
// Custom recording with specific options
const recorder = createMonacoRecorder(editor, monaco, {
  captureSelection: true,
  captureKeys: true,      // Include key presses
  captureSuggest: false   // Skip autocomplete events
});

// Record with progress tracking
const stop = recorder.start();
// ... interactions ...
const events = stop();

// Play with custom timing
recorder.play(events, {
  speed: 300,           // 3x speed
  minDelayMs: 50,       // Always wait at least 50ms
  maxDelayMs: 500,      // Never wait more than 500ms
  onProgress: (i, total, event) => {
    console.log(`Event ${i}/${total}: ${event.type}`);
    updateProgressBar(i / total);
  },
  onDone: () => {
    console.log('Replay finished!');
    showCompletionMessage();
  }
});
```

## Browser Support

- Chrome/Edge 63+
- Firefox 60+ 
- Safari 13.1+
- Any browser that supports ES modules and Monaco Editor

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes
4. Test with the demos: `npm run demo`
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Related

- [Monaco Editor](https://microsoft.github.io/monaco-editor/) - The code editor that powers VS Code