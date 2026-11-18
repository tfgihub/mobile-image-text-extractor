# Stops & Packages prototype

A mobile browser prototype with two steps. No build step, backend, or image
upload service is required.

## 1. Upload and check the package list

Select multiple screenshots together. They are read sequentially with one OCR
worker. The importer supports:

- Customer/recipient rows with a `#` reference and following `Package ID` rows.
  The code may be on the next line, including all-letter four-character codes.
- Street-address stops with `Unknown` package rows and longer package IDs.

Small screenshots are enlarged for OCR. Repeated customer references merge even
when names are redacted; street stops merge ignoring case, spacing, commas, and
periods. Identical IDs are not duplicated. Four-character codes are normalized
to uppercase, and short/full forms of the same ID at one stop count once.
Conflicting assignments of the same package to different stops are reported and
are not added a second time. Clipped package rows and IDs before a stop heading
produce import notes rather than being silently assigned.

Review the one editable text box. Use a stop/customer heading followed by IDs,
one per line, and leave a blank line between stops. Check OCR carefully: names,
reference numbers, and 0/O can be misread. The importer does not guess redacted
or unreadable content. `#` references are not interpreted as route stop numbers.
Screenshot checkmarks do not mark packages as found in this prototype.

Failed or unrecognized screenshots leave the existing list intact. Other files
in the batch are still processed. Invalid editor formatting blocks further
imports until fixed. **Copy List** copies the current editor exactly.

## 2. Scan and group packages

Tap **Next: Group Packages**, then **Open Live Camera** and allow camera access.
The rear camera is preferred. Show one entire label at a time.

**Package identity comes from Data Matrix / QR decoding, not printed-ID OCR.**
The app uses ZXing-C++ WebAssembly, including on browsers without native barcode
detection. It first matches a decoded full ID; otherwise its last four characters
must uniquely identify a listed ID. Matching ignores letter case, but never
substitutes Q/O/0 or guesses other characters.

The barcode scan loop does not run OCR. Once a known code is decoded, it pauses
and immediately displays the large stop number and decoded code. OCR then reads
only the bag count from that same frozen frame. The barcode does not itself
contain `n of m bags`.

Check or enter **Bag number** and **Total bags**. Nothing counts until you tap
**Confirm & Resume**. **Rescan - Don't Count** dismisses the notice without
changing progress. Invalid, repeated-position, and conflicting-total entries
are rejected. Already-confirmed packages never count twice.

Unknown codes, unsupported payloads, ambiguous matches, and multiple labels
produce **Check this package** notices without modifying the list or progress.
The same unknown reading is shown once per camera session to avoid a popup loop.

Progress cards turn green only after all numbered bag positions and all listed
IDs at that stop are confirmed. Bags 1 and 3 of 3 mean 2/3 found, not complete.
Currently one consistent bag group per stop is supported. Explicit editor
numbers such as `7.` are preserved for camera notices; otherwise list order is
used. Screenshot imports number stops in their first-seen order.

Stop the camera to go back and edit/import more screenshots. Progress follows
listed IDs across edits. **Reset Found Packages** keeps the list; **Clear**
clears both. Camera tracks are released on Stop, navigation away, or moving the
page to the background. Returning requires opening the camera again.

## Privacy and limitations

All images, decoded IDs, OCR, and progress remain in the browser. Internet is
required to download Tesseract.js 5.1.1 and ZXing-WASM 2.2.2 plus their engines
from external CDNs. Images are never sent to those CDNs.

The list and progress are not saved and will be lost on refresh/close. Copy the
list before leaving. Camera and clipboard access require HTTPS (or localhost
for development) and browser permission.

Barcode decoding is usually faster and more reliable than reading printed IDs,
but depends on focus, light, code size, and device performance. OCR bag counts
and screenshot imports still need human review.

## Development and publishing

Run `python3 -m http.server 8080 --bind 127.0.0.1` here, then open
`http://localhost:8080`. Stop the server with Ctrl+C.

Run all tests with:

```sh
node --test stops.test.mjs packages.test.mjs live-camera.test.mjs barcode.test.mjs
```

In GitHub **Settings > Pages**, choose **Deploy from a branch**, **main**,
and **/ (root)**. Publish only this standalone website, never private images or
other workspace files.

Browser module URLs carry a release query string. Bump it consistently in the
HTML and module imports for browser code changes so phones do not mix cached
modules from different releases.
