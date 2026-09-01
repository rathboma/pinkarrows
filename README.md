# escribo: An Open-Source Web-Based Skitch Alternative

escribo (formerly Pink Arrows) is a lightweight annotation tool for screenshots. It runs as a desktop app on Linux, macOS and Windows, and as a web app at [pinkarrows.app](https://pinkarrows.app) with no installation required.

Everything runs locally — nothing is stored server-side. It heavily uses [Fabric JS](http://fabricjs.com/).

![escribo in Action](assets/readme_gif.gif)

I really loved Skitch. In fact, the pink Skitch arrows and dumbed-down text became a trademark of mine in multiple jobs. In a sea of text on Slack and email, Skitch annotations are a refreshing way to make a single, obvious, and easy to digest point. Since Skitch shut down, I've looked for multiple alternatives that are: Free-ish, have similar styling, and are lightweight (no signin, no server syncing). I didn't find any, and that's how this was born.

## Features

- **Annotate** with arrows, boxes, a highlighter, text labels and emoji
- **Crop** to the part of the screenshot that matters
- **Backdrops** — frame the shot on a solid colour or gradient with adjustable padding
- **Copy to clipboard** or save to disk, at the screenshot's full resolution
- Editable six-colour palette, light and dark themes

### Hotkeys

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| `S` | Select | `Ctrl+C` | Copy image to clipboard |
| `A` | Arrow | `Ctrl+S` | Save to disk |
| `R` | Box | `Ctrl+V` | Paste an image |
| `H` | Highlighter | `Ctrl+Z` | Undo |
| `T` | Text | `Ctrl+Shift+Z` | Redo |
| `E` | Emoji | `Ctrl+D` | Duplicate selection |
| `C` | Crop | `Ctrl+,` | Preferences |

## Running the desktop app

```bash
yarn install
yarn start
```

The app lives in the system tray. It opens an annotation window automatically when a new screenshot lands in your `Pictures/Screenshots` folder, and the tray menu can also open a file or paste from the clipboard.

## Contributing

Easiest way to contribute is to toss ideas and features in Github Issues.

If you'd like to contribute with code:

1. Clone the repository:
```bash
git clone https://github.com/rathboma/pinkarrows.git
```

2. Run a simple http server:
```bash
cd pinkarrows
python3 -m http.server
```

3. Open your browser and go to http://localhost:8000 to start using escribo locally

## Roadmap / feature requests
- [ ] Hotkey tooltips
- [ ] Improve arrow dragging
- [ ] Line feature (not an arrow, just a line)
