# Mobile Image Text Extractor

A standalone, mobile-friendly page that extracts English text from pictures
with Tesseract.js. No build step or backend is needed.

## Use

Open the GitHub Pages HTTPS link on your phone, choose or take a photo, wait for
recognition, then review and copy the text. Camera options depend on your phone
and browser. Clear photos of printed English text work best.

### Stop and package list

This is a prototype with **one editable text box**, not separate extraction,
review, and final-list sections. Each scan updates that same box automatically.
Check and correct addresses and package IDs directly there. You can also type or
paste stops manually, with an address on the first line, package IDs on following
lines (optionally prefixed with `- `), and a blank line between stops.
Multiple stops in one screenshot are supported.

The parser recognizes common English street suffixes and package rows labeled
`Unknown`, plus standalone IDs beginning with `sp`. Symbols before `Unknown`
are not treated as package counts. Missing/unassigned IDs produce warnings.
Other formats may need manual correction; the parser cannot guarantee that
every package was detected. It never silently corrects the case of package IDs.

Repeated addresses (ignoring case, extra spaces, commas and periods) merge;
identical package IDs at the same stop appear once. New scans read your current
edited text rather than a separate saved list, preserving corrections and manual
additions. Delete stops or IDs directly in the box. **Copy List** copies exactly
what is currently in the box.

If existing text does not follow the list format, it is kept verbatim and new
stops are appended without merging, with a visible warning. If a scan has no
recognized street address, its raw OCR text is appended for manual correction.
Failed or empty scans leave the existing list untouched.

The list is kept in memory in the current tab only, not saved or uploaded.
Copy it before closing or refreshing the page. Clearing the list requires
confirmation. The editor is read-only while a scan runs.

### Live camera package matching

After checking the list, tap **Open Live Camera** and allow camera access.
The rear camera is preferred. Hold the full printed package ID steady in view;
live OCR reads one frame at a time on the device. It reads text, not barcodes.
Matching is exact and case-sensitive, without substring matches or guessing
similar characters. OCR can miss an ID, especially in poor lighting or small print.

Each newly found ID pauses recognition and opens a notice with a large stop
number, the package ID, and **Package n/m** (unique packages found / total at
that stop). Tap **OK - Resume Camera** to resume. Already-found IDs do not trigger
another notice. If multiple IDs are visible, they are handled one at a time
across successive frames, each requiring OK.

The colored progress list below the editor turns a stop green and labels it
**Complete** only when all its packages have been found. Explicit numbers such
as `7.` in the editor are used as stop numbers; otherwise list order is used.
Duplicate stop numbers and IDs assigned to multiple stops must be fixed before
opening the camera. Duplicate IDs within a stop count once.

Stop the camera to edit the list or import screenshots. Progress follows exact
package IDs across edits, and adding a package makes a completed stop incomplete
until that new ID is found. **Reset Found Packages** clears progress, not the
list. **Clear** clears both. Neither the list nor progress survives a reload.
Camera access requires HTTPS (or localhost during development). Frames are not
uploaded. **Stop Camera**, leaving the page, or backgrounding it releases camera
tracks; returning to the page requires opening the camera again.

Photos are processed locally in your browser, not uploaded. The page downloads
Tesseract.js 5.1.1, its WebAssembly engine, and English language data from external
CDNs. Internet access is required, especially on first use. Large pictures can
take longer or exceed memory on older phones. OCR is not guaranteed to be accurate.

Clipboard access requires HTTPS and browser permission. If copying is blocked,
the page selects the text so you can copy it manually.

## Preview locally

Run `python3 -m http.server 8080 --bind 127.0.0.1` in this directory and open
`http://localhost:8080`. Stop the server with Ctrl+C.

Run parser, matching, and camera lifecycle tests with
`node --test stops.test.mjs packages.test.mjs live-camera.test.mjs`.

## Publish

In the repository's **Settings > Pages**, choose **Deploy from a branch**,
select **main** and **/ (root)**, and save. Only this standalone directory
belongs in the public repository.
