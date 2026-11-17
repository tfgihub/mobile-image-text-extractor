# Mobile Image Text Extractor

A standalone, mobile-friendly page that extracts English text from pictures
with Tesseract.js. No build step or backend is needed.

## Use

Open the GitHub Pages HTTPS link on your phone, choose or take a photo, wait for
recognition, then review and copy the text. Camera options depend on your phone
and browser. Clear photos of printed English text work best.

Photos are processed locally in your browser, not uploaded. The page downloads
Tesseract.js 5.1.1, its WebAssembly engine, and English language data from external
CDNs. Internet access is required, especially on first use. Large pictures can
take longer or exceed memory on older phones. OCR is not guaranteed to be accurate.

Clipboard access requires HTTPS and browser permission. If copying is blocked,
the page selects the text so you can copy it manually.

## Preview locally

Run `python3 -m http.server 8080 --bind 127.0.0.1` in this directory and open
`http://localhost:8080`. Stop the server with Ctrl+C.

## Publish

In the repository's **Settings > Pages**, choose **Deploy from a branch**,
select **main** and **/ (root)**, and save. Only this standalone directory
belongs in the public repository.
