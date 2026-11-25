# Developer documentation site

The standalone `docs/index.html` is a small static documentation portal. It links to the authoritative repository guides, signed releases, contracts and examples rather than duplicating their content. No application credentials, analytics or SDK runtime are embedded.

To publish the documentation portal, enable GitHub Pages from the repository's Settings > Pages, with branch `main` and folder `/docs`. The portal is then accessible at the Pages URL shown by GitHub. A custom developer domain is optional and requires owner DNS configuration. This commit provides the site source; it does not enable Pages or claim that a live site is deployed. Update the current signed-release banner when a new package is signed and activated.
