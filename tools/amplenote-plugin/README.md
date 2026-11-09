# Amplenote repeats export

A personal Amplenote plugin that saves the repeat rule of every open task to a local file. Ignite's import reads that file beside the Amplenote export ZIP, because the ZIP has no repeat rules.

The file holds task uuids and repeat rules only: no titles, no note names. The plugin calls no network API.

## Install

1. Copy the plugin note to the clipboard: `node tools/amplenote-plugin/build-note.mjs | clip`
2. In Amplenote, make a new note called "Ignite repeats export" and paste it in. Search the note for `&gt;` afterwards: there should be none.
3. Go to **Account Settings → Plugins → Add a plugin**, and pick the note under **Select a note**.

The plugin code holds no `<` or `>`, because Amplenote escapes them on paste and the code stops parsing. `tests/tools/build-note.test.js` guards this.

## Run

1. Press **Ctrl+O** (Quick Open), type `Export repeats` and pick **Export repeats for Ignite**. Typing `{` in a note opens the same action from the plugin menu.
2. An alert reports how many open tasks it saved. The file `amplenote-repeats-YYYY-MM-DD.json` lands in Downloads, or the browser asks where to save it.
3. Export the notes ZIP the same day (**Account Settings → Import & Export**), so the two files match.

## Check a real export (counts only)

Replace both paths with your own files:

    node tools/amplenote-plugin/check-join.mjs "$HOME/Downloads/notes.zip" "$HOME/Downloads/amplenote-repeats-2026-11-09.json"

It prints counts and key names only, so the output is safe to share.
