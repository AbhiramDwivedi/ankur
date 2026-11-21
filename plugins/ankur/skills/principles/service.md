# service pack

Applies when the work touches a long-running process that serves requests or consumes work: an HTTP or RPC service, a worker, or a queue consumer, and its deploy config. It follows the 12-factor app and assumes the service runs as one or more replaceable processes behind a load balancer or scheduler. It extends the core pack, and core's rules still apply.

## Rules

1. All config that varies between deploys comes from the environment, not from files checked into the repo per environment.
   Test: the diff adds no hostnames, credentials or per-environment values to source or to files like `config.prod.*`; new settings are read from environment variables.
2. The service fails fast at startup when required config is missing or malformed.
   Test: each new environment variable is read and validated in the startup path, and starting without it exits non-zero with a message naming the variable.
3. Processes are stateless: no request depends on memory or local disk left by an earlier request.
   Test: the diff stores no session, cache or upload state in process memory or local files that a later request reads; such state goes to a backing service.
4. Each backing service (database, cache, queue, object store, mail) is an attached resource reached through a URL or credentials in config.
   Test: swapping a backing service needs only an environment change; the diff hard-codes no backing-service address.
5. The service exposes a liveness health endpoint that checks only the process itself.
   Test: a route such as `/healthz` or `/livez` exists, returns 200 without calling any dependency, and a test hits it.
6. The service exposes a readiness endpoint that checks the backing services it needs to serve traffic.
   Test: a route such as `/readyz` returns non-200 when a required dependency is unreachable, and a test covers that case.
7. Processes are disposable: they start quickly, and on SIGTERM they stop taking new work, finish or hand back in-flight work within a bounded grace period, then exit.
   Test: the diff handles SIGTERM (or the platform's stop signal) by closing intake (the listener, the queue subscription, the scheduler), finishing each in-flight request or job or returning it to its queue within a named grace timeout, and then exiting; a test sends the signal while work is in flight.
8. Logs go to stdout or stderr as an event stream, one structured event per line.
   Test: the diff opens no log files and configures no log rotation; new log calls write structured lines to stdout or stderr.
9. Dev and prod use the same kinds of backing services and the same build.
   Test: local and CI setup (for example `docker-compose.yml`) runs the same database and queue engines as prod, not an in-memory or SQLite stand-in.
10. One build artifact moves through every environment; only config changes between them.
   Test: the pipeline builds once and promotes the same image or package digest, and the diff adds no environment-specific build step.
11. Dependencies are declared in a manifest and pinned by a lockfile.
   Test: every new import resolves to a package in the manifest; a diff that adds or bumps a manifest entry also changes the lockfile.
12. Every outbound call to another service has a timeout, and retries use backoff with a cap.
   Test: each new HTTP, RPC or database client call in the diff sets a timeout, and any retry loop has a maximum attempt count and backoff.
13. Admin and one-off tasks (migrations, backfills) run as separate commands from the same codebase and release.
   Test: the diff adds such tasks as entries in the service's own CLI or scripts directory, not as code run at web-process startup.
14. Where the stack has a maintained OpenTelemetry SDK, the service emits OpenTelemetry traces and metrics for the requests and jobs it handles and the calls it makes to other services.
   Test: the manifest pins the stack's OpenTelemetry SDK, the change that adds or bumps it cites that version by URL under core rule 15, and each new handler, job and outbound call in the diff starts a span or records a metric; where the stack has no maintained SDK, the architecture doc says so and core rule 8's log lines carry the signal.
15. The service has a runbook in the repo that says how to run it, deploy it, roll it back and diagnose it.
   Test: a runbook file has a section for each of run, deploy, roll back and diagnose, and a diff that changes a start command, deploy step, rollback step, health endpoint or alert changes the runbook too.
