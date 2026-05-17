# Changelog

## 0.0.2

- Reduced `.vsix` size from 4.1 MB to ~900 KB by bundling only the 89 language grammars VScope uses and referencing the demo GIF via GitHub URL

## 0.0.1

- Initial release
- Fuzzy file search powered by fzf
- Live grep powered by ripgrep
- Syntax-highlighted preview using your active VS Code theme
- Resizable split panel with virtualized file list
- Keybindings: `alt+; f` to open file search, `alt+; g` to open grep (chord-based, no conflicts on any platform)
- Fixed shell injection vulnerability in fzf spawn on Windows
- Fixed ripgrep not found when VS Code is launched from Finder/Spotlight on macOS
