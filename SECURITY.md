# Security

Only the latest Calendar release receives security fixes. Report vulnerabilities through GitHub's private vulnerability reporting with the affected version and reproduction steps.

## Home Assistant access

Calendar exposes no LAN port. Supervisor proxies requests to the private app server, and the native panel is restricted to HA administrators. The server independently verifies the forwarded user through its Core integration. Missing, inactive, system or non-admin users are denied; an unavailable authorization endpoint also denies access. Live streams are rechecked throughout their lifetime.

Google authorization belongs to HA's Google Calendar integration. Calendar reads HA calendar entities with Supervisor's server-side credential and does not receive Google's OAuth client secret. The credential is never returned to the browser.

The container starts as root only to prepare private storage, then drops to the `node` user. Configuration, credentials and photos live in `/data/marco` and are included in Home Assistant's app backups. Credentials are kept separately with mode `600`; display responses omit private source URLs and secrets.

## Browser and persistence protection

Mutations require authentication, matching origins and JSON bodies, except validated photo uploads. Responses carry content-type, framing and referrer protections. Host checks guard against DNS rebinding. Existing password sessions and private display credentials retain their protection for compatibility; removing the security page does not open access.

The calendar checks authorization before displaying offline cached content. Denied access clears its cache, stops photo rotation and hides private data. Preview mode does not read or overwrite the regular calendar cache. Media URLs never append credentials to external sites or another ingress session.

Configuration writes are atomic and guarded by revisions. Failed validation, stale revisions or persistence errors do not discard the working configuration or credentials. Home Assistant manages app updates and backups.

## Trusted inputs

An administrator can configure calendar feeds and weather sources that the server fetches, including private network addresses. Treat admin access as access to those resources. Uploaded photo names, formats, sizes and focal points are validated before storage; credentials and private feed URLs belong in HA or private storage, never in this repository.
