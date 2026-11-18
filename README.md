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

Photos are processed locally in your browser, not uploaded. The page downloads
Tesseract.js 5.1.1, its WebAssembly engine, and English language data from external
CDNs. Internet access is required, especially on first use. Large pictures can
take longer or exceed memory on older phones. OCR is not guaranteed to be accurate.

Clipboard access requires HTTPS and browser permission. If copying is blocked,
the page selects the text so you can copy it manually.

## Preview locally

Run `python3 -m http.server 8080 --bind 127.0.0.1` in this directory and open
`http://localhost:8080`. Stop the server with Ctrl+C.

Run parser tests with `node --test stops.test.mjs`.

## Publish

In the repository's **Settings > Pages**, choose **Deploy from a branch**,
select **main** and **/ (root)**, and save. Only this standalone directory
belongs in the public repository.
