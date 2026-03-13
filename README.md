# Universal Autofill Extension

Universal Autofill is a Chrome extension that connects to your Universal Autofill Studio account and helps you fill forms faster using your saved profile fields.

## What it does
- reads form fields on the current page
- matches them against your saved profile data
- previews likely matches before filling
- autofills supported fields when you choose to apply

## Open the website
- Live app: https://ai-autofill-mvp.vercel.app

## Install
1. Download this repository as a ZIP file.
2. Extract the ZIP on your computer.
3. Open `chrome://extensions`.
4. Turn on `Developer mode`.
5. Click `Load unpacked`.
6. Select this folder.
7. Open the Universal Autofill website, sign in, copy your JWT token from the dashboard, and paste it into the extension popup.

## Notes
- The JWT token can change when you sign in again or start a new session.
- If the extension asks for a new token, copy the latest one from the website dashboard.
- Best results come from standard form inputs, textareas, selects, radios, and many checkbox patterns.
