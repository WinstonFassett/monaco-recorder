# Monaco Recorder Demos

This directory contains demo recordings for the Monaco Recorder library. The demo system allows you to create, manage, and play back recordings of Monaco editor interactions.

## Directory Structure

```
recordings/
├── demo-host.html     # Main demo host application
├── samples/           # Sample recordings
│   ├── basic-usage.json
│   └── react-integration.json
└── README.md         # This file
```

## Recording Format

Recordings are stored as JSON files with an array of events. Each event has the following structure:

```typescript
interface RecordingEvent {
  type: 'typing' | 'selection' | 'content' | 'suggestion';
  timestamp: number;  // Milliseconds since start
  // Additional properties based on event type
}
```

### Event Types

1. **typing**: Represents text input
   ```typescript
   {
     type: 'typing';
     timestamp: number;
     text: string;           // The text that was typed
     position: {
       lineNumber: number;
       column: number;
     };
     replacePrevious?: boolean; // If true, replaces text before position
   }
   ```

2. **selection**: Represents text selection
   ```typescript
   {
     type: 'selection';
     timestamp: number;
     selection: {
       startLineNumber: number;
       startColumn: number;
       endLineNumber: number;
       endColumn: number;
     }
   }
   ```

3. **content**: Sets the entire editor content
   ```typescript
   {
     type: 'content';
     timestamp: number;
     content: string;  // The full editor content
   }
   ```

4. **suggestion**: Represents autocomplete selection
   ```typescript
   {
     type: 'suggestion';
     timestamp: number;
     suggestion: string;  // The selected suggestion
     position: {
       lineNumber: number;
       column: number;
     }
   }
   ```

## Creating a New Demo

1. Create a new JSON file in the `samples` directory
2. Add your recording events following the format above
3. Update `demo-host.html` to include your new demo in the `DEMOS` array:

```javascript
{
  id: 'your-demo-id',
  title: 'Your Demo Title',
  description: 'Brief description of the demo',
  recording: 'samples/your-demo.json',
  code: '// Initial code to display\nconst example = "Hello, World!";',
  language: 'javascript'  // or 'typescript', etc.
}
```

## Playing Demos

1. Open `demo-host.html` in a web server
2. Select a demo from the list
3. Use the playback controls to play/pause/stop the recording
4. Adjust playback speed as needed

## Tips for Creating Recordings

- Keep recordings short and focused (30-60 seconds)
- Start with a clear comment explaining what the demo shows
- Use realistic typing speeds (add appropriate delays between events)
- Include examples of different interaction types (typing, selecting, autocomplete)
- Test your recording at different playback speeds

## Example Recording

Here's a simple example of a recording that types a function and shows autocomplete:

```json
[
  {
    "type": "content",
    "timestamp": 0,
    "content": "// Example function\nfunction greet(name) {\n  return 'Hello, ' + name;\n}"
  },
  {
    "type": "typing",
    "timestamp": 1000,
    "text": "\n\n// Call the function\nconst message = greet(",
    "position": {
      "lineNumber": 4,
      "column": 1
    }
  },
  {
    "type": "suggestion",
    "timestamp": 1500,
    "suggestion": "World",
    "position": {
      "lineNumber": 5,
      "column": 25
    }
  },
  {
    "type": "typing",
    "timestamp": 2000,
    "text": "World")",
    "position": {
      "lineNumber": 5,
      "column": 25
    }
  },
  {
    "type": "typing",
    "timestamp": 2500,
    "text": ";\n\nconsole.log(message);",
    "position": {
      "lineNumber": 5,
      "column": 30
    }
  }
]
```
