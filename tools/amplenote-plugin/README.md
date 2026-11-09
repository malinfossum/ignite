# Amplenote repeats export

A personal Amplenote plugin that saves the repeat rule of every open task to a local file. Ignite's import reads that file beside the Amplenote export ZIP, because the ZIP has no repeat rules.

The file holds task uuids and repeat rules only: no titles, no note names. The plugin calls no network API.

## Install

1. Run `node tools/amplenote-plugin/build-note.mjs` and copy its output.
2. In Amplenote, make a new note called "Ignite repeats export" and paste the output into it.
3. Open the note's menu and choose **Install plugin**.

## Run

Run "Export repeats for Ignite" from Amplenote's app options (the plugin's `appOption`). Gate G1 in the plan confirms where it shows up on my account. Amplenote saves `amplenote-repeats-YYYY-MM-DD.json` to your downloads folder, or asks where to save it.

Run it on the same day as the ZIP export, so the two files match.

## Check a real export (counts only)

    node tools/amplenote-plugin/check-join.mjs <export.zip> <amplenote-repeats-….json>

It prints counts and key names only, so the output is safe to share.
