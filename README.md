# Mobile Image Text Extractor

A standalone, mobile-friendly page that extracts English text from pictures
with Tesseract.js. No build step or backend is needed.

## Use

Open the GitHub Pages HTTPS link on your phone, choose or take a photo, wait for
recognition, then review and copy the text. Camera options depend on your phone
and browser. Clear photos of printed English text work best.

### Stop and package list

Each scan creates an editable draft grouping street addresses with package IDs.
Review every address and ID, enter missing IDs one per line, and tap **Add Reviewed
Stops to List**. Scan more screenshots to extend the list, or paste OCR text and
tap **Review Stops from Text**. Multiple stops in one screenshot are supported.
Use **Add a Stop Manually** for an address the parser does not recognize.

The parser recognizes common English street suffixes and package rows labeled
`Unknown`, plus standalone IDs beginning with `sp`. Symbols before `Unknown`
are not treated as package counts. Missing/unassigned IDs produce warnings.
Other formats may need manual correction; the parser cannot guarantee that
every package was detected. It never silently corrects the case of package IDs.

Repeated addresses (ignoring case, extra spaces, commas and periods) merge;
identical package IDs at the same stop are counted once. Remove an incorrect
saved stop and add a corrected draft. **Copy Stop List** copies numbered
addresses with their package counts and IDs.

The list is kept in memory in the current tab only, not saved or uploaded.
Copy it before closing or refreshing the page. Clearing the list and replacing
unadded drafts require confirmation.

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
