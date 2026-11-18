# Stops & Packages prototype

A mobile browser prototype with two steps. No build step, backend, or image
upload service is required.

## Appearance

The compact layout keeps instructions out of the workflow and uses a short,
scrollable package editor that can be resized vertically. The sun/moon button
switches between white and black themes, including scanner cards and notices.
The initial theme follows the device preference; an explicit choice is saved
locally for future visits. Only the theme is saved, not the package list or
scanning progress. If browser storage is unavailable, the theme still switches
for the current page and a warning is logged.

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
The number of unique package IDs under each stop is its expected bag total.
Import all overlapping screenshots and review missing-ID warnings before
scanning. Overall cart counters such as `20 OF 40` are not per-stop totals.

Failed or unrecognized screenshots leave the existing list intact. Other files
in the batch are still processed. Invalid editor formatting blocks further
imports until fixed. **Copy list** copies the current editor exactly.

## 2. Scan and group packages

Tap **Continue to scan**, then **Open Live Camera** and allow camera access.
The rear camera is preferred. Show one Data Matrix or QR code at a time.

**Package identity comes from Data Matrix / QR decoding, not printed-ID OCR.**
The app uses ZXing-C++ WebAssembly, including on browsers without native barcode
detection. It first matches a decoded full ID; otherwise its last four characters
must uniquely identify a listed ID. Matching ignores letter case, but never
substitutes Q/O/0 or guesses other characters.

The camera does not run OCR or load an OCR worker. Once a known code is decoded,
it pauses and immediately displays the large stop number, decoded package code,
and **Bag x of y**. Here, `x` is the number of unique confirmed packages for that
stop plus this pending package; `y` is the number of unique IDs in the current
edited screenshot list. Nothing counts until **OK - Resume**. **Rescan - Don't
Count** dismisses the notice without changing progress, and confirmed codes
never count twice.

The first popup for a stop number shows **New-7** (for example); later popups
show just **7**, without a "Seen before" label. Showing the popup marks the stop
as appeared even when **Rescan** is selected. This history survives stopping
and reopening the camera or changing steps. **Reset Found Packages**, **Clear**,
an entirely cleared editor, or a page reload starts a new sorting run and
resets the new-stop markers. Reset is available even if a popup was shown
without confirming any packages.

A one-package stop displays **Only package - 1 of 1**. The final pending
package at a multi-package stop displays **Last package - x of y**, distinct
from an only-package stop. OK is still required before either completes.

**This is scanned progress, not the printed bag position.** Barcodes contain
the package ID, not `n of m bags`. Printed label totals and positions are no
longer read or validated. A listed one-package stop completes after its one
barcode is confirmed, even if the physical label says `1 of 3 bags`.

Unknown codes, unsupported payloads, ambiguous matches, and multiple labels
produce **Check this package** notices without modifying the list or progress.
The same unknown reading is shown once per camera session to avoid a popup loop.

Progress totals always come from the current list. Cards turn green after all
listed IDs at that stop are confirmed, regardless of scan order. Explicit editor
numbers such as `7.` are preserved for camera notices; otherwise list order is
used. Screenshot imports number stops in their first-seen order.

Stop the camera to go back and edit/import more screenshots. Progress follows
listed IDs across edits; deleted IDs lose their saved scans and must be scanned
again if re-added. Deleting a full package row or clearing its ID updates the
total and completion immediately. Empty package bullets are ignored. Stops
with no packages display an explicit skipped message, never turn green, and do
not block scanning other stops. At least one listed ID is required overall.
The app rereads the editor when changing steps and opening the camera, so the
camera list never relies on an earlier snapshot of the editor.
**Reset Found Packages** keeps the list; **Clear** clears both.
Camera tracks are released on Stop, navigation away, or moving the
page to the background. Returning requires opening the camera again.

## Privacy and limitations

All images, decoded IDs, OCR, and progress remain in the browser. Internet is
required to download Tesseract.js 5.1.1 and ZXing-WASM 2.2.2 plus their engines
from external CDNs. Images are never sent to those CDNs.

The list and progress are not saved and will be lost on refresh/close. Copy the
list before leaving. Camera and clipboard access require HTTPS (or localhost
for development) and browser permission.

Barcode decoding is usually faster and more reliable than reading printed IDs,
but depends on focus, light, code size, and device performance.
Screenshot imports still use OCR and need human review.

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
