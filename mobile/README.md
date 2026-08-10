# Mobile Template

The runnable Expo mobile app is intentionally not part of `master`.

Use the `mobile` branch when a project needs the mobile template:

```bash
git clone <repo-url>
cd <repo-directory>
git switch mobile
git fetch origin
bun install --frozen-lockfile
bun run mobile:template:check -- --published
```

or, from an existing checkout:

```bash
git fetch origin
git switch mobile
bun install --frozen-lockfile
bun run mobile:template:check -- --published
```

The `mobile` branch contains the Expo app, development-build setup, Maestro E2E runner, switched-off but working App Store and Google Play subscription paths, Expo Push notifications, and mobile social auth integration.

Read [../docs/WEB_SURFACES.md](../docs/WEB_SURFACES.md) before payment work. Mobile owns its native
payment experience separately from browser checkout. App Store/Google Play purchases are already
the default digital-subscription foundation on the mobile branch. When the product needs another
policy-compliant path, the mobile app may also implement direct or saved-card payments, Apple Pay,
or Google Pay without routing through `website` or `webapp`. Re-check current store rules for the
product type, storefront, and region before choosing the payment transport.

Keep general web, backend, infrastructure, deployment, and shared contract work on `master`. Keep mobile runtime work and mobile-specific backend/contracts changes on `mobile`. Template maintainers merge `master` into `mobile`, resolve branch-specific docs and capability states, run the local template gate below, and publish both refs before the mobile line is offered for project setup.

Before a template maintainer publishes the reusable `mobile` line, fetch the refs, install the
locked dependencies, and validate the clean candidate before push:

```bash
git fetch origin
bun install --frozen-lockfile
bun run mobile:template:check
```

After pushing the validated candidate, fetch and verify the published ref:

```bash
git fetch origin
bun run mobile:template:check -- --published
```

The default check allows a clean candidate ahead of `origin/mobile`; `--published` additionally
requires `HEAD` to equal that remote ref. Both require the `mobile` branch to contain current
`origin/master`, the runnable mobile/IAP files, the cross-surface contract, equivalent agent
instructions, and the mobile branch's `available` payments/push/social capability rows. They run local
documentation/deployment tests, contracts, backend unit tests, mobile tests, and mobile typecheck.
If the command is missing or fails, stop setup or template-line publication and ask the template
maintainer to synchronize the mobile line; do not improvise conflict resolution in a new product
checkout. After first-run setup changes capabilities to
`included` or `removed`, do not use this template gate for product releases; validate the installed
product's active mobile paths with its recorded local test, typecheck, store-sandbox, and release
runbooks instead.
