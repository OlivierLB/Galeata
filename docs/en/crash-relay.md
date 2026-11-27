[Français](../fr/crash-relay.md) · [English](crash-relay.md)

> Automatically translated from French with Argos Translate. The French version is the reference; the application interface is currently in French.

<a id="relais-de-plantages--signalement-sans-compte-github"></a>

# Relays of crashes: report without account GitHub

Code: [`services/crash-relay/`](../../services/crash-relay/).

<a id="hébergement-retenu--cloudflare-workers-free"></a>

## Accommodation: Cloudflare Workers Free

The preferred relay is now in [`services/crash-relay/cloudflare/`](../../services/crash-relay/cloudflare/). It uses a free HTTPS subdomain `galeata-crashes.<compte>.workers.dev` No server or domain purchased is required. Keep the account on **Workers Free** Free Worker and Sustainable Object quotas block operations beyond limits. Do not subscribe to a paid plan for this service.

The Worker uses the same validator and ticket format as the Node relay. A Durable Object with storage **SQLite** holds up to 10,000 signatures without expiry, even after restarting, and limits overall write attempts GitHub (creations and meters) to **25 per day UTC**, errors included. A storage limit reached refuses new signatures with 429, without deleting existing groups. Additional requests receive 429 and remain on the post for a future shipment. Signatures already transmitted receive 204 without new tickets. The storage contains only signatures, numbers ofissues, random identifiers of reports, statements and meters; full reports are sent directly to GitHub.

A cloudblare limitation of five queries per minute and IP protects the input (approximate meter per point of presence). The IP is not added to the report or stored by the relay code. The bodies are limited to 32 Kio. Worker's applicability is disabled. A quota reached never produces a false confirmation of dispatch.

<a id="ce-qui-remonte-rapports-schéma-3"></a>

### What goes up (Schedule reports 3)

- **Panic Rust** Category, file and line Galeata, battery limited to symbols Galeata.
- **Fatal signal** (`SIGSEGV`, `SIGABRT`, `SIGBUS`, `SIGILL`, `SIGFPE`, `SIGQUIT`) : recorded by a safe signal manager, then the original behavior resumes.
- **WebKit Display crash** : the web process dies while the window survives (white page). The report leaves immediately, without waiting for the revival.
- **native GTK/GLib error** : at the revival, the system journal of the dead process is reread (`journalctl --user _PID=…`, limited to 200 lines and 3 s). Only identifiers are kept: domain (`Gtk`), level, C file and line, function, library names (`libpixbufloader-svg.so`) and indices (`missing_library`, `gtk_assertion`, `x_io_error`...). No rough message or path.
- A judgment requested (`SIGTERM`, `SIGHUP`, `SIGINT` : disconnection, `kill`Ctrl+C) **not** a crash: it is noted locally (`local-*.json`) and never transmitted.

Scheme 2 reports remain accepted, with the same grouping signatures.

<a id="vérifications-locales-sans-compte-cloudflare"></a>

### Local checks without Cloudflare account

```sh
npm ci --prefix services/crash-relay/cloudflare
npm test --prefix services/crash-relay/cloudflare
```

The test compiles with Wrangler pinned then uses the real runtime `workerd` via Miniflare. LAPI GitHub is simulated: validation, refusal of bodies too big, failures/resumption, deduplication after restart, competition, limit per customer and daily ceiling. No real ticket is created.

<a id="activation-dans-ton-compte"></a>

### Activation in your account

