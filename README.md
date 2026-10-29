# Duo Checker

Watches Apple Store **in-store pickup** stock for the **iPhone Duo** and sends a push
to your phone through [ntfy](https://ntfy.sh) when a model you want shows up at a store
near you. It runs as a bookmarklet in your own apple.com tab, so there's nothing to host.

Why a bookmarklet: Apple only answers its pickup-stock endpoint for a person's real
browser session. Scripts and headless browsers get HTTP 541. See [SPEC.md](SPEC.md).

## Setup (5 minutes)

1. Install the **ntfy** app on your phone (App Store / Google Play).
2. Open `install.html` in your browser (double-click it in Finder).
3. Copy the **ntfy topic** it shows. In the ntfy app, tap **+** and subscribe to that exact topic.
4. Check the ZIP code (75010), max miles (25), interval (60 s) and models.
5. Drag the blue **Duo Checker** button to your bookmarks bar.
   (No bookmarks bar? In Chrome press ⌘⇧B.)

## Use

1. Open <https://www.apple.com/shop/buy-iphone/iphone-duo> in a tab you'll leave open.
2. Click **Duo Checker** in the bookmarks bar. A panel appears in the bottom-right corner.
3. Press **Test notification** and check that it reaches your phone.
4. Leave the tab open. It can be in the background. Click the bookmark again to hide or show the panel.

When a watched model becomes available within your distance, you get one urgent push
with the model, store and distance, and the tab title gets a 🟢. Tapping the push opens
Apple's iPhone Duo buy page.

Reloading or closing the tab stops the checker. Click the bookmark again to restart it;
it remembers what it already told you about.

## Keep it running

- **Keep your Mac awake** while you're tracking, for example by running `caffeinate -d` in Terminal.
- **Chrome Memory Saver** can put background tabs to sleep. Go to Settings → Performance →
  Memory Saver → "Always keep these sites active" and add `www.apple.com`.
- Glance at the panel's **Last check** time. If it's old, the tab was frozen.

## Troubleshooting

| Panel shows | Meaning / fix |
|---|---|
| `Apple returned HTTP 541` | Apple refused this check. The checker backs off (up to 10 min between checks) and pushes "checks are failing" after 10 failures in a row. Reloading apple.com and restarting usually helps. |
| `push failed` | ntfy couldn't be reached. Stock found while pushes fail is retried on the next check. |
| Nothing happens on click | The bookmark only runs on `www.apple.com` pages. |

To change settings, open `install.html` again, then drag a new bookmark and delete the old one.

## Development

```bash
node --test
```

`checker.js` holds everything in one function, `stockChecker(config)`, because the
bookmarklet is that function's source code. `install.html` builds the bookmark from it.
