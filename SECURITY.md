# Security policy

TetraStream is a developer preview. Fixes are made on `main` and released in the next applicable version; older preview versions do not have a separate maintenance branch.

Please avoid putting vulnerability details or private application data in a public issue. If GitHub shows a **Report a vulnerability** button in this repository's Security tab, use that private reporting flow. Otherwise, open an issue requesting a private contact channel without including exploit details, and the maintainer will arrange one.

Parsing is separate from authorization, sanitization, and application schema validation. Treat generated content as untrusted input, render text as text, and validate completed data before consequential actions. The format-specific boundaries and limitations are documented in the package README and usage guide.