1. Create or use an account **Cloudflare Workers Free** and choose its subdomain `workers.dev`.
2. Allow deployment by a token Cloudflare is limited to Workers and Durable Objects in the account. Keep token in the system keyring and provide it temporarily to Wrangler via `CLOUDFLARE_API_TOKEN`with `CLOUDFLARE_ACCOUNT_ID`. Do not create a file of token local, `.env` or `.dev.vars` Clear. None token is required for the above local checks.
3. Launch `npm run deploy --prefix services/crash-relay/cloudflare`. The configuration only creates the Worker, its limiter and the Durable Object SQLite available in the free offer.
4. In the Cloudflare dashboard, add the variable **secret** `GITHUB_TOKEN` (figured), with the right to appear on `OlivierLB/Galeata` Only. `GITHUB_REPOSITORY` is already configured without secret. Until the token, the relay answers 503.
5. Check `/health` (present configuration), then `/ready` : reading GitHub authenticated without ticket creation, result cached 15 minutes in the Durable Object. One token revoked or expiring in less than 14 days produces 503. The Law Issued in Writing is not proven by this reading; validate it once with an explicit test ticket. If GitHub does not provide the expiration header, inform `GITHUB_TOKEN_EXPIRES_AT` (ISO date) in Cloudflare variables. Without an available date, only the current validity is checked.
6. Save Address `https://galeata-crashes.<compte>.workers.dev/crashes` in secret GitHub `GALEATA_CRASH_ENDPOINT` (releases) and **variable** Actions of the same name: `scripts/install-local.sh` the bed with `gh` for local compilations, without writing in sources. It remains overloadable by the compile environment variable. Client uses User Agent Galeata explicit for automated customers on `workers.dev`.

Deployment is not activated by the local compilation. It requires your account and secrecy GitHub Cloudflare side. Answer GitHub lost after creating a ticket can exceptionally produce a duplicate at recovery; the creation protocolissue is not strictly ideal.

