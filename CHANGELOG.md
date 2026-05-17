# Changelog

## 0.0.3

### New

- File search settings: `vscope.files.showHidden`, `vscope.files.respectGitignore`, `vscope.files.exclude`, `vscope.files.maxResults`
- Custom fzf binary path: `vscope.fzf.path`
- Warning notification when the configured fzf binary is not found

### Performance

- Native rg→fzf process pipeline per query — no in-memory file list, lower memory use on large repos
- Counter updates debounced during streaming to reduce UI churn

### Improvements

- No-flicker search transitions: previous results stay visible while a new query runs, with a loading indicator
- Directory portion of file paths displays with the OS-native separator (backslash on Windows)
- Fuzzy match highlights now prefer the filename over the directory path
- Selection highlight dims to inactive style when the VS Code window loses focus

### Marketplace

- New extension icon
- Updated display name and description for better discoverability

### Breaking changes

- Commands renamed to follow VS Code conventions: `vscope.search` → `vscope.findFiles`, `vscope.grep` → `vscope.liveGrep`

### Fixes

- `vscope.files` settings now respected by the VS Code API fallback (when rg is unavailable)
- rg stderr drained to prevent rare process stall on large repos with restricted directories
- Null guard added on workspace folders in the file-open handler

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
