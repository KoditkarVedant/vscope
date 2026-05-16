# VScope

Fuzzy file search and live grep for VS Code, powered by [fzf](https://github.com/junegunn/fzf) and [ripgrep](https://github.com/BurntSushi/ripgrep). Inspired by [Telescope.nvim](https://github.com/nvim-telescope/telescope.nvim).

## Features

- **Fuzzy file search** — find files by name across your workspace with fzf ranking
- **Live grep** — search file contents with ripgrep as you type
- **Syntax-highlighted preview** — renders the selected file using your active VS Code theme
- **Split panel UI** — resizable file list and preview pane, draggable divider
- **Virtualized list** — handles large workspaces without slowdown

## Requirements

- [`fzf`](https://github.com/junegunn/fzf#installation) on your PATH (used for file name fuzzy matching)
- [`ripgrep`](https://github.com/BurntSushi/ripgrep#installation) — bundled with VS Code; a system install is used as fallback

## Usage

| Action | Keybinding |
|---|---|
| Open file search | `alt+; f` |
| Open live grep | `alt+; g` |
| Move selection down / up | `ctrl+n` / `ctrl+p` |
| Scroll preview down / up | `ctrl+d` / `ctrl+u` |
| Scroll preview left / right | `ctrl+f` / `ctrl+k` |
| Zoom file list / preview pane | `alt+,` / `alt+.` |
| Open selected file | `Enter` or double-click |
| Close | `Escape` |

Switch between file search and grep with the **files** / **grep** button or by pressing `Escape` when a pane is zoomed.

## Customizing Keybindings

All keybindings can be rebound via VS Code's keybindings editor:

1. Open the editor with `Ctrl+K Ctrl+S` (macOS: `Cmd+K Cmd+S`)
2. Search for `vscope`
3. Click the pencil icon next to any binding and press your preferred key combination

The in-panel navigation keys (`ctrl+n`, `ctrl+p`, etc.) only fire while VScope is open — they won't interfere with your normal editor bindings.