References: [Workers Free](https://developers.cloudflare.com/workers/platform/pricing/), [SQLite Durable Free Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/), [address workers.dev and User-Agent](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).

<a id="exploitation-automatisée-sans-abonnement-supplémentaire"></a>

## Automated operation without additional subscription

The repository public uses standard Linux runners GitHub Shares and Cloudflare account **Workers Free** existing. Do not activate Workers Paid, paid runner or paid product. Free limits remain applicable.

In GitHub → Settings → Secrets and variables → Actions, configure :

- `GALEATA_CRASH_ENDPOINT` : HTTPS address ending with `/crashes`, transmitted to the compilation of releases (it takes precedence over the default address). A tag publication fails if it is missing.
- `CLOUDFLARE_ACCOUNT_ID` : identification of the deployment account only.
- `CLOUDFLARE_API_TOKEN` : token dedicated to the account, rights Workers Scripts Edit and Account Settings Read. Limit it to this account and give it an expiry. Do not reuse a global key or transmit the token in a conversation.

These values are not saved in the files tracked. The address of the relay becomes necessarily visible in the distributed binary. `GITHUB_TOKEN` remains exclusively in the secrets of the Worker; the deployment workflow does not replace it.

Workflow `Crash relay` tests PRs without secrets, then deploys changes to the relay on `main` Only after his tests. A manual launch since `main` allows redeployment. Daily control calls `/ready` and fails in case of unavailability, token or near expiry. Enable personal notifications GitHub Actions to receive failures: GitHub → Settings → Notifications → Actions. The planned execution depends on GitHub ; they can be delayed and disabled after a long inactivity of repository public.

Occurrences feed the same issue, whether or not closed, without reopening automatically. An alarm gathers the time interval meter updates, with a resumption in case of failure or quota reached. It keeps the text of theissue and only replaces the meter block. Diagram 2 reports are deduplicated by ID for 30 days (maximum 100,000 identifiers). Old reports without ID can count their retests. The meter therefore indicates the reports received, not a guaranteed number of separate crashes. No complete report is kept in the Durable Object.

During migration, the old signatures without the number ofissue remain deduced during their validity time; their issue is not automatically imported. Answer GitHub lost after creation can exceptionally still produce a duplicate.

References: [deployment GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/), [Workers quotas](https://developers.cloudflare.com/workers/platform/limits/), [notifications Actions](https://docs.github.com/en/account-and-profile/managing-subscriptions-and-notifications-on-github/setting-up-notifications/configuring-notifications).

<a id="rapports-et-détection"></a>

## Reporting and detection

The application leaves a marker by process and removes it at the normal output. At the next launch, markers whose process has disappeared are examined. The requested stops identified by their signal remain local; others become pending reports. Several active windows are not considered crashes. A disappearance without recoverable signal remains classified as abnormal closure, without claiming to know the cause.

The enriched report (schemas 2 and 3) contains:

- A random identifier in relation to the version and the commit of compilation.
- Linux, architecture, kernel digital version and display type (Wayland/X11/unknown).
- Start dates and last instant, session duration and RSS memory in Kio.
- The last 32 technical events: authorized transaction name, date, duration, result and generic error code.
- For a Rust panic: category (assertion, unwrap, index, exceedance or other), source file **of the Galeata** concerning repository, row, column and maximum 32 call symbols Galeata.

Raw panic messages, absolute paths, user names, machine names, command arguments, file contents and conversations are excluded. The token starter used to distinguish reused PIDs remains only in the local marker and is removed from the sent report.

An atomic snapshot is recorded every 15 seconds, as well as every technical error. Panic causes immediate capture. The battery depends on the symbols available in the binary and can be empty in optimized version. Diagram 3 completes the snapshot with the fatal signal or native identifiers available. For a SIGKILL or a cut without recoverable diagnosis, only the last available snapshot is recoverable: the report does not claim to know the exact cause. A panic intercepted by the application is also maintained at normal closing.

Failed shipments remain pending for the next launch (16 reports maximum, 32 Kio compared). Relay validation reconstructs an authorized object and refuses arbitrary technical fields. The old minimum ratios remain accepted by the relay.

Deployment [`services/crash-relay/server.mjs`](../../services/crash-relay/server.mjs) with Node 24 behind an HTTPS proxy limiting the rate and size of queries. Provide `GITHUB_TOKEN_FILE` via the server trunk and `GITHUB_REPOSITORY=OlivierLB/Galeata`. The token must have the right Issued in writing on that only repository. It is never included in the distributed application. The relay consolidates reports with the same version, the same build and the same panic signature (source, line, stack) for one hour. Two different causes of the same version produce two tickets. Deduplication is in memory and goes back to zero if the relay restarts.

The default relay only listens on `127.0.0.1:8787`. `GET /health` returns 204 if its configuration is present (this does not check the rights of token on GitHub). It does not require any account from users. No actual report is sent by the tests:API GitHub It's simulated.

<a id="déploiement-préparé"></a>

## Prepared deployment

Files [`galeata-crash-relay.service`](../../services/crash-relay/galeata-crash-relay.service) and [`nginx.conf.example`](../../services/crash-relay/nginx.conf.example) of the `services/crash-relay/` provide a base for a Linux server with Node 24, nginx and systemd supported `LoadCredentialEncrypted` and `%d` (systemd 252 or later).

1. Copy `services/crash-relay/server.mjs` and `services/crash-relay/core.mjs` under `/opt/galeata-crash-relay/`, accessible for reading by the service.
2. Create encrypted secret in `/etc/credstore.encrypted/galeata-github-token` with `systemd-creds encrypt --name=github-token - /etc/credstore.encrypted/galeata-github-token`, providing the token on the standard input from the server trunk. Do not put it in shell history or shell history repository.
3. Install the systemd unit, then run `systemctl daemon-reload` and `systemctl enable --now galeata-crash-relay`.
4. Adapt domain and HTTPS certificates from nginx model, then check `nginx -t` before reloading. The model limits the flow rate and gear size; HTTP accesses are not logged.
5. Check `curl --fail http://127.0.0.1:8787/health`, then configure the public compilation address below. The creation of a first actual test ticket must be an explicit check on the repository chosen.

These models are not executed automatically on the development station. Hosting, domain and server trunk must be provided to activate the service.

Compile the application with `GALEATA_CRASH_ENDPOINT=https://votre-service/crashes` defined in the Rust compilation environment. The variable must also be transmitted to the container if the compilation uses Docker. Without this configuration, reports remain local; No shipment is announced as successful. The relay is provided but is not deployed by this modification.

Contract GitHub : https://docs.github.com/en/rest/issues/issues#create-an-issue

Deployment References: [credentials systemd](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html#Credentials), [Nginx flow limitation](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html).
